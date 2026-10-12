import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectArchive } from '../scripts/lib/archive.mjs';
import { root } from '../scripts/lib/config.mjs';
import { buildUrlReplacements } from '../scripts/lib/runtime.mjs';

test('inspectArchive auto-detects WordPress version, SQLite integrity, and database URLs from checkpoint ZIP', async () => {
  const inspected = await inspectArchive(resolve(root, 'snapshots/site.zip'));
  assert.equal(inspected.databaseIntegrity, 'ok');
  assert.equal(inspected.detectedWordpressVersion, '7.1');
  assert.equal(typeof inspected.databaseSiteUrl, 'string');
  assert.ok(inspected.databaseSiteUrl.startsWith('http'));
});

test('runtime.mjs avoids downloading external wp-cli.phar and builds complete URL replacement pairs', async () => {
  const runtimeSource = await readFile(resolve(root, 'scripts/lib/runtime.mjs'), 'utf8');
  assert.ok(!runtimeSource.includes('wp-cli'), 'runtime.mjs must not request external wp-cli library');
  assert.ok(!runtimeSource.includes('wpCLI'), 'runtime.mjs must not depend on wpCLI blueprint step');

  const pairs = buildUrlReplacements(
    {
      manifest: { siteUrl: 'https://playground.wordpress.net/scope:abc/' },
      databaseSiteUrl: 'https://playground.wordpress.net/scope:abc',
      databaseHomeUrl: 'http://127.0.0.1:9400',
    },
    'http://127.0.0.1:51234/',
  );
  assert.deepEqual(pairs, [
    ['https://playground.wordpress.net/scope:abc', 'http://127.0.0.1:51234'],
    ['https:\\/\\/playground.wordpress.net\\/scope:abc', 'http:\\/\\/127.0.0.1:51234'],
    ['/scope:abc/', '/'],
    ['http://127.0.0.1:9400', 'http://127.0.0.1:51234'],
    ['http:\\/\\/127.0.0.1:9400', 'http:\\/\\/127.0.0.1:51234'],
  ]);
});

