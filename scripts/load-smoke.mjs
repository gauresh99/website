#!/usr/bin/env node
/**
 * Local load smoke test for the generated static artifact.
 *
 * This is not a CDN benchmark and does not pretend to be one. It is a
 * regression gate for the property this site controls: the deploy output is a
 * finite set of static bytes, with no backend state, no per-request data
 * structure, no database, and no dynamic application code that can crash under
 * traffic. The in-process server loads dist/ into memory once and then answers
 * 10,000 requests from that immutable map.
 */

import { createServer, request } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

const REQUESTS = Number.parseInt(process.env.LOAD_REQUESTS || '10000', 10);
const CONCURRENCY = Number.parseInt(process.env.LOAD_CONCURRENCY || '200', 10);
const MAX_ERROR_RATE = Number.parseFloat(process.env.LOAD_MAX_ERROR_RATE || '0');

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['', 'application/octet-stream'],
]);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

async function loadFiles() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/index.html missing; run node scripts/build-site.mjs first');
  }

  const files = await walk(DIST);
  const map = new Map();
  for (const full of files) {
    const rel = '/' + relative(DIST, full).split(sep).join('/');
    const body = await readFile(full);
    map.set(rel, {
      body,
      headers: {
        'content-length': String(body.length),
        'content-type': MIME.get(extname(full).toLowerCase()) || MIME.get(''),
        'x-content-type-options': 'nosniff',
      },
    });
  }
  map.set('/', map.get('/index.html'));
  return map;
}

function safePath(url) {
  try {
    const parsed = new URL(url, 'http://local.test');
    const decoded = decodeURIComponent(parsed.pathname);
    const normal = normalize(decoded).split(sep).join('/');
    if (!normal.startsWith('/')) return null;
    if (normal.includes('/../') || normal === '/..') return null;
    return normal;
  } catch {
    return null;
  }
}

function createStaticServer(files) {
  return createServer((req, res) => {
    const path = safePath(req.url || '/');
    const hit = path ? files.get(path) : null;
    if (!hit) {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': '9',
        'x-content-type-options': 'nosniff',
      });
      res.end('not found');
      return;
    }

    res.writeHead(200, hit.headers);
    if (req.method === 'HEAD') res.end();
    else res.end(hit.body);
  });
}

function onceListening(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function doRequest(port, path) {
  return new Promise((resolve) => {
    const started = performance.now();
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode === 200,
          status: res.statusCode || 0,
          bytes,
          ms: performance.now() - started,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', () => {
      resolve({ ok: false, status: 0, bytes: 0, ms: performance.now() - started });
    });
    req.end();
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  if (!Number.isInteger(REQUESTS) || REQUESTS < 1) throw new Error('LOAD_REQUESTS must be a positive integer');
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) throw new Error('LOAD_CONCURRENCY must be a positive integer');

  const files = await loadFiles();
  const runtimePaths = [...files.keys()]
    .filter((path) => path !== '/_headers')
    .filter((path) => !path.endsWith('/'))
    .sort();
  if (!runtimePaths.includes('/')) runtimePaths.unshift('/');

  const server = createStaticServer(files);
  const address = await onceListening(server);
  const port = address.port;

  let issued = 0;
  let completed = 0;
  let failures = 0;
  let bytes = 0;
  const latencies = [];
  const start = performance.now();

  async function worker() {
    while (true) {
      const current = issued++;
      if (current >= REQUESTS) return;
      const path = runtimePaths[current % runtimePaths.length];
      const result = await doRequest(port, path);
      completed++;
      if (!result.ok) failures++;
      bytes += result.bytes;
      latencies.push(result.ms);
    }
  }

  try {
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, REQUESTS); i++) workers.push(worker());
    await Promise.all(workers);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  latencies.sort((a, b) => a - b);
  const elapsed = performance.now() - start;
  const errorRate = failures / Math.max(1, completed);

  console.log(JSON.stringify({
    requests: completed,
    failures,
    errorRate,
    concurrency: Math.min(CONCURRENCY, REQUESTS),
    elapsedMs: Math.round(elapsed),
    requestsPerSecond: Math.round((completed / elapsed) * 100000) / 100,
    bytes,
    latencyMs: {
      p50: Math.round(percentile(latencies, 50) * 100) / 100,
      p95: Math.round(percentile(latencies, 95) * 100) / 100,
      p99: Math.round(percentile(latencies, 99) * 100) / 100,
      max: Math.round((latencies[latencies.length - 1] || 0) * 100) / 100,
    },
    paths: runtimePaths.length,
  }, null, 2));

  if (completed !== REQUESTS) throw new Error(`completed ${completed}/${REQUESTS} requests`);
  if (errorRate > MAX_ERROR_RATE) {
    throw new Error(`error rate ${errorRate} exceeded ${MAX_ERROR_RATE}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
