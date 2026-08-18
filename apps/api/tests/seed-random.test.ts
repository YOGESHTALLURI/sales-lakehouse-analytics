import { describe, expect, it } from 'vitest';
import { SeededRandom, weightEntries } from '../src/seed/random.js';

describe('SeededRandom', () => {
  it('produces the same stream for the same seed', () => {
    const a = new SeededRandom(20_260_818);
    const b = new SeededRandom(20_260_818);

    const first = Array.from({ length: 50 }, () => a.next());
    const second = Array.from({ length: 50 }, () => b.next());

    expect(first).toEqual(second);
  });

  it('produces a different stream for a different seed', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);

    expect(Array.from({ length: 20 }, () => a.next())).not.toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it('rejects a non-integer seed rather than silently producing NaN', () => {
    expect(() => new SeededRandom(1.5)).toThrow(TypeError);
    expect(() => new SeededRandom(Number.NaN)).toThrow(TypeError);
  });

  it('stays within [0, 1)', () => {
    const random = new SeededRandom(7);

    for (let i = 0; i < 5_000; i++) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads roughly uniformly across ten buckets', () => {
    const random = new SeededRandom(99);
    const buckets = new Array(10).fill(0);

    for (let i = 0; i < 100_000; i++) {
      buckets[Math.floor(random.next() * 10)]!++;
    }

    // A badly seeded or truncated generator collapses into a few buckets.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9_000);
      expect(count).toBeLessThan(11_000);
    }
  });

  describe('int', () => {
    it('includes both bounds', () => {
      const random = new SeededRandom(3);
      const seen = new Set<number>();

      for (let i = 0; i < 500; i++) seen.add(random.int(1, 5));

      expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles a single-value range', () => {
      expect(new SeededRandom(1).int(4, 4)).toBe(4);
    });

    it('rejects an inverted range', () => {
      expect(() => new SeededRandom(1).int(5, 1)).toThrow(RangeError);
    });
  });

  describe('weighted', () => {
    it('respects relative weights', () => {
      const random = new SeededRandom(11);
      const counts = { rare: 0, common: 0 };

      for (let i = 0; i < 20_000; i++) {
        counts[
          random.weighted([
            { value: 'rare' as const, weight: 1 },
            { value: 'common' as const, weight: 9 },
          ])
        ]++;
      }

      expect(counts.common / (counts.common + counts.rare)).toBeCloseTo(0.9, 1);
    });

    it('never returns a zero-weight entry', () => {
      const random = new SeededRandom(13);

      for (let i = 0; i < 1_000; i++) {
        expect(
          random.weighted([
            { value: 'never', weight: 0 },
            { value: 'always', weight: 1 },
          ]),
        ).toBe('always');
      }
    });

    it('rejects a list with no positive weight', () => {
      expect(() => new SeededRandom(1).weighted([{ value: 'x', weight: 0 }])).toThrow(RangeError);
    });

    it('rejects a negative weight', () => {
      expect(() =>
        new SeededRandom(1).weighted([
          { value: 'x', weight: -1 },
          { value: 'y', weight: 1 },
        ]),
      ).toThrow(RangeError);
    });
  });

  describe('shuffle and sample', () => {
    it('does not mutate the caller array', () => {
      const original = [1, 2, 3, 4, 5];
      new SeededRandom(5).shuffle(original);

      expect(original).toEqual([1, 2, 3, 4, 5]);
    });

    it('is a permutation', () => {
      const shuffled = new SeededRandom(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);

      expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('samples distinct items', () => {
      const sample = new SeededRandom(17).sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);

      expect(sample).toHaveLength(4);
      expect(new Set(sample).size).toBe(4);
    });

    it('throws rather than quietly returning fewer than requested', () => {
      expect(() => new SeededRandom(1).sample([1, 2], 3)).toThrow(RangeError);
    });
  });

  describe('uuid', () => {
    it('produces valid version 4 identifiers', () => {
      const random = new SeededRandom(20_260_818);
      const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

      for (let i = 0; i < 1_000; i++) {
        expect(random.uuid()).toMatch(pattern);
      }
    });

    it('does not collide across a dataset-sized draw', () => {
      const random = new SeededRandom(42);
      const ids = new Set<string>();

      for (let i = 0; i < 50_000; i++) ids.add(random.uuid());

      expect(ids.size).toBe(50_000);
    });

    it('is reproducible, which is what makes primary keys stable between runs', () => {
      expect(new SeededRandom(1).uuid()).toBe(new SeededRandom(1).uuid());
    });
  });
});

describe('weightEntries', () => {
  it('sorts keys so the stream cannot depend on JSON key order', () => {
    const fromOneOrder = weightEntries({ b: 1, a: 2, c: 3 });
    const fromAnother = weightEntries({ c: 3, b: 1, a: 2 });

    expect(fromOneOrder.map((e) => e.value)).toEqual(['a', 'b', 'c']);
    expect(fromOneOrder).toEqual(fromAnother);
  });
});
