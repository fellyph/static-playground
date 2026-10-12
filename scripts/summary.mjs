import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { json, reportDir } from './lib/config.mjs';

export function formatBuildSummary({ build, validation, deployment }) {
  const lines = [
    '## Static Playground Build Summary',
    '',
    '| Metric | Value |',
    '| --- | --- |',
  ];
  if (build) {
    lines.push(`| Routes | ${build.routes?.length ?? 0} |`);
    lines.push(`| Local Assets | ${build.assetCount ?? 0} |`);
    lines.push(`| External Assets | ${build.externalAssets?.length ?? 0} |`);
    lines.push(`| Omitted Links | ${build.omittedLinks?.length ?? 0} |`);
    if (build.checkpoint) lines.push(`| Checkpoint SHA-256 | \`${build.checkpoint.slice(0, 12)}\` |`);
  }
  if (validation) {
    lines.push(`| Validation | ${validation.passed ? 'Passed' : 'Failed'} |`);
    lines.push(`| Checked Targets | ${validation.checkedTargets ?? 0} |`);
  }
  if (deployment?.liveUrl) {
    lines.push(`| Live URL | ${deployment.liveUrl} |`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === import.meta.filename) {
  const build = await json(resolve(reportDir, 'build.json')).catch(() => null);
  const validation = await json(resolve(reportDir, 'validation.json')).catch(() => null);
  const deployment = await json(resolve(reportDir, 'deployment.json')).catch(() => null);
  const summary = formatBuildSummary({ build, validation, deployment });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}
