import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import http from 'node:http';
import { capture } from '../scripts/lib/capture.mjs';
import { serve } from '../scripts/lib/static-server.mjs';

test('capture omits internal dns-prefetch links instead of recording bogus canonical references', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'capture-hints-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<head><link rel="dns-prefetch" href="//127.0.0.1:${server.address().port}/"><link rel="dns-prefetch" href="//fonts.googleapis.com"><link rel="canonical" href="http://127.0.0.1:${server.address().port}/"></head><body><h1>Southbound</h1></body>`);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('Not found');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const result = await capture({ origin, productionUrl: 'https://site.test', routes: ['/'], output: dir });
    const indexHtml = await readFile(resolve(dir, 'index.html'), 'utf8');

    assert.equal(result.references.filter(r => r.kind === 'canonical').length, 1);
    assert.doesNotMatch(indexHtml, /rel="dns-prefetch"[^>]*site\.test/);
    assert.match(indexHtml, /rel="dns-prefetch" href="\/\/fonts\.googleapis\.com"/);
  } finally {
    await new Promise(done => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});

test('static preview server serves webp and txt assets with accurate MIME types', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'static-preview-'));
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body>ok</body></html>');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let preview;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await capture({ origin, productionUrl: 'https://site.test', routes: ['/'], output: dir });
    preview = await serve(dir);
    const robotsRes = await fetch(`${preview.url}/robots.txt`);
    assert.equal(robotsRes.status, 200);
    assert.match(robotsRes.headers.get('content-type') || '', /text\/plain/);
  } finally {
    await preview?.close();
    await new Promise(done => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
