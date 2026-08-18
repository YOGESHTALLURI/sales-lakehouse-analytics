"""Consume queued pipeline runs.

    python -m etl.worker

The API accepts `POST /api/pipeline/run` by inserting a `queued` row; this worker
claims it and executes the pipeline. That indirection is the point: the run has to
happen in this container, and the two alternatives are worse.

Running the pipeline inside the Node process would put Python in the API image and
block a request for the duration of a full extract. Letting the API start a
container would require mounting the Docker socket, which hands an
internet-facing service root-equivalent control of the host — a far worse trade
than a queue.

`pipeline_runs` therefore serves as both the queue and the audit trail, so a run's
history is never split across two systems.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from sqlalchemy import Engine, text

from .config import ConfigError, load_config
from .extract import create_postgres_engine
from .run_pipeline import execute_run

LOG_FORMAT = "[worker] %(message)s"

logger = logging.getLogger("etl.worker")


def claim_queued_run(engine: Engine) -> str | None:
    """Move one queued run to `running` and return its id.

    `for update skip locked` makes this safe with several workers: each claims a
    different row instead of two of them fighting over the same one. Only one run
    can be active at a time here, but the pattern costs nothing and removes a
    footgun if a second worker is ever started.
    """
    with engine.begin() as connection:
        row = connection.execute(
            text(
                """
                with claimed as (
                    select id
                      from pipeline_runs
                     where status = 'queued'
                     order by started_at
                     for update skip locked
                     limit 1
                )
                update pipeline_runs p
                   set status = 'running'
                  from claimed
                 where p.id = claimed.id
                returning p.id::text as id
                """
            )
        ).one_or_none()

    return row.id if row else None


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m etl.worker",
        description="Execute pipeline runs queued by POST /api/pipeline/run.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=2.0,
        help=(
            "Seconds between queue checks (default: 2). A queue this quiet does not "
            "justify LISTEN/NOTIFY; polling keeps the worker a plain loop with no "
            "connection-state edge cases."
        ),
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Execute at most one queued run, then exit. Used by tests.",
    )
    parser.add_argument("--verbose", action="store_true")
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
    logger.info("watching pipeline_runs for queued runs every %.1fs", args.poll_seconds)

    try:
        while True:
            run_id = claim_queued_run(engine)

            if run_id is None:
                if args.once:
                    logger.info("no queued run to execute")
                    return 0
                time.sleep(args.poll_seconds)
                continue

            logger.info("claimed run %s", run_id)
            # The run's own success or failure is recorded by execute_run; a
            # non-zero result must not stop the worker, or one bad run would
            # silently end all future ones.
            code = execute_run(engine, config, run_id)
            logger.info("run %s finished with code %d", run_id, code)

            if args.once:
                return code
    except KeyboardInterrupt:
        logger.info("interrupted, shutting down")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
