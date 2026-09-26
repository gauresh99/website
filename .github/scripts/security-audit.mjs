#!/usr/bin/env node
/**
 * Static security gate. Fails the build on the things that can be checked
 * without running a browser.
 *
 *   node .github/scripts/security-audit.mjs
 *
 * Owned by the SECURITY agent. Every check exists because a specific control
 * in SECURITY.md depends on it staying true; each failure prints the control
 * it breaks, not just a pattern name.
 *
 * Deliberately dependency-free: adding a linter here would add the exact
 * supply-chain surface the rest of this project is built to avoid.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const findings = [];
const notes = [];

function fail(check, file, line, message, fix) {
  findings.push({ check, file, line, message, fix });
}
function note(message) {
  notes.push(message);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === '.github' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = walk(ROOT);
const rel = (f) => relative(ROOT, f);
const byExt = (ext) => ALL_FILES.filter((f) => extname(f) === ext);
const SOURCE_JS = byExt('.js').filter((f) => !rel(f).startsWith('test/'));
const CSS = byExt('.css');
const HTML = byExt('.html');

/**
 * Blank out comments and string bodies so a pattern named inside a comment (or
 * a URL inside a string literal) is not reported as a live call site.
 * Positions are preserved so line/column numbers stay accurate.
 */
function blankNonCode(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let inLine = false;
  let inBlock = false;
  let quote = null;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (c === '\n') inLine = false;
      else out[i] = ' ';
    } else if (inBlock) {
      if (c === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        inBlock = false;
        continue;
      }
      if (c !== '\n') out[i] = ' ';
    } else if (quote) {
      if (c === '\\') {
        out[i] = ' ';
        if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      else if (c !== '\n') out[i] = ' ';
    } else if (c === '/' && next === '/') {
      inLine = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    } else if (c === '/' && next === '*') {
      inBlock = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    }
    i += 1;
  }
  return out.join('');
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

function scan(src, pattern) {
  const hits = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    hits.push({ index: m.index, match: m[0] });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return hits;
}

/* ================================================================== *
 * 1. CSP integrity across the three deployment files
 * ================================================================== */

function readCsp() {
  const values = {};
  const headersPath = join(ROOT, 'public/_headers');
  if (existsSync(headersPath)) {
    const m = /^ {2}Content-Security-Policy: (.*)$/m.exec(readFileSync(headersPath, 'utf8'));
    if (m) values['public/_headers'] = m[1].trim();
  }
  const tomlPath = join(ROOT, 'netlify.toml');
  if (existsSync(tomlPath)) {
    const m = /Content-Security-Policy\s*=\s*"([^"]*)"/.exec(readFileSync(tomlPath, 'utf8'));
    if (m) values['netlify.toml'] = m[1].trim();
  }
  const vercelPath = join(ROOT, 'vercel.json');
  if (existsSync(vercelPath)) {
    try {
      const doc = JSON.parse(readFileSync(vercelPath, 'utf8'));
      for (const rule of doc.headers ?? []) {
        for (const h of rule.headers ?? []) {
          if (h.key === 'Content-Security-Policy') values['vercel.json'] = String(h.value).trim();
        }
      }
    } catch (err) {
      fail('csp', 'vercel.json', 0, `not valid JSON: ${err.message}`, 'fix the JSON syntax');
    }
  }
  return values;
}

const csps = readCsp();
const cspFiles = Object.keys(csps);

if (cspFiles.length < 3) {
  fail('csp', 'deployment files', 0,
    `expected a CSP in all three of public/_headers, netlify.toml, vercel.json; found ${cspFiles.length}`,
    'restore the missing file — a host without a policy serves the site unprotected');
} else {
  const distinct = new Set(Object.values(csps));
  if (distinct.size !== 1) {
    fail('csp', 'deployment files', 0,
      `the three deployment files carry ${distinct.size} DIFFERENT policies:\n` +
      cspFiles.map((f) => `        ${f}\n          ${csps[f]}`).join('\n'),
      'make them identical — a policy that is strict on one host and loose on another is the loose one');
  }
}

const CSP = Object.values(csps)[0] ?? '';

