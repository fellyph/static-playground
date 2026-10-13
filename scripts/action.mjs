import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { actionInputs } from './lib/action-inputs.mjs';

try {
  const input = await actionInputs();
  // Set caller paths before importing modules whose defaults are read at load time.
  Object.assign(process.env, {
    SITE_CONFIG: input.configFile, SNAPSHOT_DIR: input.snapshots,
    OUTPUT_DIR: input.output, REPORT_DIR: input.reports,
    PRODUCTION_URL: input.productionUrl, SPACEFAST_SPACE: input.space,
  });
  process.chdir(input.workspace);
  const { config, json } = await import('./lib/config.mjs');
  const c = await config();
  let build;
  if (input.builds) {
    const { build: render } = await import('./build.mjs');
    build = await render(c, { themeSource: input.source, themeSlug: input.slug });
  } else {
    build = await json(resolve(input.reports, 'build.json'));
  }
  let deployment;
  if (input.publishes) {
    if (process.env.GITHUB_SHA && build.commit !== process.env.GITHUB_SHA) throw new Error('Build report belongs to a different caller commit. Download artifacts from this workflow run.');
    const { publish } = await import('./publish.mjs');
    deployment = await publish(c);
  }
  const { formatBuildSummary } = await import('./summary.mjs');
  const validation = await json(resolve(input.reports, 'validation.json'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, formatBuildSummary({ build, validation, deployment }));
  if (process.env.GITHUB_OUTPUT) {
    const outputs = { 'output-path': input.output, 'report-path': input.reports, 'theme-sha256': build.theme?.sha256 || '', 'live-url': deployment?.liveUrl || '' };
    for (const [key, value] of Object.entries(outputs)) {
      if (/[\r\n]/.test(value)) throw new Error(`Invalid multiline action output: ${key}`);
      await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  }
} catch (error) {
  const message = error.message || String(error);
  console.error(process.env.SPACEFAST_TOKEN ? message.replaceAll(process.env.SPACEFAST_TOKEN, '[REDACTED]') : message);
  process.exitCode = 1;
}
