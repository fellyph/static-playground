import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config, json, saveJson, root, outputDir, reportDir } from './lib/config.mjs';
import { validate } from './validate.mjs';

function redact(text, token) {
  let safe = text || '';
  if (token) safe = safe.replaceAll(token, '[REDACTED]');
  return safe.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

export async function runPublish(executable, output, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ['publish', output, '--json'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', bytes => { out += bytes; });
    child.stderr.on('data', bytes => { err = (err + bytes).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => {
      const details = redact((err || out).trim(), environment?.SPACEFAST_TOKEN);
      if (code !== 0) return reject(new Error(`Spacefast publish failed with exit code ${code}.${details ? `\n${details}` : ''}`));
      try { resolvePromise(JSON.parse(out)); } catch { reject(new Error('Spacefast returned an invalid JSON receipt.')); }
    });
  });
}

export async function publish(c) {
  if (!c.spacefastSpace || c.spacefastSpace.includes('YOUR-')) throw new Error('Set SPACEFAST_SPACE to the target Space ID.');
  if (!process.env.SPACEFAST_TOKEN) throw new Error('SPACEFAST_TOKEN is required for publishing.');
  const build = await json(resolve(reportDir, 'build.json'));
  if (build.productionUrl !== c.productionUrl || new URL(c.productionUrl).hostname.endsWith('.example')) throw new Error('Build and production publishing URL must match a configured real destination.');
  await validate();
  const receipt = await runPublish(resolve(root, 'node_modules/.bin/sf'), outputDir, { ...process.env, SPACEFAST_SPACE: c.spacefastSpace, CI: 'true' });
  if (!receipt.data?.space?.liveUrl) throw new Error('Spacefast receipt has no live URL.');
  const deployment = { commit: process.env.GITHUB_SHA || build.commit, checkpoint: build.checkpoint, ...(build.theme ? { theme: build.theme } : {}), version: receipt.data.version?.ref, liveUrl: receipt.data.space.liveUrl, publishedAt: new Date().toISOString() };
  await saveJson(resolve(reportDir, 'deployment.json'), deployment);
  console.log(`Published: ${receipt.data.space.liveUrl}`);
  return deployment;
}
if (process.argv[1] === import.meta.filename) {
  try { await publish(await config()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