// The two directives that would hand XSS back everything the rest of this
// project spent its effort taking away.
for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"]) {
  if (CSP.includes(banned)) {
    fail('csp', 'deployment files', 0,
      `CSP contains ${banned}`,
      'remove it and fix the code that needed it — see SECURITY.md, this is never the right trade');
  }
}
if (/(^|[\s;])(default-src|script-src|style-src|connect-src)[^;]*\*/.test(CSP)) {
  fail('csp', 'deployment files', 0, 'CSP uses a wildcard source on a fetch directive',
    "name the origin explicitly, or use 'self'");
}
for (const required of ['default-src', 'base-uri', 'form-action', 'frame-ancestors', 'object-src']) {
  if (!new RegExp(`(^|;)\\s*${required}\\s`).test(CSP)) {
    fail('csp', 'deployment files', 0, `CSP is missing ${required}`,
      required === 'base-uri'
        ? 'without base-uri an injected <base> rewrites every relative URL on the page'
        : 'this directive does not inherit from default-src and must be stated explicitly');
  }
}

const REQUIRES_TRUSTED_TYPES = /require-trusted-types-for\s+'script'/.test(CSP);

/* ================================================================== *
 * 1b. Publish-root hygiene
 * ================================================================== */

const FORBIDDEN_PUBLIC_FILES = [
  [/(^|\/)\.DS_Store$/i, 'macOS Finder metadata file'],
  [/(^|\/)\.env(?:\.|$)/i, 'environment file'],
  [/(^|\/)SECRETS\.md$/i, 'secrets document'],
  [/\.(?:pem|key|p12|pfx)$/i, 'private key or certificate material'],
];

for (const file of ALL_FILES) {
  const name = rel(file).replace(/\\/g, '/');
  for (const [pattern, label] of FORBIDDEN_PUBLIC_FILES) {
    if (!pattern.test(name)) continue;
    fail('publish-root', name, 0,
      `${label} is inside the website publish tree`,
      'remove it from the website folder; ignored local files still become public if someone deploys the directory directly');
  }
}

/* ================================================================== *
 * 2. HTML-injection sinks in JavaScript
 * ================================================================== */

