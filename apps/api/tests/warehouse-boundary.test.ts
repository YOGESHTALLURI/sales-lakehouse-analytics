import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The architectural rule this whole project exists to demonstrate:
 * **analytics read the warehouse, never PostgreSQL.**
 *
 * Every other test checks behaviour, which cannot catch this. A future change
 * could add `import { Pool } from 'pg'` to an analytics query, have every
 * behavioural test still pass, and silently erase the OLTP/warehouse separation.
 * So this spec reads the source and fails on the import itself.
 */

const apiRoot = fileURLToPath(new URL('../', import.meta.url));

/** Modules that must never reach PostgreSQL, directly or transitively. */
const WAREHOUSE_ONLY = ['src/warehouse'];

/** Anything that would give a module a route to the operational database. */
const FORBIDDEN_IMPORTS = [
  'pg',
  'pg-pool',
  'postgres',
  'dependencies/postgres',
  'repositories/catalogue',
  'repositories/orders',
  'repositories/pipeline',
  'db/migrations',
];

async function listSourceFiles(directory: string): Promise<string[]> {
  const absolute = path.join(apiRoot, directory);
  const entries = await readdir(absolute, { withFileTypes: true, recursive: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath ?? absolute, entry.name));
}

function importedSpecifiers(source: string): string[] {
  // Covers static imports, re-exports and dynamic import() alike, since any of
  // the three would be enough to reach the database.
  const pattern = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) found.push(specifier);
  }

  return found;
}

describe('analytics cannot reach PostgreSQL', () => {
  it('finds the warehouse modules, so this spec cannot pass by scanning nothing', async () => {
    const files = await listSourceFiles('src/warehouse');

    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith('analytics.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('connection.ts'))).toBe(true);
  });

  it.each(WAREHOUSE_ONLY)('no module under %s imports a PostgreSQL route', async (directory) => {
    const files = await listSourceFiles(directory);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const specifier of importedSpecifiers(source)) {
        const forbidden = FORBIDDEN_IMPORTS.find(
          (candidate) => specifier === candidate || specifier.includes(candidate),
        );

        if (forbidden) {
          violations.push(`${path.relative(apiRoot, file)} imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the analytics query module imports only the warehouse connection', async () => {
    const source = await readFile(path.join(apiRoot, 'src/warehouse/analytics.ts'), 'utf8');
    const local = importedSpecifiers(source).filter((specifier) => specifier.startsWith('.'));

    // A single local dependency is the strongest form of this guarantee: there is
    // simply nothing else in scope to query.
    expect(local).toEqual(['./connection.js']);
  });

  it('analytics query functions take a warehouse path, never a pool', async () => {
    const source = await readFile(path.join(apiRoot, 'src/warehouse/analytics.ts'), 'utf8');

    const exported = [...source.matchAll(/export async function (\w+)\(([\s\S]*?)\)\s*:/g)];
    expect(exported.length).toBe(4);

    for (const [, name, signature] of exported) {
      // If a Pool were ever threaded in, the fallback becomes one line away.
      expect(signature, name).toContain('warehousePath: string');
      expect(signature, name).not.toMatch(/Pool|pool/);
    }
  });

  it('the pipeline repository may use PostgreSQL, because pipeline_runs is operational', async () => {
    // The counterpart to the rule above: this boundary is about analytics, not
    // about banning PostgreSQL everywhere. Run audit state belongs in the OLTP
    // database and must survive the warehouse being replaced.
    const source = await readFile(path.join(apiRoot, 'src/repositories/pipeline.ts'), 'utf8');

    expect(source).toMatch(/from 'pg'/);
  });
});
