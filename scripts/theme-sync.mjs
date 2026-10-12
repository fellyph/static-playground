import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { zipWpContent } from '@wp-playground/blueprints';
import { startRuntime, php, metadata } from './lib/runtime.mjs';
import { root, json, snapshotDir } from './lib/config.mjs';
import { inspectArchive } from './lib/archive.mjs';
import { importSnapshot } from './snapshot-import.mjs';

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Theme source must contain only regular files: ${path}`);
  }
  return result;
}

export async function syncTheme(output) {
  const checkpoint = await json(resolve(snapshotDir, 'site.json'));
  const archive = resolve(snapshotDir, 'site.zip');
  if ((await inspectArchive(archive)).sha256 !== checkpoint.sha256) throw new Error('Checkpoint checksum mismatch.');
  const runtime = await startRuntime(checkpoint, archive);
  try {
    if (await php(runtime, "echo get_stylesheet();") !== 'southbound') throw new Error('The checkpoint must use the Southbound theme.');
    const source = resolve(root, 'themes/southbound');
    for (const file of await files(source)) {
      const destination = '/wordpress/wp-content/themes/southbound/' + relative(source, file).split('\\').join('/');
      await runtime.playground.mkdir(resolve(destination, '..'));
      await runtime.playground.writeFile(destination, new Uint8Array(await readFile(file)));
    }
    console.log(await php(runtime, `
      $id = (int) get_option('page_on_front');
      $page = get_post($id);
      if ($page && hash('sha256', $page->post_content) === '46c1c49e11a707217848e28d65480fd0268c437893baf5df9569730f046af71d') {
        // The Front Page template now owns this layout. Keep the old HTML in a revision.
        wp_save_post_revision($id);
        $updated = wp_update_post(array('ID' => $id, 'post_content' => ''), true);
        if (is_wp_error($updated)) throw new Exception($updated->get_error_message());
        echo 'Moved the original homepage layout to the Front Page template; retained its revision.';
      } elseif ($page && trim($page->post_content) !== '') {
        throw new Exception('The homepage has custom content. Review its migration before syncing this theme.');
      } else {
        echo 'Homepage layout already uses the Front Page template.';
      }
    `));
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
