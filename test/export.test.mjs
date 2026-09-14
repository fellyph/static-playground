import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import http from 'node:http';
import { safePath, assetFile, routeFile, temporaryUrl } from '../scripts/lib/urls.mjs';
import { html, css } from '../scripts/lib/transform.mjs';
import { inspectArchive } from '../scripts/lib/archive.mjs';
import { validate } from '../scripts/validate.mjs';
import { download } from '../scripts/lib/capture.mjs';
import { saveJson } from '../scripts/lib/config.mjs';
import { runPublish } from '../scripts/publish.mjs';

test('output paths exclude source backups, traversal and runtime services', () => {
  for (const path of ['/wp-content/database/.ht.sqlite', '/wp-admin/', '/wp-json/wp/v2/posts', '/archive.zip', '/a.php', '/%2e%2e/secret', '/.env', '/a%5cb']) assert.throws(() => safePath(path));
  assert.equal(routeFile('/about/team/'), 'about/team/index.html');
  assert.equal(assetFile(new URL('https://site.test/style.css?ver=1')), 'style.css');
  assert.notEqual(assetFile(new URL('https://site.test/style.css?size=1')), assetFile(new URL('https://site.test/style.css?size=2')));
  assert.ok(temporaryUrl('https://playground.wordpress.net/scope:abc/a'));
  assert.equal(temporaryUrl('https://playground.wordpress.net/'), false, 'Keep intentional links to Playground itself.');
  assert.ok(temporaryUrl('http:\\/\\/127.0.0.1:1234\\/a'));
});

test('parsers discover responsive images, CSS imports, fonts and canonical URLs', () => {
  const found = [];
  const rewrite = (url, kind) => { found.push([url, kind]); return '/static/' + url; };
  const output = html('<link rel="canonical" href="about/"><img src="one.png" srcset="two.png 2x, three.png 3x"><style>@import "other.css"; @font-face {src:url(font.woff2)} .x{background:url(bg.png)}</style>', rewrite);
  for (const name of ['one.png', 'two.png', 'three.png', 'other.css', 'font.woff2', 'bg.png']) assert.ok(found.some(([url, kind]) => url === name && kind === 'asset'));
  assert.ok(found.some(([url, kind]) => url === 'about/' && kind === 'canonical'));
  assert.match(output, /\/static\/three.png 3x/);
  assert.throws(() => html('<form><input></form>', rewrite), /outside v1/);
});

test('corrupt or unrelated ZIP cannot replace a checkpoint', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'snapshot-test-'));
  try { const file = resolve(dir, 'bad.zip'); await writeFile(file, 'not a zip'); await assert.rejects(inspectArchive(file)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('validation fails on missing routes/assets and runtime URLs', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'validation-test-')); const output = resolve(dir, 'dist'); const reports = resolve(dir, 'reports');
  try {
    await mkdir(output);
    await saveJson(resolve(reports, 'build.json'), { routes: ['/', '/missing/'], productionUrl: 'https://site.test', checkpoint: 'test' });
    await writeFile(resolve(output, 'index.html'), '<img src="/absent.png"><script>const source="http://127.0.0.1:9400/"</script>');
    await assert.rejects(validate({ output, reports }), /Missing route/);
    const report = JSON.parse(await readFile(resolve(reports, 'validation.json')));
    assert.equal(report.passed, false);
    assert.ok(report.errors.some(s => s.includes('absent.png')));
    assert.ok(report.errors.some(s => s.includes('Temporary URL')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Wget propagates missing responses instead of publishing error HTML', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'wget-test-'));
  const server = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('missing'); });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  try { await assert.rejects(download(`http://127.0.0.1:${server.address().port}/missing`, resolve(dir, 'missing.html')), /Wget failed/); }
  finally { await new Promise(resolvePromise => server.close(resolvePromise)); await rm(dir, { recursive: true, force: true }); }
});

test('provider failure and invalid receipts fail deployment', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'publish-test-'));
  try {
    const command = resolve(dir, 'sf');
    await writeFile(command, '#!/bin/sh\nexit 7\n', { mode: 0o700 });
    await assert.rejects(runPublish(command, dir, process.env), /exit code 7/);
    await writeFile(command, '#!/bin/sh\nprintf "not-json"\n');
    await assert.rejects(runPublish(command, dir, process.env), /invalid JSON receipt/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
