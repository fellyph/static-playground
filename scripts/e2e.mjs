import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { zipWpContent } from '@wp-playground/blueprints';
import { fixture, fixtureConfig } from './fixture.mjs';
import { build } from './build.mjs';
import { serve } from './lib/static-server.mjs';
import { startRuntime, php } from './lib/runtime.mjs';
import { importSnapshot } from './snapshot-import.mjs';
import { saveJson } from './lib/config.mjs';

const directory = await fixture();
const output = resolve(directory, 'dist'); const reports = resolve(directory, 'reports');
await mkdir(reports, { recursive: true });
const browser = await chromium.launch({ headless: true });
const shots = new Map(); const comparisons = [];
const routes = ['/', '/about/our-process/', '/journal/', '/journal/page/2/', '/category/dispatches/', '/field-note-1/'];
const sizes = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
async function screenshot(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
  return page.screenshot({ fullPage: true, animations: 'disabled' });
}
let staticSite;
try {
  await build(fixtureConfig, { snapshots: resolve(directory, 'snapshots'), output, reports, beforeStop: async runtime => {
    for (const viewport of sizes) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      for (const route of routes) {
        const key = viewport.width + '-' + route.replaceAll('/', '_');
        const shot = await screenshot(page, new URL(route, runtime.serverUrl).href);
        assert.equal(await page.locator('img').evaluateAll(images => images.filter(i => !i.complete || i.naturalWidth === 0).length), 0, `Restored images failed on ${route}`);
        shots.set(key, shot); await writeFile(resolve(reports, key + '-wordpress.png'), shot);
      }
      await page.close();
    }
  }});
  // Build has disposed WordPress. Everything below runs against static files only.
  staticSite = await serve(output);
  for (const viewport of sizes) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    for (const route of routes) {
      const key = viewport.width + '-' + route.replaceAll('/', '_');
      const buffer = await screenshot(page, staticSite.url + route);
      await writeFile(resolve(reports, key + '-static.png'), buffer);
      const source = PNG.sync.read(shots.get(key)); const dest = PNG.sync.read(buffer);
      assert.equal(source.width, dest.width); assert.equal(source.height, dest.height, `Height differs for ${key}`);
      const diff = new PNG({ width: source.width, height: source.height });
      const pixels = pixelmatch(source.data, dest.data, diff.data, source.width, source.height, { threshold: 0.1 });
      await writeFile(resolve(reports, key + '-diff.png'), PNG.sync.write(diff));
      comparisons.push({ route, width: viewport.width, differentPixels: pixels });
      assert.equal(pixels, 0, `Visual difference for ${key}`);
      assert.equal(await page.locator('img').evaluateAll(images => images.filter(i => !i.complete || i.naturalWidth === 0).length), 0);
    }
    await page.goto(staticSite.url + '/');
    if (viewport.width < 600) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('button', { name: 'Close menu' }).waitFor({ state: 'visible' });
    }
    await page.getByRole('link', { name: 'Journal', exact: true }).first().click();
    await page.waitForURL('**/journal/');
    await page.locator('a.page-numbers').filter({ hasText: '2' }).first().click();
    await page.waitForURL('**/journal/page/2/');
    assert.deepEqual(failures, []);
    await page.close();
  }
  const r = await startRuntime(fixtureConfig, resolve(directory, 'snapshots/site.zip'));
  try {
    const restored = JSON.parse(await php(r, `echo wp_json_encode(array('background' => wp_get_global_styles(array('color','background')), 'nested' => (bool) get_page_by_path('about/our-process')));`));
    assert.equal(restored.background, '#f4f0e7'); assert.equal(restored.nested, true);
    await php(r, `wp_set_current_user(1); wp_insert_post(array('post_type'=>'page','post_status'=>'publish','post_title'=>'Second edit','post_content'=>'ROUND_TRIP_SECOND_EDIT'));`);
    await writeFile(resolve(directory, 'second.zip'), await zipWpContent(r.playground));
  } finally { await r[Symbol.asyncDispose](); }
  await importSnapshot(resolve(directory, 'second.zip'), fixtureConfig, resolve(directory, 'second-snapshot'));
  await build(fixtureConfig, { snapshots: resolve(directory, 'second-snapshot'), output: resolve(directory, 'second-dist'), reports: resolve(directory, 'second-reports') });
  assert.match(await readFile(resolve(directory, 'second-dist/second-edit/index.html'), 'utf8'), /ROUND_TRIP_SECOND_EDIT/);
  const firstBuild = JSON.parse(await readFile(resolve(reports, 'build.json')));
  for (const route of firstBuild.routes) assert.doesNotMatch(await readFile(resolve(output, route.slice(1) + 'index.html'), 'utf8'), /NEVER_PUBLISH_(DRAFT|PRIVATE|PROTECTED)_915/);
  await saveJson(resolve(reports, 'e2e.json'), { passed: true, comparisons, restoredAndEditedAgain: true, wordpressStoppedForStaticTests: true });
  console.log('E2E passed: exact desktop/mobile screenshots, static navigation and recovery round trip.');
} finally { await staticSite?.close(); await browser.close(); }
