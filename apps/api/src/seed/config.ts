import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Seed configuration: operator settings from the environment, plus the
 * committed vocabulary and generation profile.
 */

const locationSchema = z.object({
  city: z.string().min(1),
  state: z.string().min(1),
  weight: z.number().positive(),
});

const categorySchema = z.object({
  name: z.string().min(1),
  skuPrefix: z.string().regex(/^[A-Z]{3,5}$/),
  priceBand: z.tuple([z.number().positive(), z.number().positive()]),
  modifiers: z.array(z.string().min(1)).min(1),
  nouns: z.array(z.string().min(1)).min(1),
});

const vocabularySchema = z.object({
  firstNames: z.array(z.string().min(1)).min(10),
  lastNames: z.array(z.string().min(1)).min(10),
  locations: z.array(locationSchema).min(1),
  categories: z.array(categorySchema).min(1),
});

const weightMap = z.record(z.string(), z.number().nonnegative());

const profileSchema = z.object({
  categoryDemand: weightMap,
  monthlySeasonality: weightMap,
  weekdayWeight: weightMap,
  itemsPerOrder: weightMap,
  quantityPerItem: weightMap,
  repeatCustomers: z.object({
    loyalShare: z.number().gt(0).lt(1),
    repeatShare: z.number().gt(0).lt(1),
  }),
  salePriceVariance: z.object({
    discountChance: z.number().min(0).max(1),
    minMultiplier: z.number().gt(0).lte(1),
    maxMultiplier: z.number().gt(0).lte(1),
  }),
  statusWeights: z.object({
    settled: weightMap,
    recent: weightMap,
    recentWindowDays: z.number().int().positive(),
  }),
  inactiveProductShare: z.number().min(0).lt(1),
});

export type Vocabulary = z.infer<typeof vocabularySchema>;
export type GenerationProfile = z.infer<typeof profileSchema>;
export type ProductCategory = z.infer<typeof categorySchema>;
export type Location = z.infer<typeof locationSchema>;

/**
 * Volumes and the seed. Defaults match `.env.example`, so the documented
 * dataset is what you get with no environment at all.
 */
const seedEnvSchema = z.object({
  SEED_RANDOM_SEED: z.coerce.number().int().default(20_260_818),
  SEED_CUSTOMERS: z.coerce.number().int().min(1).max(100_000).default(500),
  SEED_PRODUCTS: z.coerce.number().int().min(1).max(10_000).default(100),
  SEED_ORDERS: z.coerce.number().int().min(1).max(1_000_000).default(10_000),
  SEED_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  // A fixed anchor, not "today". Anchoring to the clock would make the dataset
  // change daily and break the reproducibility the plan requires.
  SEED_END_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'SEED_END_DATE must be YYYY-MM-DD')
    .default('2026-08-18'),
});

export interface SeedSettings {
  seed: number;
  customers: number;
  products: number;
  orders: number;
  months: number;
  /** Last calendar day covered by the generated order history, inclusive. */
  endDate: string;
}

export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

export function loadSeedSettings(env: NodeJS.ProcessEnv = process.env): SeedSettings {
  const parsed = seedEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new SeedConfigError(
      `Invalid seed configuration:\n  - ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n  - ')}`,
    );
  }

  const value = parsed.data;

  return {
    seed: value.SEED_RANDOM_SEED,
    customers: value.SEED_CUSTOMERS,
    products: value.SEED_PRODUCTS,
    orders: value.SEED_ORDERS,
    months: value.SEED_MONTHS,
    endDate: value.SEED_END_DATE,
  };
}

/** Committed seed assets, resolved the same way migrations are. */
export function seedsDir(): string {
  if (process.env.SEEDS_DIR) {
    return process.env.SEEDS_DIR;
  }
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  return path.resolve(packageRoot, '../../data/postgres/seeds');
}

function readJson(directory: string, fileName: string): unknown {
  const file = path.join(directory, fileName);

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new SeedConfigError(
      `Could not read ${file}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

export function loadVocabulary(directory: string = seedsDir()): Vocabulary {
  const parsed = vocabularySchema.safeParse(readJson(directory, 'vocabulary.json'));

  if (!parsed.success) {
    throw new SeedConfigError(`vocabulary.json is invalid: ${parsed.error.issues[0]?.message}`);
  }

  for (const category of parsed.data.categories) {
    const [low, high] = category.priceBand;
    if (high <= low) {
      throw new SeedConfigError(
        `Category ${category.name} has an empty price band [${low}, ${high}]`,
      );
    }
  }

  return parsed.data;
}

export function loadGenerationProfile(directory: string = seedsDir()): GenerationProfile {
  const parsed = profileSchema.safeParse(readJson(directory, 'generation-profile.json'));

  if (!parsed.success) {
    throw new SeedConfigError(
      `generation-profile.json is invalid: ${parsed.error.issues[0]?.message}`,
    );
  }

  const { minMultiplier, maxMultiplier } = parsed.data.salePriceVariance;
  if (maxMultiplier < minMultiplier) {
    throw new SeedConfigError(
      `salePriceVariance.maxMultiplier (${maxMultiplier}) is below minMultiplier (${minMultiplier})`,
    );
  }

  return parsed.data;
}
