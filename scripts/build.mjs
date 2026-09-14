import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, json, saveJson, snapshotDir, outputDir, reportDir, root, sha256 } from './lib/config.mjs';
import { startRuntime, metadata } from './lib/runtime.mjs';
import { capture } from './lib/capture.mjs';
import { validate } from './validate.mjs';

export async function build(c, { snapshots = snapshotDir, output = outputDir, reports = reportDir, beforeStop } = {}) {
  const checkpoint = await json(resolve(snapshots, 'site.json'));
  const archive = resolve(snapshots, 'site.zip');
  if (sha256(await readFile(archive)) !== checkpoint.sha256) throw new Error('Snapshot checksum mismatch. Re-import the ZIP.');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await mkdir(reports, { recursive: true });
  await rm(resolve(reports, 'validation.json'), { force: true });
  console.log('Restoring checkpoint into an isolated Playground runtime...');
  const runtime = await startRuntime({ ...c, wordpressVersion: checkpoint.wordpressVersion, phpVersion: checkpoint.phpVersion }, archive);
  let result;
  try {
    console.log('Checking database and discovering public routes...');
    await metadata(runtime);
    if (!await runtime.playground.isDir('/wordpress/wp-content/mu-plugins')) await runtime.playground.mkdir('/wordpress/wp-content/mu-plugins');
    await runtime.playground.writeFile('/wordpress/wp-content/mu-plugins/static-publishing.php', new Uint8Array(await readFile(resolve(root, 'scripts/wordpress/prepare.php'))));
    const response = await runtime.playground.run({ code: await readFile(resolve(root, 'scripts/wordpress/inventory.php'), 'utf8') });
    if (response.exitCode !== 0) throw new Error(response.errors || response.text);
    const routes = [...new Set([...JSON.parse(response.text), ...c.additionalRoutes])].sort();
    console.log(`Capturing ${routes.length} public routes with Wget...`);
    result = await capture({ origin: new URL(runtime.serverUrl).origin, oldOrigin: checkpoint.manifest.siteUrl, productionUrl: c.productionUrl, routes, output });
    let commit = null; try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    result = { ...result, productionUrl: c.productionUrl, checkpoint: checkpoint.sha256, commit, builtAt: new Date().toISOString() };
    await saveJson(resolve(reports, 'build.json'), result);
    await validate({ output, reports });
    if (beforeStop) await beforeStop(runtime);
  } finally { await runtime[Symbol.asyncDispose](); }
  if (sha256(await readFile(archive)) !== checkpoint.sha256) throw new Error('Build modified the source checkpoint.');
  console.log(`Built ${result.routes.length} routes and ${result.assetCount} assets.`);
  return result;
}
if (process.argv[1] === import.meta.filename) {
  try { await build(await config()); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
