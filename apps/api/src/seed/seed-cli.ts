import { ConfigError, loadConfig } from '../config.js';
import { createPostgresPool } from '../dependencies/postgres.js';
import {
  SeedConfigError,
  loadGenerationProfile,
  loadSeedSettings,
  loadVocabulary,
  seedsDir,
} from './config.js';
import { datasetChecksum, generateDataset } from './generate.js';
import { SeedLoadError, loadDataset } from './load.js';
import { formatValidationReport, validateDataset } from './validate.js';

/**
 * Entry point for `npm run seed`.
 *
 * Generates, validates, then loads — in that order. Nothing reaches the
 * database until the whole dataset has passed validation, so a bad profile
 * fails before the existing data is truncated.
 */
async function main(): Promise<void> {
  let config;
  let settings;

  try {
    config = loadConfig();
    settings = loadSeedSettings();
  } catch (error) {
    if (error instanceof ConfigError || error instanceof SeedConfigError) {
      console.error(`[seed] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const directory = seedsDir();
  const vocabulary = loadVocabulary(directory);
  const profile = loadGenerationProfile(directory);

  console.log(`[seed] seed assets from ${directory}`);
  console.log(
    `[seed] seed=${settings.seed} customers=${settings.customers} products=${settings.products} ` +
      `orders=${settings.orders} months=${settings.months} endDate=${settings.endDate}`,
  );

  const dataset = generateDataset(settings, vocabulary, profile);
  console.log(`[seed] checksum ${datasetChecksum(dataset)}`);

  const report = validateDataset(dataset);
  console.log(formatValidationReport(report).replace(/^/gm, '[seed] '));

  if (!report.ok) {
    console.error('[seed] refusing to load an invalid dataset');
    process.exit(1);
  }

  const pool = createPostgresPool(config);

  try {
    const result = await loadDataset(pool, dataset, {
      allowDestructive:
        process.env.SEED_ALLOW_PRODUCTION === 'true' || config.nodeEnv !== 'production',
      log: (message) => console.log(`[seed] ${message}`),
    });

    console.log(
      `[seed] done — ${result.customers} customers, ${result.products} products, ` +
        `${result.orders} orders, ${result.orderItems} order items`,
    );
  } catch (error) {
    if (error instanceof SeedLoadError) {
      console.error(`[seed] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] unexpected failure:', error instanceof Error ? error.message : error);
  process.exit(1);
});
