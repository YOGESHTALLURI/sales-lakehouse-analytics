"""Write an immutable raw run to the object store.

The lake is append-only. That is enforced here in three ways, because a policy
nobody checks is not a policy:

1. Every run writes to its own `run_date=/run_id=` prefix.
2. The prefix is verified empty before the first upload, so a re-used run id
   fails instead of silently overwriting a previous extract.
3. `manifest.json` records a SHA-256 per file, so a later reader can prove the
   bytes it downloaded are the bytes that were written.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.client import BaseClient
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from .config import PIPELINE_VERSION, SCHEMA_VERSION, LakeConfig
from .extract import TABLE_ORDER, Snapshot

MANIFEST_NAME = "manifest.json"


class LakeError(RuntimeError):
    """Raised when the lake cannot be written as specified."""


@dataclass(frozen=True)
class UploadedFile:
    name: str
    key: str
    size_bytes: int
    sha256: str
    row_count: int


@dataclass(frozen=True)
class LakeRun:
    run_id: str
    run_date: str
    prefix: str
    files: list[UploadedFile] = field(default_factory=list)

    @property
    def manifest_key(self) -> str:
        return f"{self.prefix}{MANIFEST_NAME}"


def create_s3_client(config: LakeConfig) -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=config.endpoint,
        aws_access_key_id=config.access_key,
        aws_secret_access_key=config.secret_key,
        region_name=config.region,
        # path-style addressing: MinIO serves buckets as a path, not a subdomain,
        # and virtual-host style would resolve to a hostname that does not exist.
        config=BotoConfig(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


def run_prefix(config: LakeConfig, run_date: str, run_id: str) -> str:
    """`raw/run_date=YYYY-MM-DD/run_id=<uuid>/` — Hive-style, so any engine can partition-prune."""
    return f"{config.raw_prefix}/run_date={run_date}/run_id={run_id}/"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        # Chunked so a large extract does not have to fit in memory.
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def assert_prefix_unused(client: BaseClient, config: LakeConfig, prefix: str) -> None:
    """Refuse to write into a prefix that already holds objects.

    This is the append-only guarantee. Without it, re-running with a recycled run
    id would overwrite a previous run's raw extract, and the lake would no longer
    be a faithful history.
    """
    try:
        response = client.list_objects_v2(Bucket=config.bucket, Prefix=prefix, MaxKeys=1)
    except ClientError as error:
        raise LakeError(
            f"Could not inspect s3://{config.bucket}/{prefix}: {error.response['Error']['Code']}"
        ) from error

    if response.get("KeyCount", 0) > 0:
        raise LakeError(
            f"s3://{config.bucket}/{prefix} already contains objects. "
            "Raw runs are immutable; use a new run id."
        )


def write_parquet_locally(snapshot: Snapshot, directory: Path) -> dict[str, Path]:
    """Write each table to Parquet on local disk before uploading.

    Writing first, then uploading, means the checksum in the manifest is computed
    over exactly the bytes that were sent — not over an in-memory buffer that
    might serialise differently.
    """
    directory.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    for name in TABLE_ORDER:
        table: pa.Table = snapshot.tables[name]
        path = directory / f"{name}.parquet"
        pq.write_table(
            table,
            path,
            # zstd: better ratio than snappy at negligible cost for this size, and
            # the raw layer is kept forever.
            compression="zstd",
            # Deterministic output for a given input, so an unchanged snapshot
            # produces an identical file and its checksum is comparable.
            write_statistics=True,
            use_dictionary=True,
        )
        paths[name] = path

    return paths


def build_manifest(
    run: LakeRun,
    snapshot: Snapshot,
    extracted_at: datetime,
) -> dict[str, object]:
    """Everything needed to audit a run without opening its Parquet files."""
    return {
        "run_id": run.run_id,
        "run_date": run.run_date,
        "prefix": run.prefix,
        "schema_version": SCHEMA_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "extracted_at": extracted_at.isoformat(),
        "source": {"system": "postgresql", "tables": list(TABLE_ORDER)},
        "row_counts": snapshot.row_counts,
        "files": [
            {
                "name": file.name,
                "key": file.key,
                "size_bytes": file.size_bytes,
                "sha256": file.sha256,
                "row_count": file.row_count,
            }
            for file in run.files
        ],
    }


def upload_run(
    client: BaseClient,
    config: LakeConfig,
    snapshot: Snapshot,
    run_id: str,
    run_date: str,
    staging: Path,
    extracted_at: datetime,
) -> LakeRun:
    """Upload one run's Parquet files and its manifest, exactly once."""
    prefix = run_prefix(config, run_date, run_id)
    assert_prefix_unused(client, config, prefix)

    paths = write_parquet_locally(snapshot, staging)
    files: list[UploadedFile] = []

    for name in TABLE_ORDER:
        path = paths[name]
        key = f"{prefix}{name}.parquet"
        checksum = _sha256(path)

        client.upload_file(
            str(path),
            config.bucket,
            key,
            ExtraArgs={
                "ContentType": "application/vnd.apache.parquet",
                # Carried on the object as well as in the manifest, so an
                # integrity check does not require fetching a second file.
                "Metadata": {"sha256": checksum, "schema-version": SCHEMA_VERSION},
            },
        )

        files.append(
            UploadedFile(
                name=name,
                key=key,
                size_bytes=path.stat().st_size,
                sha256=checksum,
                row_count=snapshot.tables[name].num_rows,
            )
        )

    run = LakeRun(run_id=run_id, run_date=run_date, prefix=prefix, files=files)

    manifest = build_manifest(run, snapshot, extracted_at)
    client.put_object(
        Bucket=config.bucket,
        Key=run.manifest_key,
        Body=json.dumps(manifest, indent=2, sort_keys=True).encode(),
        ContentType="application/json",
    )

    return run


def download_run(
    client: BaseClient,
    config: LakeConfig,
    run: LakeRun,
    destination: Path,
) -> dict[str, Path]:
    """Read the run back out of the lake, verifying every checksum.

    The warehouse is rebuilt from these files rather than from the snapshot still
    in memory. That is the difference between a lake and a decorative copy: if the
    round trip is broken, the pipeline must fail here rather than quietly building
    the warehouse from data the lake does not actually contain.
    """
    destination.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    for file in run.files:
        local = destination / f"{file.name}.parquet"
        client.download_file(config.bucket, file.key, str(local))

        actual = _sha256(local)
        if actual != file.sha256:
            raise LakeError(
                f"Checksum mismatch for {file.key}: manifest says {file.sha256}, "
                f"downloaded bytes hash to {actual}"
            )

        paths[file.name] = local

    return paths


def read_manifest(client: BaseClient, config: LakeConfig, prefix: str) -> dict[str, object]:
    key = f"{prefix.rstrip('/')}/{MANIFEST_NAME}"
    try:
        response = client.get_object(Bucket=config.bucket, Key=key)
    except ClientError as error:
        raise LakeError(f"No manifest at s3://{config.bucket}/{key}") from error

    parsed = json.loads(response["Body"].read())
    if not isinstance(parsed, dict):
        raise LakeError(f"Manifest at {key} is not a JSON object")
    return parsed


def utc_now() -> datetime:
    return datetime.now(tz=UTC)
