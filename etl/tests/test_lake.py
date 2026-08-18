"""Parquet writing, checksums, manifests and the append-only guarantee.

The S3 interactions are exercised against a stub client rather than MinIO: the
behaviour under test is this module's own logic — refusing a used prefix,
verifying checksums on the way back, recording an auditable manifest — and a stub
lets a failure be provoked deliberately. The real round trip is covered by the
integration spec and by the pipeline runs in CI.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from conftest import make_snapshot
from etl.config import LakeConfig
from etl.extract import SCHEMAS, Snapshot
from etl.lake import (
    LakeError,
    LakeRun,
    assert_prefix_unused,
    build_manifest,
    download_run,
    run_prefix,
    upload_run,
    utc_now,
    write_parquet_locally,
)

CONFIG = LakeConfig(
    endpoint="http://minio:9000",
    access_key="key",
    secret_key="secret",
    region="us-east-1",
    bucket="sales-lake",
    raw_prefix="raw",
)


class StubS3:
    """Minimal in-memory stand-in for the S3 operations this module uses."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.metadata: dict[str, dict[str, str]] = {}

    def list_objects_v2(self, Bucket: str, Prefix: str, MaxKeys: int = 1000):  # noqa: N803
        keys = [key for key in self.objects if key.startswith(Prefix)]
        return {"KeyCount": min(len(keys), MaxKeys)}

    def upload_file(self, filename: str, bucket: str, key: str, ExtraArgs=None):  # noqa: N803
        self.objects[key] = Path(filename).read_bytes()
        self.metadata[key] = (ExtraArgs or {}).get("Metadata", {})

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str = ""):  # noqa: N803
        self.objects[Key] = Body

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        Path(filename).write_bytes(self.objects[key])


class TestParquetWriting:
    def test_writes_one_file_per_table(self, snapshot: Snapshot, tmp_path: Path) -> None:
        paths = write_parquet_locally(snapshot, tmp_path)

        assert set(paths) == {"customers", "products", "orders", "order_items"}
        for path in paths.values():
            assert path.exists()

    def test_preserves_the_declared_schema(self, snapshot: Snapshot, tmp_path: Path) -> None:
        paths = write_parquet_locally(snapshot, tmp_path)

        for name, path in paths.items():
            written = pq.read_table(path)
            # Types must survive the round trip, not just the values: a float
            # money column would lose exactness invisibly.
            assert written.schema.equals(SCHEMAS[name]), name

    def test_money_survives_as_exact_decimal(self, snapshot: Snapshot, tmp_path: Path) -> None:
        paths = write_parquet_locally(snapshot, tmp_path)

        prices = pq.read_table(paths["products"]).column("unit_price").to_pylist()

        assert Decimal("250.50") in prices
        assert all(isinstance(price, Decimal) for price in prices)

    def test_is_byte_identical_for_identical_input(self, tmp_path: Path) -> None:
        # Two runs over unchanged data should produce the same bytes, so their
        # manifest checksums are comparable and drift is detectable.
        first = write_parquet_locally(make_snapshot(), tmp_path / "a")
        second = write_parquet_locally(make_snapshot(), tmp_path / "b")

        for name in first:
            assert first[name].read_bytes() == second[name].read_bytes(), name


class TestPrefixLayout:
    def test_uses_hive_style_partitions(self) -> None:
        prefix = run_prefix(CONFIG, "2026-08-18", "abc")

        # Hive style so any engine can partition-prune by date or run.
        assert prefix == "raw/run_date=2026-08-18/run_id=abc/"

    def test_accepts_an_unused_prefix(self) -> None:
        assert_prefix_unused(StubS3(), CONFIG, "raw/run_date=2026-08-18/run_id=new/")

    def test_refuses_a_prefix_that_already_holds_objects(self) -> None:
        client = StubS3()
        prefix = "raw/run_date=2026-08-18/run_id=used/"
        client.objects[f"{prefix}customers.parquet"] = b"already here"

        # The append-only guarantee: a recycled run id must fail loudly rather
        # than overwrite a previous run's raw extract.
        with pytest.raises(LakeError, match="immutable"):
            assert_prefix_unused(client, CONFIG, prefix)


