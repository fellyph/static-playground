import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validate } from '../scripts/validate.mjs';
import { saveJson } from '../scripts/lib/config.mjs';
import { runPublish } from '../scripts/publish.mjs';

test('validate ignores Spacefast CLI metadata files in output directory', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'validate-spacefast-'));
  const output = resolve(dir, 'dist');
  const reports = resolve(dir, 'reports');
  try {
    await mkdir(resolve(output, '.spacefast'), { recursive: true });
    await saveJson(resolve(reports, 'build.json'), {
      routes: ['/'],
      productionUrl: 'https://site.test',
      checkpoint: 'abc123',
    });
    await writeFile(resolve(output, 'index.html'), '<!doctype html><html><head><title>Home</title></head><body><h1>Hello</h1></body></html>');
    await writeFile(resolve(output, '.gitignore'), '.spacefast/state.json\n');
    await writeFile(resolve(output, '.spacefast/state.json'), '{"spaceId":"spc_123"}\n');

    const report = await validate({ output, reports });
    assert.equal(report.passed, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.files, 1);
    assert.equal('.gitignore' in report.hashes, false);
    assert.equal('.spacefast/state.json' in report.hashes, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate still rejects arbitrary unexpected dotfiles in output directory', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'validate-dotfiles-'));
  const output = resolve(dir, 'dist');
  const reports = resolve(dir, 'reports');
  try {
    await mkdir(output, { recursive: true });
    await saveJson(resolve(reports, 'build.json'), {
      routes: ['/'],
      productionUrl: 'https://site.test',
      checkpoint: 'abc123',
    });
    await writeFile(resolve(output, 'index.html'), '<!doctype html><html><body>Hi</body></html>');
    await writeFile(resolve(output, '.env'), 'SECRET=1');

    await assert.rejects(validate({ output, reports }), /Unsafe output path: \/\.env/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPublish surfaces redacted stderr diagnostics without leaking SPACEFAST_TOKEN', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'publish-redact-'));
  try {
    const command = resolve(dir, 'sf');
    await writeFile(
      command,
      '#!/bin/sh\necho "Auth failed for token sft_secret_token_999 and Bearer secret_jwt_123" >&2\nexit 1\n',
      { mode: 0o700 }
    );
    await assert.rejects(
      runPublish(command, dir, { ...process.env, SPACEFAST_TOKEN: 'sft_secret_token_999' }),
      error => {
        assert.match(error.message, /Spacefast publish failed with exit code 1/);
        assert.match(error.message, /Auth failed for token \[REDACTED\] and Bearer \[REDACTED\]/);
        assert.doesNotMatch(error.message, /sft_secret_token_999/);
        assert.doesNotMatch(error.message, /secret_jwt_123/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
