"""One full, observable pipeline run.

    python -m etl.run_pipeline          # claim a slot and run now
    python -m etl.worker                # execute runs queued by the API

The order of operations is the contract described in IMPLEMENTATION_PLAN.md §5,
and each step exists for a reason worth stating:

    1. Claim the single active-run slot in PostgreSQL.
    2. Extract one consistent snapshot.
    3. Write Parquet, checksum it, upload once to an immutable run prefix.
    4. Upload the manifest. Nothing in that prefix is ever modified again.
    5. Read the run *back out of the lake*, verifying checksums.
    6. Build the DuckDB star schema from those files and run quality checks.
    7. Publish atomically, only if every check passed.
    8. Record the outcome, with a sanitised summary on failure.

Step 5 is the one people skip. Building the warehouse from the snapshot still in
memory would be faster and would make the lake a decorative copy that nothing
depends on — so a broken round trip would go unnoticed until someone needed the
raw history.

`execute_run` is separated from `main` so the worker can run an already-claimed
run without duplicating any of this, and so a test can drive one run directly.
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
from pathlib import Path

from sqlalchemy import Engine

from .audit import ConcurrentRunError, complete_run, fail_run, release_stale_running_runs, start_run
from .config import Config, ConfigError, load_config
from .extract import create_postgres_engine, extract_snapshot
from .lake import create_s3_client, download_run, upload_run, utc_now
from .warehouse import build_and_publish

LOG_FORMAT = "[etl] %(message)s"

logger = logging.getLogger("etl")


def execute_run(engine: Engine, config: Config, run_id: str) -> int:
    """Perform the run identified by `run_id`, which must already be claimed.

    Returns a process exit code: 0 on success, 1 on failure. Failures are recorded
    in `pipeline_runs` rather than raised, because the audit record is the only
    trace a failed run leaves and the caller may be a long-lived worker that must
    survive it.
    """
    lake_prefix: str | None = None

    try:
        extracted_at = utc_now()
        run_date = extracted_at.date().isoformat()

        logger.info("extracting a consistent snapshot from PostgreSQL")
        snapshot = extract_snapshot(engine)
        for name, count in snapshot.row_counts.items():
            logger.info("  %-12s %d rows", name, count)

        client = create_s3_client(config.lake)

        # One temporary directory for the whole run: Parquet is written here,
        # uploaded, then downloaded back into a separate subdirectory so the round
        # trip cannot accidentally read the file it just wrote.
        with tempfile.TemporaryDirectory(prefix=f"etl-{run_id}-") as workspace:
            staging = Path(workspace) / "staging"
            replay = Path(workspace) / "replay"

            logger.info("writing and uploading the raw run")
            lake_run = upload_run(
                client=client,
                config=config.lake,
                snapshot=snapshot,
                run_id=run_id,
                run_date=run_date,
                staging=staging,
                extracted_at=extracted_at,
            )
            lake_prefix = lake_run.prefix
            logger.info("  s3://%s/%s", config.lake.bucket, lake_run.prefix)
            for uploaded in lake_run.files:
                logger.info(
                    "  %-12s %8d bytes  sha256=%s…",
                    uploaded.name,
                    uploaded.size_bytes,
                    uploaded.sha256[:12],
                )

            logger.info("reading the run back from the lake and verifying checksums")
            parquet_paths = download_run(client, config.lake, lake_run, replay)

            logger.info("building the DuckDB star schema from the lake files")
            published_at = utc_now()
            result = build_and_publish(
                config=config.warehouse,
                run=lake_run,
                parquet_paths=parquet_paths,
                published_at=published_at.isoformat(),
            )

        for check in result.checks:
            logger.debug("  check %-38s %s", check.name, "pass" if check.passed else "FAIL")
        logger.info("  %d quality check(s) passed", len(result.checks))

        for table, count in result.warehouse_counts.items():
            logger.info("  %-14s %d rows", table, count)
        logger.info("published %s", result.path)

        row_counts = {
            **result.source_counts,
            "factSales": result.warehouse_counts["fact_sales"],
        }
        complete_run(engine, run_id, row_counts=row_counts, lake_prefix=lake_run.prefix)

        logger.info("run %s succeeded", run_id)
        return 0

    except Exception as error:
        fail_run(engine, run_id, error, lake_prefix=lake_prefix)
        logger.error("run %s failed: %s", run_id, error)
        logger.debug("traceback", exc_info=True)
        return 1


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m etl.run_pipeline",
        description=(
            "Extract PostgreSQL into an immutable Parquet run in MinIO, then rebuild "
            "the DuckDB warehouse from that run and publish it atomically."
        ),
    )
    parser.add_argument(
        "--release-stale",
        action="store_true",
        help=(
            "Mark any unfinished run as failed before starting. Use after a container "
            "was killed mid-run and is blocking the single active-run slot."
        ),
    )
    parser.add_argument("--verbose", action="store_true", help="Log every step in detail.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format=LOG_FORMAT,
        stream=sys.stdout,
    )

    try:
        config = load_config()
    except ConfigError as error:
        logger.error("%s", error)
        return 1

    engine = create_postgres_engine(config.postgres)

    if args.release_stale:
        released = release_stale_running_runs(engine)
        logger.info("released %d stale run(s)", released)

    try:
        run_record = start_run(engine)
    except ConcurrentRunError as error:
        logger.error("%s", error)
        return 2

    logger.info("run %s started", run_record.run_id)

    try:
        return execute_run(engine, config, run_record.run_id)
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
