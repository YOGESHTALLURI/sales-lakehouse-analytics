"""The `pipeline_runs` audit trail in PostgreSQL.

Deliberately not in the warehouse: this is operational state about the platform,
and it has to survive the warehouse file being replaced on every publish. It is
also what `GET /api/pipeline/status` reads, so the UI can report a run that
failed — which a warehouse-resident record could not do, since a failed run
publishes nothing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from sqlalchemy import Engine, text

# The database enforces one active run through a partial unique index, so a
# concurrent second run fails here rather than racing to publish.
CONCURRENT_RUN_MESSAGE = (
    "Another pipeline run is already active. Wait for it to finish, or clear the "
    "stale row in pipeline_runs if a previous run was killed."
)


class ConcurrentRunError(RuntimeError):
    pass


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    started_at: str


def start_run(engine: Engine) -> RunRecord:
    """Claim the single active-run slot, returning the run id to partition the lake by."""
    with engine.begin() as connection:
        try:
            row = connection.execute(
                text(
                    """
                    insert into pipeline_runs (status)
                    values ('running')
                    returning id::text as id, started_at
                    """
                )
            ).one()
        except Exception as error:  # re-raised as a typed error below
            if "pipeline_runs_single_active_run" in str(error):
                raise ConcurrentRunError(CONCURRENT_RUN_MESSAGE) from error
            raise

    return RunRecord(run_id=row.id, started_at=row.started_at.isoformat())


def complete_run(
    engine: Engine,
    run_id: str,
    *,
    row_counts: dict[str, int],
    lake_prefix: str,
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                update pipeline_runs
                   set status = 'succeeded',
                       completed_at = now(),
                       row_counts = cast(:row_counts as jsonb),
                       lake_prefix = :lake_prefix
                 where id = cast(:run_id as uuid)
                """
            ),
            {
                "run_id": run_id,
                "row_counts": json.dumps(row_counts),
                "lake_prefix": lake_prefix,
            },
        )


def fail_run(
    engine: Engine,
    run_id: str,
    error: BaseException,
    *,
    lake_prefix: str | None = None,
) -> None:
    """Record a failure with a sanitised summary.

    Never store the raw exception text: a driver error can embed the connection
    string, and this column is served to the browser by the pipeline-status
    endpoint.
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                update pipeline_runs
                   set status = 'failed',
                       completed_at = now(),
                       lake_prefix = coalesce(:lake_prefix, lake_prefix),
                       error_summary = :error_summary
                 where id = cast(:run_id as uuid)
                """
            ),
            {
                "run_id": run_id,
                "lake_prefix": lake_prefix,
                "error_summary": sanitise_error(error),
            },
        )


_CREDENTIAL_PATTERNS = (
    # postgresql://user:password@host/db and any other URI carrying credentials
    re.compile(r"\b[a-z][a-z0-9+.\-]*://[^\s@]*:[^\s@]*@\S*", re.IGNORECASE),
    # key=value / key: value pairs whose name implies a secret.
    #
    # The surrounding [\w.\-]* is load-bearing: a `\b`-anchored pattern misses
    # `secret_access_key=…` entirely, because the underscore before `access` is a
    # word character and so there is no boundary there. That gap leaked an AWS
    # secret key until a test caught it.
    #
    # Names are matched specifically rather than on a bare `key`, so a genuinely
    # useful diagnostic like `Duplicate key: order_item_id …` survives intact.
    re.compile(
        r"[\w.\-]*(?:password|passwd|secret|token|credential"
        r"|access[_-]?key|api[_-]?key|private[_-]?key)[\w.\-]*\s*[=:]\s*\S+",
        re.IGNORECASE,
    ),
    # Bare AWS access key ids, which carry no name to key off.
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
)

MAX_SUMMARY_LENGTH = 500


def sanitise_error(error: BaseException) -> str:
    """Reduce an exception to a short, credential-free summary."""
    message = f"{type(error).__name__}: {error}".replace("\n", " ").strip()

    for pattern in _CREDENTIAL_PATTERNS:
        message = pattern.sub("[redacted]", message)

    if len(message) > MAX_SUMMARY_LENGTH:
        message = f"{message[: MAX_SUMMARY_LENGTH - 1]}…"

    return message


def release_stale_running_runs(engine: Engine) -> int:
    """Mark abandoned runs failed so the active-run slot is not blocked forever.

    A container killed mid-run leaves `running` behind with nothing to finish it,
    and a run enqueued while no worker was up leaves `queued`. Both occupy the
    single-active-run slot, so both must be releasable.
    Otherwise every later run would be rejected as concurrent.
    """
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """
                update pipeline_runs
                   set status = 'failed',
                       completed_at = now(),
                       error_summary = 'Run abandoned: no process completed it.'
                 where status in ('queued', 'running')
                """
            )
        )
    return result.rowcount or 0
