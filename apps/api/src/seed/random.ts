/**
 * Deterministic pseudo-random source for the synthetic-data generator.
 *
 * `Math.random` cannot be seeded, and seeding a third-party faker only fixes
 * that library's stream — upgrading it silently changes every generated row.
 * The plan requires that a documented seed plus requested counts produce the
 * same dataset on any machine, so the algorithm lives here, in this repository,
 * where it is version-controlled alongside the data it produces.
 *
 * mulberry32: 32-bit state, integer arithmetic only, no dependence on floating
 * point behaviour, locale, platform or clock. Not cryptographically secure and
 * not meant to be — reproducibility is the requirement.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new TypeError(`Seed must be an integer, received ${String(seed)}`);
    }
    // Force to unsigned 32-bit so a negative or oversized seed still gives a
    // stable, documented starting state rather than NaN propagation.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (max < min) {
      throw new RangeError(`Empty range: int(${min}, ${max})`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Cannot pick from an empty array');
    }
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Pick by relative weight. Weights need not sum to anything in particular;
   * zero-weight entries are never chosen.
   */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T {
    if (entries.length === 0) {
      throw new RangeError('Cannot pick from an empty weighted list');
    }

    let total = 0;
    for (const entry of entries) {
      if (entry.weight < 0 || !Number.isFinite(entry.weight)) {
        throw new RangeError(`Weight must be a finite non-negative number, got ${entry.weight}`);
      }
      total += entry.weight;
    }

    if (total <= 0) {
      throw new RangeError('Weighted list has no positive weight');
    }

    let threshold = this.next() * total;
    for (const entry of entries) {
      threshold -= entry.weight;
      if (threshold < 0) {
        return entry.value;
      }
    }

    // Only reachable through floating-point accumulation error.
    return entries[entries.length - 1]!.value;
  }

  /** Fisher-Yates on a copy, so the caller's array is untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /** Distinct sample of `count` items. Throws rather than silently returning fewer. */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) {
      throw new RangeError(`Cannot sample ${count} items from a list of ${items.length}`);
    }
    return this.shuffle(items).slice(0, count);
  }

  /**
   * A UUID v4-shaped identifier drawn from this stream.
   *
   * Generating keys here rather than letting PostgreSQL default them makes the
   * whole dataset byte-identical between runs, primary keys included — which is
   * what lets a test lock reproducibility to a single checksum.
   */
  uuid(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = this.int(0, 255);
    }

    // Version 4, RFC 4122 variant.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}

/** Convert a weight map keyed by string into the shape `weighted` expects. */
export function weightEntries<T extends string>(
  weights: Record<T, number>,
): { value: T; weight: number }[] {
  // Sorted so iteration order cannot depend on object construction order,
  // which would make the stream depend on how the JSON happened to be written.
  return (Object.keys(weights) as T[])
    .sort()
    .map((value) => ({ value, weight: weights[value] }));
}
