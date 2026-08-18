import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/**
 * Versioned SQL migrations.
 *
 * Deliberately a few dozen lines of `pg` rather than a migration framework: the
 * schema is plain SQL an evaluator can read, the applied-state table is
 * inspectable with psql, and there is no tool version to keep in step with the
 * database. What a framework would give us and is kept here: ordering, exactly
 * once application, one transaction per migration, and refusing to run when an
 * already-applied file has been edited.
 */

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Default migrations location, resolved from the API package root so the same
 * relative path works when running from source, from `dist`, and inside the
 * container — all three keep `apps/api` and `data/postgres` in the same layout.
 */
export function defaultMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) {
    return process.env.MIGRATIONS_DIR;
  }

  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  return path.resolve(packageRoot, '../../data/postgres/migrations');
}

/**
 * Read and order the migration files. Ordering is by the numeric prefix, not by
 * string sort, so `0010_` can never sneak ahead of `0009_`.
 */
export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  let entries: string[];

  try {
    entries = await readdir(directory);
  } catch {
    throw new MigrationError(`Migrations directory not found: ${directory}`);
  }

  const sqlFiles = entries.filter((entry) => entry.endsWith('.sql'));
  const migrations: MigrationFile[] = [];

  for (const fileName of sqlFiles.sort()) {
    const match = MIGRATION_FILE_PATTERN.exec(fileName);

    if (!match) {
      throw new MigrationError(
        `Migration file name must look like 0001_snake_case_name.sql, got: ${fileName}`,
      );
    }

    const [, rawVersion, name] = match as unknown as [string, string, string];
    const sql = await readFile(path.join(directory, fileName), 'utf8');

    migrations.push({
      version: Number.parseInt(rawVersion, 10),
      name,
      fileName,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  migrations.sort((a, b) => a.version - b.version);

  const seen = new Map<number, string>();
  for (const migration of migrations) {
    const duplicate = seen.get(migration.version);
    if (duplicate) {
      throw new MigrationError(
        `Duplicate migration version ${migration.version}: ${duplicate} and ${migration.fileName}`,
      );
    }
    seen.set(migration.version, migration.fileName);
  }

  return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version     integer     primary key,
      name        text        not null,
      checksum    text        not null,
      applied_at  timestamptz not null default now()
    )
  `);
}

export async function readAppliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const result = await client.query<{
      version: number;
      name: string;
      checksum: string;
      applied_at: Date;
    }>('select version, name, checksum, applied_at from schema_migrations order by version');

    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
  } finally {
    client.release();
  }
}

/**
 * Refuse to proceed if a migration that already ran has since been edited.
 *
 * Silently ignoring the edit is the dangerous option: the file and the live
 * schema would disagree for good, and every later environment would build a
 * different database from the same repository.
 */
export function assertAppliedMigrationsUnchanged(
  files: MigrationFile[],
  applied: AppliedMigration[],
): void {
  const byVersion = new Map(files.map((file) => [file.version, file]));

  for (const record of applied) {
    const file = byVersion.get(record.version);

    if (!file) {
      throw new MigrationError(
        `Migration ${record.version} (${record.name}) is recorded as applied but its file is missing. ` +
          'Restore the file rather than deleting history.',
      );
    }

    if (file.checksum !== record.checksum) {
      throw new MigrationError(
        `Migration ${file.fileName} changed after it was applied. ` +
          'Add a new migration instead of editing one that has already run.',
      );
    }
  }
}

export interface MigrateResult {
  applied: MigrationFile[];
  alreadyApplied: number;
}

/**
 * Apply every pending migration, each in its own transaction, so a failure
 * leaves the database on the last complete migration rather than half-way
 * through one.
 */
export async function migrate(
  pool: Pool,
  options: { directory?: string; log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const directory = options.directory ?? defaultMigrationsDir();
  const log = options.log ?? (() => {});

  const files = await loadMigrations(directory);
  const applied = await readAppliedMigrations(pool);

  assertAppliedMigrationsUnchanged(files, applied);

  const appliedVersions = new Set(applied.map((record) => record.version));
  const pending = files.filter((file) => !appliedVersions.has(file.version));

  if (pending.length === 0) {
    log(`schema is up to date (${applied.length} migration(s) applied)`);
    return { applied: [], alreadyApplied: applied.length };
  }

  for (const migration of pending) {
    const client = await pool.connect();

    try {
      await client.query('begin');
      await client.query(migration.sql);
      await client.query(
        'insert into schema_migrations (version, name, checksum) values ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      await client.query('commit');
      log(`applied ${migration.fileName}`);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw new MigrationError(
        `${migration.fileName} failed and was rolled back: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      client.release();
    }
  }

  return { applied: pending, alreadyApplied: applied.length };
}
