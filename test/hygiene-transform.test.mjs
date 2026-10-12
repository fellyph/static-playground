import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { html } from '../scripts/lib/transform.mjs';
import { config } from '../scripts/lib/config.mjs';

test('html transform classifies dns-prefetch and preconnect as resource-hint instead of canonical', () => {
  const seen = [];
  const rewrite = (url, kind) => {
    seen.push({ url, kind });
    if (kind === 'resource-hint') return null;
    return url;
  };
  const input = '<head><link rel="dns-prefetch" href="//127.0.0.1:8080"><link rel="preconnect" href="https://fonts.gstatic.com"><link rel="canonical" href="https://site.test/about/"></head>';
  const output = html(input, rewrite);

  assert.deepEqual(seen, [
    { url: '//127.0.0.1:8080', kind: 'resource-hint' },
    { url: 'https://fonts.gstatic.com', kind: 'resource-hint' },
    { url: 'https://site.test/about/', kind: 'canonical' },
  ]);
  assert.doesNotMatch(output, /dns-prefetch/);
  assert.match(output, /rel="canonical"/);
});

test('html transform strips inline sourceURL comments from style and script tags', () => {
  const input = '<style>.a{color:red}\n/*# sourceURL=http://127.0.0.1:9400/wp-includes/blocks/post-content/style.min.css */\n</style><script type="module">console.log(1);\n//# sourceURL=http://127.0.0.1:9400/wp-includes/js/wp-emoji-loader.min.js\n</script>';
  const output = html(input, url => url);

  assert.doesNotMatch(output, /sourceURL=/);
  assert.match(output, /\.a\{color:red\}/);
  assert.match(output, /console\.log\(1\);/);
});

test('config validates excludeRoutes and prepare.php removes emoji and generator hooks', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'config-exclude-'));
  const prev = process.env.SITE_CONFIG;
  try {
    const cfgPath = resolve(dir, 'site.config.json');
    await writeFile(cfgPath, JSON.stringify({
      productionUrl: 'https://site.test',
      excludeRoutes: ['/sample-page/', '/hello-from-playground/'],
    }));
    process.env.SITE_CONFIG = cfgPath;
    const loaded = await config();
    assert.deepEqual(loaded.excludeRoutes, ['/sample-page/', '/hello-from-playground/']);

    await writeFile(cfgPath, JSON.stringify({
      productionUrl: 'https://site.test',
      excludeRoutes: ['relative/path'],
    }));
    await assert.rejects(config(), /excludeRoutes/);
  } finally {
    if (prev === undefined) delete process.env.SITE_CONFIG;
    else process.env.SITE_CONFIG = prev;
    await rm(dir, { recursive: true, force: true });
  }

  const preparePhp = await readFile(new URL('../scripts/wordpress/prepare.php', import.meta.url), 'utf8');
  assert.match(preparePhp, /print_emoji_detection_script/);
  assert.match(preparePhp, /wp_print_speculation_rules/);
  assert.match(preparePhp, /wp_generator/);
});
