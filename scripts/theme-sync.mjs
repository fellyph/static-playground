import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipWpContent } from '@wp-playground/blueprints';
import { startRuntime, metadata } from './lib/runtime.mjs';
import { root, json, snapshotDir } from './lib/config.mjs';
import { inspectArchive } from './lib/archive.mjs';
import { importSnapshot } from './snapshot-import.mjs';
import { applyTheme } from './lib/theme.mjs';
import { migrateSouthbound } from './lib/southbound.mjs';

export async function syncTheme(output) {
  const checkpoint = await json(resolve(snapshotDir, 'site.json'));
  const archive = resolve(snapshotDir, 'site.zip');
  if ((await inspectArchive(archive)).sha256 !== checkpoint.sha256) throw new Error('Checkpoint checksum mismatch.');
  const runtime = await startRuntime(checkpoint, archive);
  try {
    await migrateSouthbound(runtime);
    await applyTheme(runtime);
    const meta = await metadata(runtime);
    if (meta.wordpressVersion !== checkpoint.wordpressVersion || meta.phpVersion !== checkpoint.phpVersion) throw new Error('Restored runtime version mismatch.');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, await zipWpContent(runtime.playground));
    await inspectArchive(output);
  } finally { await runtime[Symbol.asyncDispose](); }
  return checkpoint;
}

if (process.argv[1] === import.meta.filename) {
  try {
    const requested = process.argv.indexOf('--output');
    if (requested >= 0 && !process.argv[requested + 1]) throw new Error('--output needs a ZIP path.');
    const output = resolve(requested >= 0 ? process.argv[requested + 1] : resolve(root, '.cache/theme-sync/site.zip'));
    if (output === resolve(snapshotDir, 'site.zip')) throw new Error('Use a temporary output path so the original checkpoint can be validated first.');
    const checkpoint = await syncTheme(output);
    if (requested < 0) await importSnapshot(output, checkpoint);
    console.log(`Theme synchronized: ${output}`);
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
