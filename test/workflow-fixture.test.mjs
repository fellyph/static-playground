import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from '../scripts/lib/config.mjs';
import { formatBuildSummary } from '../scripts/summary.mjs';

test('formatBuildSummary generates a Markdown summary from build, validation, and deployment reports', () => {
  const md = formatBuildSummary({
    build: {
      routes: ['/'],
      assetCount: 2,
      externalAssets: ['https://fonts.googleapis.com/css2?family=DM+Sans'],
      omittedLinks: [{ from: '/sample-page/', target: '/wp-admin/', reason: 'Unavailable' }],
      checkpoint: 'f269a0a9043a20364356e0c70417357aff2d3752768cb114fdccb45921209018',
      productionUrl: 'https://dist-xualkngh2.view.fast',
    },
    validation: {
      passed: true,
      files: 5,
      checkedTargets: 2,
      errors: [],
    },
    deployment: {
      liveUrl: 'https://dist-xualkngh2.view.fast/',
      version: 'ver_123',
    },
  });

  assert.match(md, /## Static Playground Build Summary/);
  assert.match(md, /\| Routes \| 1 \|/);
  assert.match(md, /\| Validation \| Passed \|/);
  assert.match(md, /https:\/\/dist-xualkngh2\.view\.fast\//);
});

test('workflow configuration avoids redundant npm run validate after npm run build', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/static-site.yml'), 'utf8');
  assert.doesNotMatch(workflow, /- run: npm run validate/);
});
