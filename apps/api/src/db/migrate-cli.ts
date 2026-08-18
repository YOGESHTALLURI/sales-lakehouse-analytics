import { ConfigError, loadConfig } from '../config.js';
import { createPostgresPool } from '../dependencies/postgres.js';
import { MigrationError, defaultMigrationsDir, migrate } from './migrations.js';

/**
 * Entry point for `npm run migrate`.
 *
 * Exits non-zero on any failure so Compose, CI and shell scripts can chain on it.
 */
async function main(): Promise<void> {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[migrate] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const directory = defaultMigrationsDir();
  const pool = createPostgresPool(config);

  console.log(`[migrate] database ${config.postgres.database} on ${config.postgres.host}`);
  console.log(`[migrate] migrations from ${directory}`);

  try {
    const result = await migrate(pool, {
      directory,
      log: (message) => console.log(`[migrate] ${message}`),
    });

    if (result.applied.length > 0) {
      console.log(`[migrate] done — ${result.applied.length} migration(s) applied`);
    }
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(`[migrate] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] unexpected failure:', error instanceof Error ? error.message : error);
  process.exit(1);
});
