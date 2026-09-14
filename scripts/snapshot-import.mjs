import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, snapshotDir, saveJson } from './lib/config.mjs';
import { inspectArchive } from './lib/archive.mjs';
import { startRuntime, metadata } from './lib/runtime.mjs';

export async function importSnapshot(file, c, destination = snapshotDir) {
  const inspected = await inspectArchive(file);
  const runtime = await startRuntime(c, file);
  let meta;
  try { meta = await metadata(runtime); } finally { await runtime[Symbol.asyncDispose](); }
  await mkdir(destination, { recursive: true });
  const temporary = resolve(destination, 'site.zip.tmp');
  await copyFile(file, temporary);
  await saveJson(resolve(destination, 'site.json.tmp'), { ...inspected, ...meta, importedAt: new Date().toISOString(), runtimeVersionSource: 'Explicit import configuration; browser exports do not record runtime versions.' });
  await rename(temporary, resolve(destination, 'site.zip'));
  await rename(resolve(destination, 'site.json.tmp'), resolve(destination, 'site.json'));
  console.log(`Checkpoint imported: ${inspected.sha256}`);
  return meta;
}
if (process.argv[1] === import.meta.filename) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run snapshot:import -- /path/to/site.zip');
    const c = await config();
    if (!c.runtimeVersionsExplicit) throw new Error('Set wordpressVersion and phpVersion in site.config.json to match the exported Playground before importing.');
    await importSnapshot(resolve(process.argv[2]), c);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
