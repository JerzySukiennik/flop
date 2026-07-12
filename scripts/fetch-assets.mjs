#!/usr/bin/env node
// Downloads every asset in assets.manifest.json into public/assets/<id>/.
// Idempotent: skips assets whose files already exist and match sha256.
// Zips are unpacked (flat) into the asset dir. First run records missing sha256s.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'assets.manifest.json');
const outRoot = join(root, 'public', 'assets');

// Poly Haven requires a unique User-Agent on every request.
const UA = 'flop-game-asset-fetcher/1.0 (github.com/JerzySukiennik/flop)';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const exists = (p) => access(p).then(() => true, () => false);

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processAsset(asset, manifestDirty) {
  const dir = join(outRoot, asset.id);
  const marker = join(dir, '.fetched');
  if (await exists(marker)) {
    const recorded = (await readFile(marker, 'utf8')).trim();
    if (recorded === asset.sha256) { console.log(`= ${asset.id} (cached)`); return; }
  }
  console.log(`↓ ${asset.id} ← ${asset.url}`);
  const buf = await download(asset.url);
  const hash = sha256(buf);
  if (asset.sha256 && asset.sha256 !== hash) {
    throw new Error(`sha256 mismatch for ${asset.id}: expected ${asset.sha256}, got ${hash}`);
  }
  if (!asset.sha256) { asset.sha256 = hash; manifestDirty.flag = true; }
  await mkdir(dir, { recursive: true });
  if (asset.url.match(/\.zip($|\?)/i) || asset.unzip) {
    const files = unzipSync(new Uint8Array(buf));
    let count = 0;
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/') || data.length === 0) continue;
      let flat = asset.flatten === false ? name.replaceAll('/', '__') : basename(name);
      if (asset.keep && !asset.keep.some((pat) => new RegExp(pat, 'i').test(name))) continue;
      for (const r of asset.rename ?? []) {
        if (new RegExp(r.from, 'i').test(flat)) { flat = r.to; break; }
      }
      await writeFile(join(dir, flat), data);
      count++;
    }
    console.log(`  unpacked ${count} files`);
  } else {
    await writeFile(join(dir, asset.filename ?? basename(new URL(asset.url).pathname)), buf);
  }
  await writeFile(marker, hash);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const dirty = { flag: false };
let failed = 0;
for (const asset of manifest.assets) {
  if (!['CC0', 'CC-BY'].includes(asset.license)) {
    throw new Error(`${asset.id}: license "${asset.license}" not allowed (CC0/CC-BY only)`);
  }
  try {
    await processAsset(asset, dirty);
  } catch (err) {
    failed++;
    console.error(`✗ ${asset.id}: ${err.message}`);
  }
}
if (dirty.flag) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest updated with recorded sha256s');
}
if (failed) { console.error(`${failed} asset(s) failed`); process.exit(1); }
console.log('all assets ok');
