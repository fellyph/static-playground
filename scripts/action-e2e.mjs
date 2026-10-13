import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root, sha256 } from './lib/config.mjs';

const caller = resolve(root, '.cache/action-test');
await rm(caller, { recursive: true, force: true });
await mkdir(resolve(caller, 'themes/source-directory/templates'), { recursive: true });
await cp(resolve(root, 'snapshots'), resolve(caller, 'content'), { recursive: true });
const checkpoint = await readFile(resolve(caller, 'content/site.zip'));
const theme = resolve(caller, 'themes/source-directory');
await writeFile(resolve(theme, 'style.css'), '/*\nTheme Name: Action Fixture\nVersion: 1.0\n*/\nbody { color: #123456; }\n');
await writeFile(resolve(theme, 'theme.json'), '{"version":3}');
await writeFile(resolve(theme, 'templates/index.html'), '<!-- wp:heading --><h2 class="wp-block-heading">REUSABLE_THEME_FROM_CALLER_915</h2><!-- /wp:heading -->');
await writeFile(resolve(theme, 'functions.php'), "<?php add_action('wp_enqueue_scripts', function () { wp_enqueue_style('action-fixture', get_stylesheet_uri()); });");
// No package.json, dependencies, or Southbound migration in the caller.
const env = {
  ...process.env, SPACEFAST_TOKEN: '',
  GITHUB_WORKSPACE: caller, GITHUB_ACTION_PATH: root, GITHUB_SHA: 'a'.repeat(40),
  GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: resolve(caller, 'outputs.txt'),
  GITHUB_STEP_SUMMARY: resolve(caller, 'summary.md'), ACTION_MODE: 'build',
  ACTION_THEME_PATH: 'themes/source-directory', ACTION_THEME_SLUG: 'action-fixture',
  ACTION_SNAPSHOT_PATH: 'content', ACTION_OUTPUT_PATH: 'public', ACTION_REPORT_PATH: 'reports',
  ACTION_CONFIG_PATH: '', ACTION_PRODUCTION_URL: 'https://caller.example', ACTION_SPACEFAST_SPACE: '',
};
const result = await promisify(execFile)(process.execPath, [resolve(root, 'scripts/action.mjs')], { cwd: caller, env, maxBuffer: 1024 * 1024 });
process.stdout.write(result.stdout);
const build = JSON.parse(await readFile(resolve(caller, 'reports/build.json'), 'utf8'));
assert.equal(build.theme.slug, 'action-fixture');
assert.equal(build.commit, env.GITHUB_SHA);
assert.equal(build.productionUrl, 'https://caller.example');
assert.match(await readFile(resolve(caller, 'public/index.html'), 'utf8'), /REUSABLE_THEME_FROM_CALLER_915/);
assert.match(await readFile(resolve(caller, 'public/wp-content/themes/action-fixture/style.css'), 'utf8'), /#123456/);
assert.equal(sha256(await readFile(resolve(caller, 'content/site.zip'))), sha256(checkpoint));
assert.match(await readFile(env.GITHUB_OUTPUT, 'utf8'), new RegExp(`theme-sha256=${build.theme.sha256}`));
assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /action-fixture/);
await assert.rejects(
  promisify(execFile)(process.execPath, [resolve(root, 'scripts/action.mjs')], {
    cwd: caller,
    env: { ...env, ACTION_MODE: 'publish', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'b'.repeat(40), ACTION_SPACEFAST_SPACE: 'spc_fixture', SPACEFAST_TOKEN: 'fixture' },
  }),
  error => /different caller commit/.test(error.stderr),
  'Publish-only mode must reject artifacts from a different commit before contacting Spacefast.',
);
console.log('Reusable action passed: separate caller, custom paths and slug, caller commit, no caller dependencies, unchanged checkpoint.');
