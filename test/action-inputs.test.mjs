import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { actionInputs } from '../scripts/lib/action-inputs.mjs';

test('action resolves caller inputs and rejects destructive overlaps, invalid slugs and escaped paths', async () => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'action-inputs-'));
  try {
    await mkdir(resolve(workspace, 'themes/custom'), { recursive: true });
    const env = { GITHUB_WORKSPACE: workspace, ACTION_THEME_PATH: 'themes/custom', ACTION_PRODUCTION_URL: 'https://site.test' };
    const input = await actionInputs(env);
    assert.equal(input.slug, 'custom');
    assert.equal(input.builds, true);
    assert.equal(input.publishes, false);
    assert.match(input.output, /\/dist$/);
    for (const output of ['.', 'themes', 'themes/custom', 'snapshots', '../outside', '.git/build', 'reports']) {
      await assert.rejects(actionInputs({ ...env, ACTION_OUTPUT_PATH: output }));
    }
    await symlink(tmpdir(), resolve(workspace, 'escape'));
    await assert.rejects(actionInputs({ ...env, ACTION_OUTPUT_PATH: 'escape/output' }), /inside the caller workspace/);
    await assert.rejects(actionInputs({ ...env, ACTION_THEME_SLUG: "bad';slug" }), /Invalid theme-slug/);
    await assert.rejects(actionInputs({ ...env, ACTION_MODE: 'unknown' }), /mode must/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('publishing requires explicit credentials and is refused on pull request events', async () => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'action-publish-'));
  try {
    const env = { GITHUB_WORKSPACE: workspace, ACTION_MODE: 'publish', ACTION_PRODUCTION_URL: 'https://site.test' };
    await assert.rejects(actionInputs(env), /requires spacefast-space and SPACEFAST_TOKEN/);
    const authenticated = { ...env, ACTION_SPACEFAST_SPACE: 'spc_existing', SPACEFAST_TOKEN: 'fixture' };
    const input = await actionInputs(authenticated);
    assert.equal(input.builds, false);
    assert.equal(input.publishes, true);
    for (const event of ['pull_request', 'pull_request_target']) {
      await assert.rejects(actionInputs({ ...authenticated, GITHUB_EVENT_NAME: event }), /disabled for pull request/);
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
