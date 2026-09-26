/**
 * Integration gate. Run from website/ with: node check.mjs
 * Checks the contract holds across every agent's output.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

let failures = 0;
let checks = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => { console.log(`  ok    ${m}`); };
const check = (cond, m) => { checks++; cond ? pass(m) : fail(m); };

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === '.claude' || e === 'dist') continue;
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const files = walk('.');
const code = files.filter((f) => ['.js', '.mjs', '.html', '.css'].includes(extname(f)));
const read = (f) => readFileSync(f, 'utf8');

console.log('\n— required files —');
for (const f of [
  'index.html', 'js/main.js', 'js/content.js', 'js/site.js',
  'js/sanitize.js', 'js/game/index.js', 'css/tokens.css', 'SECURITY.md',
]) check(existsSync(f), f);

console.log('\n— no external SUBRESOURCE requests (CSP would break) —');
// Outbound <a href> links are navigation, not a resource load, so they are fine.
// What breaks a strict CSP is a remote script/style/font/image being FETCHED.
const externals = [];
for (const f of code) {
  const src = read(f);
  for (const m of src.matchAll(/\bsrc\s*=\s*["'](?:https?:)?\/\/([^"']+)/gi)) {
    externals.push(`${f}: src //${m[1].slice(0, 60)}`);
  }
  for (const m of src.matchAll(/<link\b[^>]*\bhref\s*=\s*["'](?:https?:)?\/\/([^"']+)/gi)) {
    externals.push(`${f}: <link> //${m[1].slice(0, 60)}`);
  }
  for (const m of src.matchAll(/@import\s+(?:url\()?["']?(?:https?:)?\/\//gi)) {
    externals.push(`${f}: @import remote`);
  }
  for (const m of src.matchAll(/\burl\(\s*["']?(?:https?:)?\/\/([^)"']+)/gi)) {
    externals.push(`${f}: css url() //${m[1].slice(0, 60)}`);
  }
  for (const m of src.matchAll(/\bfetch\s*\(\s*["'](?:https?:)?\/\//gi)) {
    externals.push(`${f}: fetch remote`);
  }
}
check(externals.length === 0, externals.length ? `external refs:\n        ${externals.join('\n        ')}` : 'no external origins referenced');

console.log('\n— every module parses as ESM —');
// `node --check <file>` parses as CommonJS and happily accepts things that are
// syntax errors in a module, which is exactly how a broken hud.js passed a
// check and then failed in the browser. Parsing as a module is the only
// check that matches how these files are actually loaded.
{
  const { execFileSync } = await import('node:child_process');
  const modules = files.filter((f) => f.endsWith('.js') && !f.includes('node_modules'));
  const broken = [];
  for (const f of modules) {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'],
        { input: read(f), stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
      broken.push(`${f}: ${String(e.stderr).split('\n').find((l) => /Error/.test(l)) || 'parse failed'}`);
    }
  }
  check(broken.length === 0,
    broken.length ? `ESM parse failures:\n        ${broken.join('\n        ')}` : `${modules.length} modules parse as ESM`);
}

console.log('\n— no eval / Function constructor —');
const evals = code.filter((f) => /\beval\s*\(|new\s+Function\s*\(/.test(read(f)));
check(evals.length === 0, evals.length ? `eval found in ${evals.join(', ')}` : 'no eval or Function()');

console.log('\n— innerHTML discipline —');
const inner = [];
for (const f of code.filter((f) => f.endsWith('.js'))) {
  read(f).split('\n').forEach((line, i) => {
    if (/\.(innerHTML|outerHTML)\s*=/.test(line) || /insertAdjacentHTML/.test(line)) {
      inner.push(`${f}:${i + 1}  ${line.trim().slice(0, 70)}`);
    }
  });
}
// Static author-written markup is allowed; content data is not. Report for review.
if (inner.length) { console.log(`  note  ${inner.length} innerHTML site(s) — must be static markup only:`); inner.forEach((l) => console.log(`        ${l}`)); }
else pass('no innerHTML in JS at all');

console.log('\n— unguarded localStorage —');
const ls = [];
for (const f of code.filter((f) => f.endsWith('.js'))) {
  const src = read(f);
  if (!/localStorage|sessionStorage/.test(src)) continue;
  if (!/try\s*{/.test(src)) ls.push(f);
}
check(ls.length === 0, ls.length ? `storage without try/catch: ${ls.join(', ')}` : 'storage access guarded');

console.log('\n— reduced motion honoured —');
const cssSrc = files.filter((f) => f.endsWith('.css')).map(read).join('\n');
const jsSrc = files.filter((f) => f.endsWith('.js')).map(read).join('\n');
check(/prefers-reduced-motion/.test(cssSrc + jsSrc), 'prefers-reduced-motion referenced');

console.log('\n— dark mode —');
check(/prefers-color-scheme/.test(cssSrc), 'prefers-color-scheme referenced');

console.log('\n— required DOM ids —');
if (existsSync('index.html')) {
  const html = read('index.html');
  for (const id of ['app-root', 'mode-toggle', 'a11y-live', 'skip-link']) {
    check(html.includes(`id="${id}"`) || html.includes(`id='${id}'`), `#${id} present`);
  }
}

console.log('\n— CSP consistency across deploy targets —');
// Three copies of one policy is the shape that drifts. The meta fallback is
// allowed to lack frame-ancestors and only that, because browsers ignore it
// there; any other difference is a mistake.
if (existsSync('index.html') && existsSync('public/_headers')) {
  const norm = (s) => new Set(s.split(';').map((d) => d.trim()).filter(Boolean));
  const metaMatch = read('index.html').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  const hdrMatch = read('public/_headers').match(/Content-Security-Policy:\s*(.+)/i);
  check(Boolean(metaMatch), 'meta CSP fallback present (GitHub Pages cannot set headers)');
  check(Boolean(hdrMatch), 'header CSP present');
  if (metaMatch && hdrMatch) {
    const meta = norm(metaMatch[1]);
    const hdr = norm(hdrMatch[1]);
    const onlyHeader = [...hdr].filter((d) => !meta.has(d));
    const onlyMeta = [...meta].filter((d) => !hdr.has(d));
    check(onlyMeta.length === 0, onlyMeta.length ? `meta has directives the header lacks: ${onlyMeta.join(', ')}` : 'meta adds nothing the header lacks');
    const allowed = onlyHeader.length === 0
      || (onlyHeader.length === 1 && /^frame-ancestors/.test(onlyHeader[0]));
    check(allowed, allowed ? 'meta/header differ only by frame-ancestors, as expected' : `unexpected CSP drift: ${onlyHeader.join(', ')}`);
  }
  for (const [file, key] of [['vercel.json', 'Content-Security-Policy']]) {
    if (existsSync(file)) check(read(file).includes(key), `${file} carries a CSP`);
  }
}

console.log('\n— cache headers across deploy targets —');
{
  const headers = existsSync('public/_headers') ? read('public/_headers') : '';
  const netlify = existsSync('netlify.toml') ? read('netlify.toml') : '';
  let vercel = null;
  try {
    vercel = existsSync('vercel.json') ? JSON.parse(read('vercel.json')) : null;
  } catch {
    vercel = null;
  }

  check(/\/\*\.css[\s\S]*max-age=3600/.test(headers), 'public/_headers caches CSS');
  check(/\/\*\.js[\s\S]*max-age=3600/.test(headers), 'public/_headers caches JS');
  check(/\/assets\/\*[\s\S]*max-age=86400/.test(headers), 'public/_headers caches assets');
  check(netlify.includes('for = "/*.css"')
    && netlify.includes('Cache-Control = "public, max-age=3600, must-revalidate"'),
    'netlify.toml caches CSS');
  check(netlify.includes('for = "/*.js"')
    && netlify.includes('Cache-Control = "public, max-age=3600, must-revalidate"'),
    'netlify.toml caches JS');
  check(/for = "\/assets\/\*"[\s\S]*max-age=86400/.test(netlify), 'netlify.toml caches assets');

  const vercelRules = Array.isArray(vercel?.headers) ? vercel.headers : [];
  const hasVercelRule = (source, value) => vercelRules.some((rule) =>
    rule.source === source
    && Array.isArray(rule.headers)
    && rule.headers.some((h) => h.key === 'Cache-Control' && h.value === value));
  check(hasVercelRule('/(.*)\\.(css|js)', 'public, max-age=3600, must-revalidate'),
    'vercel.json caches CSS/JS');
  check(hasVercelRule('/assets/(.*)', 'public, max-age=86400, must-revalidate'),
    'vercel.json caches assets');
}

console.log('\n— deploy allowlist build —');
{
  const netlify = existsSync('netlify.toml') ? read('netlify.toml') : '';
  let vercel = null;
  try {
    vercel = existsSync('vercel.json') ? JSON.parse(read('vercel.json')) : null;
  } catch {
    vercel = null;
  }
  check(existsSync('scripts/build-site.mjs'), 'allowlist build script present');
  check(existsSync('scripts/load-smoke.mjs'), '10k static load smoke script present');
  check(/publish = "dist"/.test(netlify), 'Netlify publishes dist/');
  check(/command = "node scripts\/build-site\.mjs"/.test(netlify), 'Netlify runs allowlist build');
  check(vercel?.outputDirectory === 'dist', 'Vercel publishes dist/');
  check(vercel?.buildCommand === 'node scripts/build-site.mjs', 'Vercel runs allowlist build');
}

console.log('\n— payload budgets —');
{
  const size = (f) => statSync(f).size;
  const sum = (items) => items.reduce((total, f) => total + size(f), 0);
  const cssFiles = files.filter((f) => /^css\/.+\.css$/.test(f));
  const coreJs = files.filter((f) => /^js\/[^/]+\.js$/.test(f));
  const gameJs = files.filter((f) => /^js\/game\/.+\.js$/.test(f));
  const referencedAssets = new Set(['assets/favicon.svg']);
  for (const f of code) {
    for (const m of read(f).matchAll(/assets\/[A-Za-z0-9._@/-]+/g)) {
      referencedAssets.add(m[0]);
    }
  }
  const missingAssets = [...referencedAssets].filter((f) => !existsSync(f));
  const oversizedAssets = [...referencedAssets]
    .filter((f) => existsSync(f) && size(f) > 256_000)
    .map((f) => `${f} (${Math.round(size(f) / 1024)} KiB)`);

  check(size('index.html') <= 10_000, `index.html ${size('index.html')} bytes`);
  check(sum(cssFiles) <= 150_000, `runtime CSS ${sum(cssFiles)} bytes`);
  check(sum(coreJs) <= 100_000, `core JS ${sum(coreJs)} bytes`);
  check(sum(gameJs) <= 180_000, `lazy game JS ${sum(gameJs)} bytes`);
  check(missingAssets.length === 0,
    missingAssets.length ? `missing referenced assets: ${missingAssets.join(', ')}` : `${referencedAssets.size} referenced assets exist`);
  check(oversizedAssets.length === 0,
    oversizedAssets.length ? `oversized referenced assets: ${oversizedAssets.join(', ')}` : 'referenced assets under 256 KiB each');
}

console.log('\n— content contract —');
const { CONTENT } = await import('./js/content.js');
check(Object.isFrozen(CONTENT), 'CONTENT frozen');
check(CONTENT.projects.length >= 5, `${CONTENT.projects.length} projects`);
check(CONTENT.timeline.length > 0, 'timeline populated');
// Projects that claim a repo must name a real one. Coursework projects
// deliberately carry repo:null — the code stays private for academic
// integrity — and must NOT be checked against the GitHub repo list.
const repoNames = ['bldc-drv1098x-bringup', 'sakha-wheelchair', 'intai-mock-interview', 'warret', 'stylemind'];
const withRepo = CONTENT.projects.filter((p) => p.repo);
check(
  JSON.stringify(withRepo.map((p) => p.id).sort()) === JSON.stringify([...repoNames].sort()),
  'every project with a repo matches a real GitHub repo',
);
const coursework = CONTENT.projects.filter((p) => !p.repo);
check(coursework.length > 0, `${coursework.length} coursework projects with no repo link`);
// The academic-integrity position used to sit on each coursework card. The
// per-card line is gone at the owner's request, so the requirement moved to
// where the claim now lives: it must still be stated once, site-wide, or the
// missing repo links look like a gap rather than a decision.
// Stated on the Projects section heading, which is where a reader notices
// three cards with no repository link.
check(/coursework code[^]*stays private/i.test(read('js/site.js')),
  'Projects section explains why coursework code is not linked');
for (const p of CONTENT.projects) {
  check(!p.repo || /^https:\/\/github\.com\//.test(p.repo), `${p.id} repo url safe`);
}

console.log('\n— forbidden claims —');
const allText = JSON.stringify(CONTENT);
for (const [needle, label] of [
  [/harvard/i, 'Harvard attribution'], [/fine-tun/i, 'fine-tuned model'],
  [/semantic evaluation/i, 'semantic evaluation'], [/six-step/i, 'six-step commutation'],
  [/gate driver/i, 'external gate driver'], [/EEPROM/i, 'EEPROM programming'],
  [/STM32/i, 'STM32 ownership'],
]) check(!needle.test(allText), `no ${label}`);

// Aumcore is legitimate as the CLIENT and wrong as the EMPLOYER — the audit's
// correction was that an earlier resume listed it as the employer when the job
// was at Omnie Solutions. So test the actual mistake, not the word: it must
// never appear as an org/employer field, and any mention must name it a client.
{
  const employerFields = CONTENT.timeline
    .filter((e) => /aumcore/i.test(`${e.org || ''} ${e.title || ''}`))
    .map((e) => e.id);
  check(employerFields.length === 0,
    employerFields.length ? `Aumcore named as employer in: ${employerFields.join(', ')}` : 'Aumcore never named as employer');

  const mentions = JSON.stringify(CONTENT).match(/[^.]*Aumcore[^.]*/gi) || [];
  const unqualified = mentions.filter((m) => !/client/i.test(m));
  check(unqualified.length === 0,
    unqualified.length ? `Aumcore mentioned without "client": ${unqualified[0].trim().slice(0, 70)}` : `Aumcore qualified as client in all ${mentions.length} mention(s)`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks\n`);
process.exit(failures === 0 ? 0 : 1);
