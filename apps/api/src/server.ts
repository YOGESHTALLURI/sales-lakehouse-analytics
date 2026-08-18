import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { checkPostgres, createPostgresPool } from './dependencies/postgres.js';
import { checkWarehouse } from './dependencies/warehouse.js';
import { SERVICE_NAME, SERVICE_VERSION } from './version.js';

function main(): void {
  let config;

  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Refuse to start rather than fail later on the first request.
      console.error(`[api] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const pool = createPostgresPool(config);

  const app = createApp({
    pool,
    warehousePath: config.warehousePath,
    checks: {
      postgres: () => checkPostgres(pool),
      warehouse: () => checkWarehouse(config),
    },
  });

  const server = app.listen(config.port, () => {
    console.log(
      `[api] ${SERVICE_NAME} ${SERVICE_VERSION} listening on port ${config.port} (${config.nodeEnv})`,
    );
  });

  // Containers stop with SIGTERM; drain in-flight requests and release the pool
  // so a restart never inherits a half-closed connection.
  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
