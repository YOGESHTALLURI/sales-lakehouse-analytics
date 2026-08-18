import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { checkWarehouse } from '../src/dependencies/warehouse.js';

const BASE_ENV = {
  POSTGRES_DB: 'sales',
  POSTGRES_USER: 'sales_app',
  POSTGRES_PASSWORD: 'local_dev_password_change_me',
} satisfies NodeJS.ProcessEnv;

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'warehouse-check-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function configFor(warehousePath: string) {
  return loadConfig({ ...BASE_ENV, WAREHOUSE_PATH: warehousePath });
}

describe('checkWarehouse', () => {
  it('reports down with actionable detail when no warehouse has been published', async () => {
    const state = await checkWarehouse(configFor(path.join(workDir, 'absent.duckdb')));

    expect(state.status).toBe('down');
    expect(state.detail).toMatch(/not published yet/);
  });

  it('reports down for a zero-byte file left behind by a failed publish', async () => {
    const emptyPath = path.join(workDir, 'empty.duckdb');
    await writeFile(emptyPath, '');

    const state = await checkWarehouse(configFor(emptyPath));

    expect(state.status).toBe('down');
    expect(state.detail).toMatch(/empty/);
  });

  it('reports down when the path is a directory rather than a file', async () => {
    const state = await checkWarehouse(configFor(workDir));

    expect(state.status).toBe('down');
    expect(state.detail).toMatch(/not a file/);
  });

  it('reports up with a publish timestamp for a populated warehouse', async () => {
    const populatedPath = path.join(workDir, 'sales.duckdb');
    await writeFile(populatedPath, 'DUCK');

    const state = await checkWarehouse(configFor(populatedPath));

    expect(state.status).toBe('up');
    expect(state.detail).toMatch(/^published \d{4}-\d{2}-\d{2}T/);
  });
});
