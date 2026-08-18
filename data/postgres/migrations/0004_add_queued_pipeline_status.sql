-- Let the API enqueue a pipeline run for the ETL to pick up.
--
-- The API cannot execute the pipeline itself: the plan requires the run to
-- happen in the ETL container, and embedding Python in Node would erase that
-- boundary. The alternative — mounting the Docker socket so the API can start a
-- container — would hand an internet-facing service root-equivalent control of
-- the host, which is a far worse trade than a queue.
--
-- So `pipeline_runs` doubles as the job queue: the API inserts 'queued', the ETL
-- worker claims it with SELECT ... FOR UPDATE SKIP LOCKED and runs it. No broker,
-- no privileged socket, and the audit trail and the queue stay the same row.

alter table pipeline_runs
    drop constraint pipeline_runs_status_known;

alter table pipeline_runs
    add constraint pipeline_runs_status_known
    check (status in ('queued', 'running', 'succeeded', 'failed'));

-- 'queued' is also unfinished, so it must have no completion time.
alter table pipeline_runs
    drop constraint pipeline_runs_completion_consistent;

alter table pipeline_runs
    add constraint pipeline_runs_completion_consistent
    check ((status in ('queued', 'running')) = (completed_at is null));

-- One active run means one queued OR running row, not one of each: otherwise a
-- second run could be enqueued while the first is still executing, and the ETL
-- would start it the moment the first finished.
drop index pipeline_runs_single_active_run;

create unique index pipeline_runs_single_active_run
    on pipeline_runs ((status in ('queued', 'running')))
    where status in ('queued', 'running');

comment on column pipeline_runs.status is
    'queued: accepted by the API, awaiting the ETL worker. running: the worker is executing it. Then succeeded or failed.';
