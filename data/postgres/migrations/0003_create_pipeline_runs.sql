-- Audit trail for ETL runs.
--
-- This table stays in PostgreSQL rather than the warehouse: it is operational
-- state about the platform, and it must survive the DuckDB file being replaced
-- on every publish.

create table pipeline_runs (
    id            uuid        primary key default gen_random_uuid(),
    status        varchar(20) not null default 'running',
    started_at    timestamptz not null default now(),
    completed_at  timestamptz,
    row_counts    jsonb       not null default '{}'::jsonb,
    lake_prefix   text,
    error_summary text,

    constraint pipeline_runs_status_known
        check (status in ('running', 'succeeded', 'failed')),

    -- A run is finished exactly when it has a completion time. This rules out
    -- both a "succeeded" run with no timestamp and a "running" run that
    -- silently already stopped.
    constraint pipeline_runs_completion_consistent
        check ((status = 'running') = (completed_at is null)),

    constraint pipeline_runs_not_backwards
        check (completed_at is null or completed_at >= started_at),

    -- Only a failure may carry an error summary.
    constraint pipeline_runs_error_only_on_failure
        check (error_summary is null or status = 'failed'),

    constraint pipeline_runs_row_counts_is_object
        check (jsonb_typeof(row_counts) = 'object')
);

comment on table  pipeline_runs               is 'One row per ETL run: status, timings, source row counts and the immutable lake prefix it wrote.';
comment on column pipeline_runs.lake_prefix   is 'raw/run_date=<date>/run_id=<uuid>/ — never rewritten once the run completes.';
comment on column pipeline_runs.error_summary is 'Sanitised failure summary. Must never contain credentials.';

-- The plan permits one run at a time. Enforcing it with a partial unique index
-- makes a concurrent second run impossible at the database level, rather than
-- relying on an application check that two API replicas could both pass.
create unique index pipeline_runs_single_active_run
    on pipeline_runs ((status))
    where status = 'running';

-- GET /api/pipeline/status reads the newest run and the newest successful run.
create index pipeline_runs_started_at_desc_idx on pipeline_runs (started_at desc);
