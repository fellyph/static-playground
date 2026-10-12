import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { inspectArchive } from '../scripts/lib/archive.mjs';
import { root } from '../scripts/lib/config.mjs';

test('inspectArchive auto-detects WordPress version, SQLite integrity, and database URLs from checkpoint ZIP', async () => {
  const inspected = await inspectArchive(resolve(root, 'snapshots/site.zip'));
  assert.equal(inspected.databaseIntegrity, 'ok');
  assert.equal(inspected.detectedWordpressVersion, '7.1');
  assert.equal(typeof inspected.databaseSiteUrl, 'string');
  assert.ok(inspected.databaseSiteUrl.startsWith('http'));
});
