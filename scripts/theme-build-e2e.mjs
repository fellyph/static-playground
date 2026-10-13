import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from './build.mjs';
import { config, root, sha256, snapshotDir } from './lib/config.mjs';
import { readTheme, themeSource } from './lib/theme.mjs';

const directory = resolve(root, '.cache/theme-build-test');
const source = resolve(directory, 'southbound');
const output = resolve(directory, 'dist');
const reports = resolve(directory, 'reports');
const checkpointFiles = ['site.zip', 'site.json'].map(file => resolve(snapshotDir, file));
const originalHashes = await Promise.all(checkpointFiles.map(async file => sha256(await readFile(file))));
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await cp(themeSource, source, { recursive: true });

// Simulate theme-only edits that have never been saved into the checkpoint.
const template = resolve(source, 'templates/front-page.html');
const marker = 'THEME_SOURCE_FROM_GIT_915';
await writeFile(template, (await readFile(template, 'utf8')) + `\n<!-- wp:paragraph --><p>${marker}</p><!-- /wp:paragraph -->\n`);
await writeFile(resolve(source, 'style.css'), (await readFile(resolve(source, 'style.css'), 'utf8')) + '\n.ci-theme-source-check { color: #123456; }\n');
await rm(resolve(source, 'editor.css'));
const result = await build(await config(), {
  themeSource: source, output, reports,
  beforeStop: async runtime => {
    assert.equal(await runtime.playground.fileExists('/wordpress/wp-content/themes/southbound/editor.css'), false, 'Deleted source files must not survive from the checkpoint.');
  },
});
assert.match(await readFile(resolve(output, 'index.html'), 'utf8'), new RegExp(marker));
assert.match(await readFile(resolve(output, 'wp-content/themes/southbound/style.css'), 'utf8'), /\.ci-theme-source-check/);
assert.equal(result.theme.sha256, (await readTheme(source)).sha256);
assert.deepEqual(await Promise.all(checkpointFiles.map(async file => sha256(await readFile(file)))), originalHashes);
console.log('Theme build passed: source template and CSS edits exported, deleted files removed, checkpoint unchanged.');
