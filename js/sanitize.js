/**
 * js/sanitize.js — hardening for untrusted values. Owned by the SECURITY agent.
 *
 * Two functions, both total: they return a string for every possible input and
 * never throw, no matter what is handed to them (Proxy traps that throw,
 * null-prototype objects, Symbols, lone surrogates, 10MB strings).
 * Callers may use the result unconditionally without a try/catch of their own.
 *
 * WHAT THESE DO AND DO NOT DO — read this before relying on them.
 *
 * `text()` is NOT what stops XSS on this site. `Node.textContent` is: it never
 * parses markup, so a string assigned to it cannot become an element. `text()`
 * exists for three narrower reasons:
 *   1. It guarantees a primitive string, so a caller cannot accidentally hand
 *      an object (or a getter that throws) to the DOM and get "[object
 *      Object]" or a crash mid-render.
 *   2. It removes characters that change how text *renders* without changing
 *      what it says — bidi overrides (the "Trojan Source" class), invisible
 *      separators, C0/C1 controls.
 *   3. Defence in depth if a future caller is careless.
 * It deliberately does NOT escape `<` and `>`. Escaping them would corrupt
 * honest content ("n < 10", "List<T>") and would only matter if a caller piped
 * the result into innerHTML — which the contract forbids and CI greps for.
 * Fixing a banned pattern by mangling every string is the wrong trade.
 *
 * `safeHref()` IS a real control. An attacker-influenced href is a live script
 * execution sink (`javascript:`), so this uses an allowlist, not a denylist,
 * and returns the parser-normalised URL rather than the caller's input.
 */

/** Longest string `text()` will emit. Bounds a pathological-input render stall. */
const MAX_TEXT_LENGTH = 20000;

/** Longest input `safeHref()` will look at. Comfortably over any real link. */
const MAX_URL_LENGTH = 2048;

/** The only schemes that may ever reach an href. */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Characters stripped from text. Each is here for a reason:
 *  - C0 controls except TAB/LF/CR, plus DEL and the C1 block: non-printing,
 *    and some terminals/log viewers act on them.
 *  - U+200B ZERO WIDTH SPACE and U+FEFF BOM: invisible, used to break up
 *    strings so a human reviewer reads something other than what is stored.
 *  - U+200E/200F LRM/RLM and U+202A-202E / U+2066-2069 (bidi embeddings,
 *    overrides and isolates): reorder rendered text independently of its
 *    logical content. This is the Trojan Source vector, and it is equally a
 *    way to make a displayed URL or job title read as something it is not.
 * U+200C ZWNJ and U+200D ZWJ are deliberately KEPT: they are load-bearing in
 * Devanagari and Persian orthography and in emoji sequences. Stripping them
 * would corrupt real names.
 */
const STRIP_PATTERN =
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F' +
  '\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]';

/**
 * Built with `new RegExp` rather than as literals so that an engine without
 * Unicode property escapes fails here, at runtime, in a try/catch — instead of
 * throwing a SyntaxError at parse time and taking the whole module down.
 */
function compile(source, flags) {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

const STRIP_RE = compile(STRIP_PATTERN, 'g');
const CRLF_RE = compile('\\r\\n?', 'g');
/** Caps a run of combining marks. Zalgo text escapes its box and covers UI. */
const COMBINING_RUN_RE = compile('(\\p{M}{8})\\p{M}+', 'gu');
const SCHEME_RE = compile('^([A-Za-z][A-Za-z0-9+\\-.]*):', '');
/** Tab, LF and CR are removed from ANYWHERE in a URL by the WHATWG parser. */
const URL_INNER_WS_RE = compile('[\\u0009\\u000A\\u000D]', 'g');
/** The parser also trims leading and trailing C0 controls and spaces. */
const URL_EDGE_WS_RE = compile('^[\\u0000-\\u0020]+|[\\u0000-\\u0020]+$', 'g');
/** `//host` and every backslash spelling of it. */
const PROTOCOL_RELATIVE_RE = compile('^[/\\\\]{2}', '');
const SAFE_HOST_RE = compile('^[a-z0-9._-]+$', '');
const MAILTO_ADDR_RE = compile('^[^\\s@,;:<>()\\[\\]\\\\]+@[^\\s@,;:<>()\\[\\]\\\\]+\\.[^\\s@,;:<>()\\[\\]\\\\]+$', '');
/** Encoded or literal newline anywhere in a mailto: mail-client header injection. */
const MAIL_HEADER_INJECTION_RE = compile('%0a|%0d|[\\r\\n]', 'i');

/**
 * Coerce anything to a string without trusting it to cooperate.
 * `String(value)` runs user code (toString, valueOf, Symbol.toPrimitive, Proxy
 * traps) and throws outright for null-prototype objects.
 */
function stringify(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  switch (typeof value) {
    case 'number':
      // NaN and Infinity are not content; printing them is a bug made visible.
      return Number.isFinite(value) ? String(value) : '';
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
    case 'function':
      // Both stringify to something meaningless-to-hostile. Drop them.
      return '';
    default:
      break;
  }

  try {
    const coerced = String(value);
    return typeof coerced === 'string' ? coerced : '';
  } catch {
    return '';
  }
}

/**
 * Replace unpaired surrogates with U+FFFD. Lone surrogates survive in JS
 * strings but are not valid text, and they behave inconsistently across
 * serialisation boundaries. `toWellFormed` is newer than our support floor, so
 * there is a hand-rolled path behind it.
 */
function toWellFormed(input) {
  if (typeof input.toWellFormed === 'function') {
    try {
      return input.toWellFormed();
    } catch {
      /* fall through */
    }
  }

  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      // NaN (past the end) compares false, so an unpaired trailing high
      // surrogate correctly falls to the replacement branch.
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i += 1;
      } else {
        out += '�';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '�';
    } else {
      out += input[i];
    }
  }
  return out;
}

