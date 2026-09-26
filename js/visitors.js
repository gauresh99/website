/**
 * Squad number.
 *
 * Football shirt number for whoever is reading the page. It is a random number
 * in [100, 9999], generated once per page load and kept in memory so the
 * header and the shirt on the pitch agree.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * This is not, and must not be labelled as, a visitor count. It is a random
 * squad number for the current page session.
 *
 * It is not a count because there is nothing here that could count. The site is
 * static, makes no network request, and has no server to keep a tally on. Two
 * browsers will show two unrelated numbers, and neither will ever go up because
 * somebody else visited.
 *
 * The honest way to get a real number, if that is ever wanted: a Cloudflare
 * Worker with a KV counter on your own domain. Roughly twenty lines. It costs
 * one `connect-src` entry in the CSP, and it means a request per visit lands in
 * a log you own. Swap the body of getPlayerNumber() for that fetch and delete
 * this comment; nothing else on the site has to change.
 * ---------------------------------------------------------------------------
 */

/* Held in memory for the life of the page, not in storage: the header and the
   shirt on the pitch must agree, but the number should be new next visit. */
let sessionNumber = null;
const MIN = 100;
const MAX = 10000;

/**
 * Rejection sampling over crypto random, so the distribution is actually flat.
 * `% range` would bias toward the low end of the range; it would not matter
 * here, but getting it wrong on purpose is a bad habit.
 */
function randomInRange(min, max) {
  const range = max - min + 1;

  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const limit = Math.floor(0xffffffff / range) * range;
    const buf = new Uint32Array(1);
    for (let attempt = 0; attempt < 8; attempt++) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return min + (buf[0] % range);
    }
  }

  return min + Math.floor(Math.random() * range);
}

/**
 * @returns {Promise<{ number: number|null, label: string, exact: boolean }>}
 *   `number` null means the caller should hide the widget entirely.
 *   `exact` is true because the assigned shirt number is exact. It is still
 *   not a measured visitor count.
 */
export async function getPlayerNumber() {
  try {
    if (sessionNumber === null) sessionNumber = randomInRange(MIN, MAX);
    return { number: sessionNumber, label: 'Player', exact: true };
  } catch {
    return { number: null, label: '', exact: false };
  }
}
