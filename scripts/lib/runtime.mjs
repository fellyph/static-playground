import { runCLI } from '@wp-playground/cli';
import { readFile } from 'node:fs/promises';
import { wpCLI } from '@wp-playground/blueprints';
import { inspectArchive } from './archive.mjs';

export async function startRuntime(c, archive) {
  const steps = archive ? [{ step: 'importWordPressFiles', wordPressFilesZip: { resource: 'literal', name: 'site.zip', contents: new Uint8Array(await readFile(archive)) } }] : [];
  const runtime = await runCLI({
    // The CLI's version resolver prefix-matches beta offers (7.1 can select
    // 7.1.1-RC1). An official release URL preserves the requested checkpoint.
    command: 'server', port: 0, wp: `https://wordpress.org/wordpress-${c.wordpressVersion}.zip`, php: c.phpVersion,
    ...(!archive && c.fixtureSourceUrl ? { 'site-url': c.fixtureSourceUrl } : {}),
    // Archive steps use /tmp across multiple calls; keep them on one worker.
    login: false, internalCookieStore: false, verbosity: process.env.PLAYGROUND_VERBOSE ? 'normal' : 'quiet', workers: 1,
    'define-bool': { DISABLE_WP_CRON: true, AUTOMATIC_UPDATER_DISABLED: true },
    wordpressInstallMode: 'download-and-install',
    blueprint: { extraLibraries: archive ? ['wp-cli'] : [], steps },
  });
  const address = runtime.server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await runtime[Symbol.asyncDispose]();
    throw new Error('Playground must bind only to loopback.');
  }
  // The CLI sends one anonymous session-reset redirect on its first request.
  // Consume it without cookies; keep Wget's no-redirect policy for real routes.
  try {
    const handshake = await fetch(runtime.serverUrl, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    await handshake.arrayBuffer();
    if (archive) {
      const { manifest } = await inspectArchive(archive);
      const old = manifest.siteUrl.replace(/\/$/, '');
      const current = runtime.serverUrl.replace(/\/$/, '');
      const replacements = [[old, current], [old.replaceAll('/', '\\/'), current.replaceAll('/', '\\/')]];
      const scope = new URL(old).pathname;
      if (scope.includes('/scope:')) replacements.push([scope.replace(/\/?$/, '/'), '/']);
      for (const [from, to] of replacements) {
        if (from === to) continue;
        const result = await wpCLI(runtime.playground, { command: ['wp', 'search-replace', from, to, '--all-tables-with-prefix', '--precise', '--skip-columns=guid', '--quiet'] });
        if (result.exitCode !== 0) throw new Error(`Checkpoint URL normalization failed: ${result.errors || result.text}`);
      }
    }
  } catch (error) { await runtime[Symbol.asyncDispose](); throw error; }
  return runtime;
}

export async function php(runtime, body) {
  const result = await runtime.playground.run({ code: `<?php require '/wordpress/wp-load.php'; ${body}` });
  if (result.exitCode !== 0) throw new Error(`PHP execution failed: ${result.errors || result.text}`);
  return result.text;
}

export async function metadata(runtime) {
  return JSON.parse(await php(runtime, `
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    global $wp_version, $wpdb;
    $themes = array(); foreach (wp_get_themes() as $slug => $theme) $themes[$slug] = $theme->get('Version');
    $plugins = array(); foreach (get_plugins() as $file => $plugin) $plugins[$file] = $plugin['Version'];
    $db = new PDO('sqlite:' . WP_CONTENT_DIR . '/database/.ht.sqlite');
    $integrity = $db->query('PRAGMA integrity_check')->fetchColumn();
    if ($integrity !== 'ok') throw new Exception('SQLite integrity check failed');
    echo wp_json_encode(array('wordpressVersion' => $wp_version, 'phpVersion' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
      'themes' => $themes, 'plugins' => $plugins, 'activeTheme' => get_stylesheet(), 'databaseIntegrity' => $integrity));
  `));
}