const JS_SINKS = [
  [/\.innerHTML\s*=/, 'assigns to innerHTML',
    'build nodes with createElement + textContent, or clone a <template>'],
  [/\.outerHTML\s*=/, 'assigns to outerHTML', 'replace the node instead'],
  [/\.insertAdjacentHTML\s*\(/, 'calls insertAdjacentHTML',
    'use insertAdjacentElement with a built node'],
  [/document\s*\.\s*write(ln)?\s*\(/, 'calls document.write', 'append nodes to the DOM instead'],
  [/(^|[^.\w$])eval\s*\(/, 'calls eval', 'there is no use for eval in this codebase'],
  [/new\s+Function\s*\(/, 'calls new Function', 'this is eval by another name'],
  [/\bsetTimeout\s*\(\s*['"`]/, 'passes a STRING to setTimeout', 'pass a function'],
  [/\bsetInterval\s*\(\s*['"`]/, 'passes a STRING to setInterval', 'pass a function'],
  [/\.srcdoc\s*=/, 'sets iframe srcdoc', 'the CSP forbids frames entirely'],
  [/\bdangerouslySetInnerHTML\b/, 'uses dangerouslySetInnerHTML', 'not applicable here'],
];

for (const file of SOURCE_JS) {
  const raw = readFileSync(file, 'utf8');
  const code = blankNonCode(raw);
  for (const [pattern, message, fix] of JS_SINKS) {
    for (const hit of scan(code, pattern)) {
      fail('sink', rel(file), lineOf(raw, hit.index), message, fix);
    }
  }
}

/* ================================================================== *
 * 3. External origins — anything that would silently break the CSP
 * ================================================================== */

// Only SUBRESOURCE loads break the CSP. An <a href> is a navigation the
// visitor chooses to follow, and the CSP has nothing to say about it — that
// one is sanitize.safeHref's job, checked separately below.
const SUBRESOURCE_SRC = /<(?!a\b|area\b)[a-z][a-z0-9-]*\b[^>]*?\ssrc\s*=\s*["']\s*(?:https?:)?\/\/[^"']+/gi;
const SUBRESOURCE_LINK = /<link\b[^>]*?\shref\s*=\s*["']\s*(?:https?:)?\/\/[^"']+/gi;
const EXTERNAL_IN_CSS = /@import|url\(\s*["']?\s*(?:https?:)?\/\//gi;

for (const file of HTML) {
  const raw = readFileSync(file, 'utf8');
  for (const pattern of [SUBRESOURCE_SRC, SUBRESOURCE_LINK]) {
    for (const hit of scan(raw, pattern)) {
      fail('external', rel(file), lineOf(raw, hit.index),
        `loads a subresource from an external origin: ${hit.match.slice(0, 70)}`,
        "self-host it — the CSP is default-src 'none' with only 'self' opened, so this will be blocked in production");
    }
  }

  // Static markup may legitimately link out, but never to a script-capable
  // scheme. This is the markup-side counterpart of sanitize.safeHref.
  for (const hit of scan(raw, /\shref\s*=\s*["']\s*(?:javascript|data|vbscript|file|blob)\s*:/gi)) {
    fail('external', rel(file), lineOf(raw, hit.index),
      `link to a script-capable or non-navigable scheme: ${hit.match.trim().slice(0, 50)}`,
      'only http(s) and mailto belong in an href — see js/sanitize.js safeHref');
  }
}
for (const file of CSS) {
  const raw = readFileSync(file, 'utf8');
  for (const hit of scan(raw, EXTERNAL_IN_CSS)) {
    fail('external', rel(file), lineOf(raw, hit.index),
      `external stylesheet or asset reference: ${hit.match.slice(0, 70)}`,
      'self-host the font/asset into assets/ — a CDN font is a third-party request AND a CSP violation');
  }
}

// In JS, only network APIs matter; a URL sitting in content data is a link,
// not a fetch, and is handled by sanitize.safeHref.
const NETWORK_CALLS = /\b(?:fetch|XMLHttpRequest|sendBeacon|EventSource|WebSocket|importScripts)\s*\(|new\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(|\bimport\s*\(\s*['"`]https?:/g;
for (const file of SOURCE_JS) {
  const raw = readFileSync(file, 'utf8');
  const code = blankNonCode(raw);
  for (const hit of scan(code, NETWORK_CALLS)) {
    fail('external', rel(file), lineOf(raw, hit.index),
      `network API call (${hit.match.trim()}) — the CSP sets connect-src 'none'`,
      'this site makes no network requests after load; if one is genuinely needed it must be justified in SECURITY.md and the CSP widened deliberately');
  }
}

/* ================================================================== *
 * 4. Inline script / style — blocked by this CSP
 * ================================================================== */

for (const file of HTML) {
  const raw = readFileSync(file, 'utf8');

  for (const hit of scan(raw, /<script(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi)) {
    const body = hit.match.replace(/<[^>]*>/g, '').trim();
    if (!body) continue; // empty tag, harmless
    if (/type\s*=\s*["'](application\/json|application\/ld\+json|text\/plain)["']/i.test(hit.match)) continue;
    fail('inline', rel(file), lineOf(raw, hit.index),
      "inline <script> block — script-src 'self' will refuse to run it",
      'move it to a file under js/ and load it with <script type="module" src="...">');
  }

  for (const hit of scan(raw, /<style[^>]*>[\s\S]*?<\/style>/gi)) {
    fail('inline', rel(file), lineOf(raw, hit.index),
      "inline <style> block — style-src 'self' will refuse to apply it",
      'move it into css/');
  }

  for (const hit of scan(raw, /\sstyle\s*=\s*["'][^"']+["']/gi)) {
    fail('inline', rel(file), lineOf(raw, hit.index),
      "inline style=\"\" attribute — blocked by style-src without 'unsafe-inline'",
      'use a class, or set it from JS via element.style (CSSOM is NOT blocked by CSP)');
  }

  for (const hit of scan(raw, /\son(?:click|load|error|mouseover|focus|blur|submit|change|input|keydown|keyup)\s*=\s*["'][^"']*["']/gi)) {
    fail('inline', rel(file), lineOf(raw, hit.index),
      `inline event handler attribute (${hit.match.trim().split('=')[0].trim()}) — blocked by script-src`,
      'use addEventListener from a module');
  }

  for (const hit of scan(raw, /<base\b/gi)) {
    fail('inline', rel(file), lineOf(raw, hit.index),
      "<base> element present while CSP sets base-uri 'none'",
      "remove it; relative URLs resolve against the document URL already");
  }
}

/* ================================================================== *
 * 5. Trusted Types consistency
 * ================================================================== */

if (REQUIRES_TRUSTED_TYPES) {
  for (const file of SOURCE_JS) {
    const raw = readFileSync(file, 'utf8');
    const code = blankNonCode(raw);
    for (const hit of scan(code, /trustedTypes\s*\.\s*createPolicy/g)) {
      fail('trusted-types', rel(file), lineOf(raw, hit.index),
        "creates a Trusted Types policy while CSP sets trusted-types 'none'",
        'this will throw at runtime; build nodes instead of needing a policy');
    }
  }
}

/* ================================================================== *
 * 6. Unguarded storage access
 * ================================================================== */

// localStorage is not merely absent in some privacy configurations — the
// getter itself throws SecurityError. An unguarded read takes the page down.
for (const file of SOURCE_JS) {
  const raw = readFileSync(file, 'utf8');
  const code = blankNonCode(raw);
  for (const hit of scan(code, /\b(?:localStorage|sessionStorage|indexedDB)\b/g)) {
    // Is this occurrence lexically inside a try block?
    const before = code.slice(0, hit.index);
    let depth = 0;
    let guarded = false;
    const tryStarts = [];
    for (const t of scan(before, /\btry\s*\{/g)) tryStarts.push(t.index);
    for (const start of tryStarts) {
      depth = 0;
      let closed = -1;
      for (let i = start; i < code.length; i += 1) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') {
          depth -= 1;
          if (depth === 0) { closed = i; break; }
        }
      }
      if (closed === -1 || closed > hit.index) { guarded = true; break; }
    }
    if (!guarded) {
      fail('storage', rel(file), lineOf(raw, hit.index),
        `unguarded ${hit.match} access`,
        'wrap it in try/catch — the accessor itself throws SecurityError when site data is blocked, and an unguarded read is a blank page for that visitor');
    }
  }
}

/* ================================================================== *
 * 7. Informational: things worth seeing, not worth failing on
 * ================================================================== */

if (!HTML.length) note('no index.html present yet — inline script/style checks had nothing to scan');
if (!existsSync(join(ROOT, 'js/site.js'))) note('js/site.js not present yet — UI agent output not audited by this run');
if (!existsSync(join(ROOT, 'js/game/index.js'))) note('js/game/index.js not present yet — GAME agent output not audited by this run');

const usesDataUri = CSS.some((f) => /url\(\s*["']?data:/i.test(readFileSync(f, 'utf8')))
  || HTML.some((f) => /["']data:/i.test(readFileSync(f, 'utf8')));
if (CSP.includes('img-src') && CSP.includes('data:') && !usesDataUri) {
  note("CSP allows data: in img-src but nothing uses a data: URI — tighten to \"img-src 'self'\" if this stays true at ship time");
}

/* ================================================================== *
 * Report
 * ================================================================== */

const GROUP_TITLES = {
  csp: 'Content-Security-Policy integrity',
  sink: 'HTML-injection sink',
  external: 'External origin / network call',
  inline: 'Inline script or style (CSP violation)',
  'trusted-types': 'Trusted Types',
  storage: 'Unguarded storage access',
  'publish-root': 'Publish-root hygiene',
};

console.log('Security audit\n' + '='.repeat(60));
console.log(`scanned: ${SOURCE_JS.length} js, ${CSS.length} css, ${HTML.length} html\n`);

if (findings.length) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.check)) groups.set(f.check, []);
    groups.get(f.check).push(f);
  }
  for (const [check, items] of groups) {
    console.log(`\n${GROUP_TITLES[check] ?? check}`);
    console.log('-'.repeat(60));
    for (const f of items) {
      console.log(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
      console.log(`      ${f.message}`);
      console.log(`      fix: ${f.fix}`);
    }
  }
}

for (const n of notes) console.log(`  note: ${n}`);

console.log('\n' + '='.repeat(60));
if (findings.length) {
  console.log(`FAIL — ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('PASS — no findings');
