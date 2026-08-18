"""Build a warehouse in a temporary file, then publish it atomically.

DuckDB is an embedded engine, so the file *is* the concurrency boundary. The
publish therefore has to be a single filesystem operation:

    build sales.duckdb.tmp  ->  run quality checks  ->  os.replace onto sales.duckdb

`os.replace` is atomic on POSIX and on Windows, within one filesystem. A reader
opening the published path sees either the whole previous warehouse or the whole
new one — never a half-built star schema. Writing directly to the published path
would expose every intermediate state to the API.
"""

from __future__ import annotations

from contextlib import closing, suppress
from dataclasses import dataclass
from pathlib import Path

import duckdb

from .config import PIPELINE_VERSION, SCHEMA_VERSION, WarehouseConfig
from .lake import LakeRun
from .quality import CheckResult, assert_quality
from .transform import (
    build_star_schema,
    record_metadata,
    source_row_counts,
    warehouse_row_counts,
)


@dataclass(frozen=True)
class PublishResult:
    path: Path
    source_counts: dict[str, int]
    warehouse_counts: dict[str, int]
    checks: list[CheckResult]


def build_and_publish(
    config: WarehouseConfig,
    run: LakeRun,
    parquet_paths: dict[str, Path],
    published_at: str,
) -> PublishResult:
    """Build from the lake files, verify, then swap into place."""
    config.path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = config.temp_path
    # A leftover temp file means a previous run died mid-build. It is worthless,
    # and DuckDB would refuse to open it as a fresh database.
    _remove_quietly(temp_path)
    _remove_quietly(Path(f"{temp_path}.wal"))

    try:
        with closing(duckdb.connect(str(temp_path))) as connection:
            build_star_schema(connection, parquet_paths)

            source_counts = source_row_counts(connection)
            warehouse_counts = warehouse_row_counts(connection)

            # The gate: nothing is published unless every invariant holds.
            checks = assert_quality(connection)

            record_metadata(
                connection,
                run_id=run.run_id,
                lake_prefix=run.prefix,
                published_at=published_at,
                schema_version=SCHEMA_VERSION,
                pipeline_version=PIPELINE_VERSION,
            )

            # Drop the staging views so the published file contains only the star
            # schema. They point at temporary local paths that will not exist for
            # the API, and a view onto a missing file is a trap for the reader.
            for name in parquet_paths:
                connection.execute(f"drop view if exists raw_{name}")

            connection.execute("checkpoint")
    except Exception:
        # Never leave a rejected build lying around where a later run might treat
        # it as resumable.
        _remove_quietly(temp_path)
        _remove_quietly(Path(f"{temp_path}.wal"))
        raise

    # Path.replace is os.replace: atomic within one filesystem, on POSIX and
    # Windows alike. A reader sees the whole previous warehouse or the whole new
    # one, never a half-built star schema.
    temp_path.replace(config.path)

    return PublishResult(
        path=config.path,
        source_counts=source_counts,
        warehouse_counts=warehouse_counts,
        checks=checks,
    )


def _remove_quietly(path: Path) -> None:
    with suppress(FileNotFoundError):
        path.unlink()