function applyIfCompiled(pattern, input, replacement) {
  if (!pattern) return input;
  try {
    return input.replace(pattern, replacement);
  } catch {
    return input;
  }
}

/**
 * Safe text-node content for an untrusted value.
 *
 * Always returns a string. Never throws. The result is intended for
 * `textContent` / `createTextNode`, NOT for `innerHTML`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function text(value) {
  try {
    let out = stringify(value);
    if (!out) return '';

    // Truncate first so every later pass is bounded, then repair the cut: a
    // slice can land between a surrogate pair and leave half a character.
    if (out.length > MAX_TEXT_LENGTH) out = out.slice(0, MAX_TEXT_LENGTH);
    out = toWellFormed(out);

    out = applyIfCompiled(CRLF_RE, out, '\n');
    out = applyIfCompiled(STRIP_RE, out, '');

    // NFC after stripping, so a stripped character cannot have been hiding
    // inside a decomposed sequence.
    try {
      out = out.normalize('NFC');
    } catch {
      /* keep the un-normalised form */
    }

    out = applyIfCompiled(COMBINING_RUN_RE, out, '$1');
    return out;
  } catch {
    // Unreachable by design; present so the "never throws" contract holds
    // even if an engine surprises us.
    return '';
  }
}

/**
 * Vet a URL for use as an href.
 *
 * Returns the normalised absolute URL if it is http, https or mailto, and ''
 * for everything else — including every relative form. Never throws.
 *
 * Relative URLs return '' on purpose. Resolving them would need a base, and a
 * base is exactly what turns `//evil.example` from a parse error into a
 * same-scheme link to an attacker's host. In-page anchors are static markup the
 * UI author writes, not untrusted content, so they do not belong here.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function safeHref(url) {
  try {
    const raw = stringify(url);
    if (!raw || raw.length > MAX_URL_LENGTH) return '';
    if (typeof URL !== 'function') return ''; // fail closed, never fail open

    // Mirror the WHATWG parser's own stripping BEFORE inspecting the scheme.
    // Without this, `java\tscript:alert(1)` passes a naive prefix check and is
    // then reassembled into a live javascript: URL by the browser.
    let candidate = applyIfCompiled(URL_INNER_WS_RE, raw, '');
    candidate = applyIfCompiled(URL_EDGE_WS_RE, candidate, '');
    if (!candidate) return '';

    // Protocol-relative, including the backslash spellings that special
    // schemes normalise to forward slashes.
    if (PROTOCOL_RELATIVE_RE && PROTOCOL_RELATIVE_RE.test(candidate)) return '';

    // Require an explicitly allowed scheme up front. This is redundant with the
    // check on the parsed protocol below, and that is the point: a quirk in one
    // URL implementation should not be the only thing between a javascript:
    // URL and the DOM.
    if (!SCHEME_RE) return '';
    const schemeMatch = SCHEME_RE.exec(candidate);
    if (!schemeMatch) return ''; // no scheme at all -> relative -> rejected
    if (!ALLOWED_SCHEMES.has(schemeMatch[1].toLowerCase())) return '';

    let parsed;
    try {
      // No base argument. A base would resolve relative and protocol-relative
      // input into a passing absolute URL.
      parsed = new URL(candidate);
    } catch {
      return '';
    }

    const protocol = String(parsed.protocol || '').toLowerCase();
    if (!ALLOWED_SCHEMES.has(protocol.replace(/:$/, ''))) return '';

    if (protocol === 'mailto:') {
      const address = parsed.pathname;
      if (!address || address.length > 254) return '';
      if (!MAILTO_ADDR_RE || !MAILTO_ADDR_RE.test(address)) return '';
      // Newlines in a mailto can inject headers into the visitor's mail client.
      if (MAIL_HEADER_INJECTION_RE && MAIL_HEADER_INJECTION_RE.test(parsed.href)) return '';
      return parsed.href;
    }

    // http / https
    if (!parsed.hostname) return '';
    // Credentials in a URL are a display-spoofing device
    // (https://github.com@evil.example) and no honest link here needs them.
    if (parsed.username || parsed.password) return '';
    // The parser has already punycoded and lowercased the host, so anything
    // outside this set means something unusual happened.
    if (!SAFE_HOST_RE || !SAFE_HOST_RE.test(parsed.hostname)) return '';

    // Return the PARSED href, not the input. This is what neutralises IDN
    // homograph hosts: a Cyrillic-'a' apple.com comes back as its punycode,
    // so anything that later displays the href shows the real destination.
    return parsed.href;
  } catch {
    return '';
  }
}
