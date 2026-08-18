import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MigrationError,
  assertAppliedMigrationsUnchanged,
  loadMigrations,
  type AppliedMigration,
} from '../src/db/migrations.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(fileName: string, sql: string): Promise<void> {
  await writeFile(path.join(dir, fileName), sql, 'utf8');
}

function appliedFrom(version: number, name: string, sql: string): AppliedMigration {
  return {
    version,
    name,
    checksum: createHash('sha256').update(sql).digest('hex'),
    appliedAt: new Date(0),
  };
}

describe('loadMigrations', () => {
  it('orders by numeric version, not string sort', async () => {
    // The trap this guards: string sort puts '0010' before '0009'.
    await write('0009_ninth.sql', 'select 9;');
    await write('0010_tenth.sql', 'select 10;');
    await write('0002_second.sql', 'select 2;');

    const migrations = await loadMigrations(dir);

    expect(migrations.map((m) => m.version)).toEqual([2, 9, 10]);
    expect(migrations.map((m) => m.name)).toEqual(['second', 'ninth', 'tenth']);
  });

  it('ignores files that are not .sql', async () => {
    await write('0001_first.sql', 'select 1;');
    await write('README.md', 'notes');

    const migrations = await loadMigrations(dir);

    expect(migrations).toHaveLength(1);
  });

  it('rejects a file name that does not carry a version prefix', async () => {
    await write('create_table.sql', 'select 1;');

    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it('rejects two migrations claiming the same version', async () => {
    await write('0001_first.sql', 'select 1;');
    await write('0001_also_first.sql', 'select 2;');

    await expect(loadMigrations(dir)).rejects.toThrow(/Duplicate migration version 1/);
  });

  it('reports a missing directory rather than silently applying nothing', async () => {
    await expect(loadMigrations(path.join(dir, 'absent'))).rejects.toThrow(
      /Migrations directory not found/,
    );
  });

  it('checksums file contents so an edit is detectable', async () => {
    await write('0001_first.sql', 'select 1;');
    const [before] = await loadMigrations(dir);

    await write('0001_first.sql', 'select 2;');
    const [after] = await loadMigrations(dir);

    expect(before?.checksum).not.toBe(after?.checksum);
  });
});

describe('assertAppliedMigrationsUnchanged', () => {
  it('accepts an unchanged history', async () => {
    const sql = 'select 1;';
    await write('0001_first.sql', sql);
    const files = await loadMigrations(dir);

    expect(() =>
      assertAppliedMigrationsUnchanged(files, [appliedFrom(1, 'first', sql)]),
    ).not.toThrow();
  });

  it('refuses to run when an already-applied migration was edited', async () => {
    await write('0001_first.sql', 'select 2;');
    const files = await loadMigrations(dir);

    // Recorded as applied with different content: the file and the live schema
    // now disagree, and every later environment would build a different
    // database from the same repository.
    expect(() =>
      assertAppliedMigrationsUnchanged(files, [appliedFrom(1, 'first', 'select 1;')]),
    ).toThrow(/changed after it was applied/);
  });

  it('refuses to run when an applied migration file has been deleted', async () => {
    const files = await loadMigrations(dir);

    expect(() =>
      assertAppliedMigrationsUnchanged(files, [appliedFrom(1, 'first', 'select 1;')]),
    ).toThrow(/its file is missing/);
  });

  it('allows a new migration alongside applied ones', async () => {
    const first = 'select 1;';
    await write('0001_first.sql', first);
    await write('0002_second.sql', 'select 2;');
    const files = await loadMigrations(dir);

    expect(() =>
      assertAppliedMigrationsUnchanged(files, [appliedFrom(1, 'first', first)]),
    ).not.toThrow();
  });
});

describe('committed migrations', () => {
  it('are discoverable and correctly named', async () => {
    const { defaultMigrationsDir } = await import('../src/db/migrations.js');
    const migrations = await loadMigrations(defaultMigrationsDir());

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((m) => m.version)).toEqual(
      [...migrations.map((m) => m.version)].sort((a, b) => a - b),
    );

    // Transaction control belongs to the runner: a BEGIN inside a file would
    // break the one-transaction-per-migration guarantee.
    for (const migration of migrations) {
      expect(migration.sql.toLowerCase()).not.toMatch(/^\s*(begin|commit|rollback)\b/m);
    }
  });
});
