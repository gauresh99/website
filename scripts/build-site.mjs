#!/usr/bin/env node
/**
 * Build the deployable static site into dist/.
 *
 * This is deliberately tiny and dependency-free. Its security job is more
 * important than its convenience job: deploys publish an allowlisted runtime
 * tree instead of the working directory, so local agent files, tests, notes,
 * raw source images, and future dotfiles cannot become public by accident.
 */

import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

const RUNTIME_DIRS = ['css', 'js'];
const RUNTIME_FILES = ['index.html'];
const HEADER_SOURCE = 'public/_headers';

async function copyTree(fromRel, toRel = fromRel) {
  const from = join(ROOT, fromRel);
  const to = join(DIST, toRel);
  const info = await stat(from);
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from)) {
      await copyTree(join(fromRel, entry), join(toRel, entry));
    }
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function collectFiles(dirRel, out = []) {
  const dir = join(ROOT, dirRel);
  for (const entry of await readdir(dir)) {
    const rel = join(dirRel, entry);
    const info = await stat(join(ROOT, rel));
    if (info.isDirectory()) await collectFiles(rel, out);
    else out.push(rel);
  }
  return out;
}

async function collectReferencedAssets() {
  const sources = [...RUNTIME_FILES];
  for (const dir of RUNTIME_DIRS) {
    const files = await collectFiles(dir);
    sources.push(...files.filter((file) => /\.(?:css|js|mjs|html)$/.test(file)));
  }

  const assets = new Set();
  for (const file of sources) {
    const text = await readFile(join(ROOT, file), 'utf8');
    for (const match of text.matchAll(/assets\/[A-Za-z0-9._@/-]+/g)) {
      assets.add(match[0]);
    }
  }
  return [...assets].sort();
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const file of RUNTIME_FILES) await copyTree(file);
  for (const dir of RUNTIME_DIRS) await copyTree(dir);

  const assets = await collectReferencedAssets();
  for (const asset of assets) {
    if (!existsSync(join(ROOT, asset))) {
      throw new Error(`Referenced asset is missing: ${asset}`);
    }
    await copyTree(asset);
  }

  await copyTree(HEADER_SOURCE, '_headers');

  const copied = [
    ...RUNTIME_FILES,
    ...RUNTIME_DIRS.map((dir) => `${dir}/`),
    ...assets,
    '_headers',
  ];
  console.log(`built ${relative(process.cwd(), DIST) || 'dist'} with ${copied.length} entries`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
