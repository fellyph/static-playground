import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';

function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path));
}
function overlap(a, b) { return contains(a, b) || contains(b, a); }

// Resolve existing parent directories too, so symlinks cannot bypass path checks.
async function canonical(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return resolve(await canonical(dirname(path)), basename(path));
  }
}

export async function actionInputs(env = process.env) {
  if (!env.GITHUB_WORKSPACE) throw new Error('GITHUB_WORKSPACE is required. Check out the caller repository first.');
  const workspace = await realpath(env.GITHUB_WORKSPACE);
  const mode = env.ACTION_MODE || 'build';
  if (!['build', 'publish', 'build-and-publish'].includes(mode)) throw new Error('mode must be build, publish, or build-and-publish.');
  const builds = mode !== 'publish';
  const publishes = mode !== 'build';
  if (publishes && env.GITHUB_EVENT_NAME?.startsWith('pull_request')) throw new Error('Publishing is disabled for pull request events.');
  const productionUrl = new URL(env.ACTION_PRODUCTION_URL || '');
  if (productionUrl.protocol !== 'https:' || productionUrl.pathname !== '/' || productionUrl.search || productionUrl.hash || productionUrl.username || productionUrl.password) throw new Error('production-url must be an HTTPS origin without credentials or a subdirectory.');
  const space = (env.ACTION_SPACEFAST_SPACE || '').trim();
  if (publishes && (!space || !env.SPACEFAST_TOKEN)) throw new Error('Publishing requires spacefast-space and SPACEFAST_TOKEN.');

  async function callerPath(value, name) {
    if (!value || isAbsolute(value) || /[\r\n]/.test(value) || value.split(/[\\/]/).includes('.git')) throw new Error(`${name} must be a relative caller workspace path outside .git.`);
    const path = await canonical(resolve(workspace, value));
    if (path === workspace || !contains(workspace, path)) throw new Error(`${name} must be inside the caller workspace and cannot be its root.`);
    return path;
  }
  const output = await callerPath(env.ACTION_OUTPUT_PATH || 'dist', 'output-path');
  const reports = await callerPath(env.ACTION_REPORT_PATH || 'reports', 'report-path');
  const snapshots = await callerPath(env.ACTION_SNAPSHOT_PATH || 'snapshots', 'snapshot-path');
  const source = builds ? await callerPath(env.ACTION_THEME_PATH, 'theme-path') : undefined;
  const slug = builds ? env.ACTION_THEME_SLUG || basename(source) : undefined;
  if (builds && !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error('Invalid theme-slug. Use lowercase letters, numbers, hyphens, and underscores.');
  const configFile = await callerPath(env.ACTION_CONFIG_PATH || 'site.config.json', 'config-path');
  if (env.ACTION_CONFIG_PATH && !(await stat(configFile)).isFile()) throw new Error('config-path must point to a JSON file.');
  const protectedPaths = [snapshots, configFile, source, resolve(workspace, '.git')].filter(Boolean);
  // With uses: ./ the action and caller share a root. Protect the implementation too.
  if (env.GITHUB_ACTION_PATH) {
    for (const name of ['scripts', 'node_modules', 'action.yml', 'package.json', 'package-lock.json']) protectedPaths.push(await canonical(resolve(env.GITHUB_ACTION_PATH, name)));
  }
  if (overlap(output, reports) || protectedPaths.some(path => overlap(output, path) || overlap(reports, path))) throw new Error('Output/report paths must be separate from each other and from source, checkpoint, configuration, and action files.');
  return { mode, builds, publishes, workspace, source, slug, snapshots, output, reports, configFile, productionUrl: productionUrl.origin, space };
}
