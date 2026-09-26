/**
 * Deterministic pseudo-random numbers.
 *
 * Math.random() cannot be seeded, which means a run cannot be reproduced and a
 * physics bug cannot be replayed. mulberry32 is 32 bits of state, one multiply
 * and a few shifts — cheaper than Math.random() and repeatable from a seed.
 *
 * Everything the simulation randomises (keeper dives, aim spread, particle
 * velocities) comes from here, so a seed plus an input sequence reproduces a
 * run exactly. That is what makes "deterministic" a testable claim rather than
 * a word in a comment.
 */

/** @typedef {{ s: number, seed(n: number): void, next(): number,
 *   range(a: number, b: number): number, int(n: number): number,
 *   gauss(): number, chance(p: number): boolean }} Rng */

/** @returns {Rng} */
export function createRng(seed) {
  return {
    s: (seed >>> 0) || 0x9e3779b9,
    /** @param {number} n */
    seed(n) { this.s = (n >>> 0) || 0x9e3779b9; },
    /** Uniform in [0, 1). */
    next() {
      let t = (this.s += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) { return a + (b - a) * this.next(); },
    int(n) { return (this.next() * n) | 0; },
    /** Approximate standard normal. The sum of three uniforms is close enough
     *  for aim spread and far cheaper than Box-Muller, which needs a log, a
     *  sqrt and two trig calls — and whose cached-second-value trick is state
     *  we would then have to serialise to stay deterministic. */
    gauss() {
      return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
    },
    chance(p) { return this.next() < p; },
  };
}

/**
 * A "bag" (deck) randomiser over an index range.
 *
 * Used for commentary lines. Picking uniformly at random says "Top corner."
 * twice in a row often enough to look broken; a shuffled bag walks every line
 * once before any repeats. The permutation is allocated once at mount and
 * reshuffled in place, so drawing from it never allocates.
 */
export function createBag(size, rng) {
  const order = new Int32Array(size);
  for (let i = 0; i < size; i++) order[i] = i;
  let cursor = size; // force a shuffle on first draw
  return {
    size,
    /** Fisher-Yates, in place. */
    shuffle() {
      for (let i = size - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      cursor = 0;
    },
    draw() {
      if (size === 0) return -1;
      if (cursor >= size) this.shuffle();
      return order[cursor++];
    },
  };
}

/** Cheap string hash, so a project id can seed a round reproducibly. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