class TestUploadAndManifest:
    def _upload(self, client: StubS3, snapshot: Snapshot, tmp_path: Path) -> LakeRun:
        return upload_run(
            client=client,
            config=CONFIG,
            snapshot=snapshot,
            run_id="run-1",
            run_date="2026-08-18",
            staging=tmp_path / "staging",
            extracted_at=utc_now(),
        )

    def test_uploads_every_table_and_the_manifest(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        run = self._upload(client, snapshot, tmp_path)

        assert len(run.files) == 4
        assert run.manifest_key in client.objects
        assert len(client.objects) == 5

    def test_checksums_match_the_uploaded_bytes(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        run = self._upload(client, snapshot, tmp_path)

        for file in run.files:
            expected = hashlib.sha256(client.objects[file.key]).hexdigest()
            assert file.sha256 == expected, file.name

    def test_carries_the_checksum_on_object_metadata_too(
        self, snapshot: Snapshot, tmp_path: Path
    ) -> None:
        client = StubS3()
        run = self._upload(client, snapshot, tmp_path)

        # So an integrity check does not require fetching the manifest first.
        for file in run.files:
            assert client.metadata[file.key]["sha256"] == file.sha256

    def test_manifest_makes_the_run_auditable(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        run = self._upload(client, snapshot, tmp_path)

        manifest = json.loads(client.objects[run.manifest_key])

        assert manifest["run_id"] == "run-1"
        assert manifest["schema_version"]
        assert manifest["pipeline_version"]
        assert manifest["extracted_at"]
        assert manifest["row_counts"]["orders"] == snapshot.tables["orders"].num_rows
        assert {file["name"] for file in manifest["files"]} == {
            "customers",
            "products",
            "orders",
            "order_items",
        }

    def test_manifest_row_counts_match_the_files(self, snapshot: Snapshot, tmp_path: Path) -> None:
        manifest = build_manifest(
            LakeRun(run_id="r", run_date="2026-08-18", prefix="p/", files=[]),
            snapshot,
            utc_now(),
        )

        assert manifest["row_counts"] == snapshot.row_counts

    def test_refuses_to_upload_into_a_used_prefix(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        self._upload(client, snapshot, tmp_path)

        with pytest.raises(LakeError, match="immutable"):
            self._upload(client, snapshot, tmp_path / "again")


class TestDownloadVerification:
    def test_round_trips_every_file(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        run = upload_run(
            client=client,
            config=CONFIG,
            snapshot=snapshot,
            run_id="run-1",
            run_date="2026-08-18",
            staging=tmp_path / "staging",
            extracted_at=utc_now(),
        )

        paths = download_run(client, CONFIG, run, tmp_path / "replay")

        assert set(paths) == {"customers", "products", "orders", "order_items"}
        assert pq.read_table(paths["orders"]).num_rows == snapshot.tables["orders"].num_rows

    def test_rejects_a_file_whose_bytes_changed(self, snapshot: Snapshot, tmp_path: Path) -> None:
        client = StubS3()
        run = upload_run(
            client=client,
            config=CONFIG,
            snapshot=snapshot,
            run_id="run-1",
            run_date="2026-08-18",
            staging=tmp_path / "staging",
            extracted_at=utc_now(),
        )

        # Simulate corruption in transit or at rest. The warehouse is built from
        # these bytes, so a silent mismatch would produce a wrong warehouse from
        # apparently valid raw data.
        client.objects[run.files[0].key] = b"corrupted"

        with pytest.raises(LakeError, match="Checksum mismatch"):
            download_run(client, CONFIG, run, tmp_path / "replay")
