import { copyFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, snapshotDir, saveJson } from './lib/config.mjs';
import { inspectArchive } from './lib/archive.mjs';
import { startRuntime, metadata } from './lib/runtime.mjs';

export async function importSnapshot(file, c, destination = snapshotDir) {
  const inspected = await inspectArchive(file);
  const effective = {
    ...c,
    wordpressVersion: (!c.runtimeVersionsExplicit && inspected.detectedWordpressVersion) ? inspected.detectedWordpressVersion : c.wordpressVersion,
  };
  const runtime = await startRuntime(effective, file, inspected);
  let meta;
  try {
    meta = await metadata(runtime);
    if (meta.wordpressVersion !== effective.wordpressVersion || meta.phpVersion !== effective.phpVersion) {
      throw new Error(`Restored runtime does not match requested WordPress ${effective.wordpressVersion} / PHP ${effective.phpVersion}.`);
    }
  } finally { await runtime[Symbol.asyncDispose](); }
  await mkdir(destination, { recursive: true });
  const temporary = resolve(destination, 'site.zip.tmp');
  await copyFile(file, temporary);
  await saveJson(resolve(destination, 'site.json.tmp'), {
    sha256: inspected.sha256,
    bytes: inspected.bytes,
    entries: inspected.entries,
    manifest: inspected.manifest,
    ...meta,
    importedAt: new Date().toISOString(),
    runtimeVersionSource: c.runtimeVersionsExplicit
      ? 'Explicit import configuration; browser exports do not record runtime versions.'
      : 'Auto-detected from SQLite checkpoint database.',
  });
  await rename(temporary, resolve(destination, 'site.zip'));
  await rename(resolve(destination, 'site.json.tmp'), resolve(destination, 'site.json'));
  console.log(`Checkpoint imported: ${inspected.sha256}`);
  return meta;
}
if (process.argv[1] === import.meta.filename) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run snapshot:import -- /path/to/site.zip');
    const c = await config();
    await importSnapshot(resolve(process.argv[2]), c);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
