import { runCLI } from '@wp-playground/cli';
import { readFile } from 'node:fs/promises';
import { inspectArchive } from './archive.mjs';

export function buildUrlReplacements(inspected, serverUrl) {
  const current = serverUrl.replace(/\/$/, '');
  const origins = new Set(
    [inspected?.manifest?.siteUrl, inspected?.databaseSiteUrl, inspected?.databaseHomeUrl]
      .filter(Boolean)
      .map((u) => u.replace(/\/$/, '')),
  );
  const replacements = [];
  for (const old of origins) {
    replacements.push([old, current], [old.replaceAll('/', '\\/'), current.replaceAll('/', '\\/')]);
    const scope = new URL(old).pathname;
    if (scope.includes('/scope:')) replacements.push([scope.replace(/\/?$/, '/'), '/']);
  }
  return replacements.filter(([from, to]) => from !== to);
}

export async function normalizeCheckpointUrls(runtime, replacements) {
  if (!replacements.length) return;
  const encoded = Buffer.from(JSON.stringify(replacements)).toString('base64');
  await php(runtime, `
    global $wpdb;
    $pairs = json_decode(base64_decode('${encoded}'), true);
    if (!is_array($pairs) || empty($pairs)) return;
    if (!function_exists('sp_needs_replace')) {
      function sp_needs_replace($str, $pairs) {
        if (!is_string($str) || $str === '') return false;
        foreach ($pairs as $pair) {
          if (strpos($str, $pair[0]) !== false) return true;
        }
        return false;
      }
      function sp_replace_value($data, $pairs) {
        if (!is_string($data)) return $data;
        if (is_serialized($data)) {
          $unserialized = @unserialize($data);
          if ($unserialized !== false || $data === 'b:0;') {
            return serialize(sp_replace_recursive($unserialized, $pairs));
          }
        }
        foreach ($pairs as $pair) {
          $data = str_replace($pair[0], $pair[1], $data);
        }
        return $data;
      }
      function sp_replace_recursive($data, $pairs) {
        if (is_string($data)) return sp_replace_value($data, $pairs);
        if (is_array($data)) {
          $out = array();
          foreach ($data as $k => $v) {
            $out[sp_replace_recursive($k, $pairs)] = sp_replace_recursive($v, $pairs);
          }
          return $out;
        }
        if (is_object($data) && !($data instanceof __PHP_Incomplete_Class)) {
          foreach (get_object_vars($data) as $k => $v) {
            $data->$k = sp_replace_recursive($v, $pairs);
          }
          return $data;
        }
        return $data;
      }
    }
    $db = new PDO('sqlite:' . WP_CONTENT_DIR . '/database/.ht.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $prefix = $wpdb->prefix;
    $tables = $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN);
    $db->beginTransaction();
    foreach ($tables as $table) {
      if (strpos($table, $prefix) !== 0) continue;
      $escapedTable = str_replace('"', '""', $table);
      $colsInfo = $db->query('PRAGMA table_info("' . $escapedTable . '")')->fetchAll(PDO::FETCH_ASSOC);
      $pkCols = array();
      $textCols = array();
      foreach ($colsInfo as $col) {
        if ((int) $col['pk'] > 0) $pkCols[] = $col['name'];
        if ($col['name'] === 'guid') continue;
        $textCols[] = $col['name'];
      }
      if (empty($textCols)) continue;
      $useRowId = empty($pkCols);
      $selectSql = $useRowId
        ? 'SELECT rowid AS _sp_rowid, * FROM "' . $escapedTable . '"'
        : 'SELECT * FROM "' . $escapedTable . '"';
      $rows = $db->query($selectSql)->fetchAll(PDO::FETCH_ASSOC);
      foreach ($rows as $row) {
        $updates = array();
        $params = array();
        foreach ($textCols as $col) {
          $val = isset($row[$col]) ? $row[$col] : null;
          if (!sp_needs_replace($val, $pairs)) continue;
          $newVal = sp_replace_value($val, $pairs);
          if ($newVal !== $val) {
            $updates[] = '"' . str_replace('"', '""', $col) . '" = ?';
            $params[] = $newVal;
          }
        }
        if (empty($updates)) continue;
        $where = array();
        if ($useRowId) {
          $where[] = 'rowid = ?';
          $params[] = $row['_sp_rowid'];
        } else {
          foreach ($pkCols as $pk) {
            $where[] = '"' . str_replace('"', '""', $pk) . '" = ?';
            $params[] = $row[$pk];
          }
        }
        $updateSql = 'UPDATE "' . $escapedTable . '" SET ' . implode(', ', $updates) . ' WHERE ' . implode(' AND ', $where);
        $db->prepare($updateSql)->execute($params);
      }
    }
    $db->commit();
    wp_cache_flush();
  `);
}

export async function startRuntime(c, archive, preInspected = null) {
  const steps = archive ? [{ step: 'importWordPressFiles', wordPressFilesZip: { resource: 'literal', name: 'site.zip', contents: new Uint8Array(await readFile(archive)) } }] : [];
  const runtime = await runCLI({
    command: 'server', port: 0, wp: `https://wordpress.org/wordpress-${c.wordpressVersion}.zip`, php: c.phpVersion,
    ...(!archive && c.fixtureSourceUrl ? { 'site-url': c.fixtureSourceUrl } : {}),
    login: false, internalCookieStore: false, verbosity: process.env.PLAYGROUND_VERBOSE ? 'normal' : 'quiet', workers: 1,
    'define-bool': { DISABLE_WP_CRON: true, AUTOMATIC_UPDATER_DISABLED: true },
    wordpressInstallMode: 'download-and-install',
    blueprint: { extraLibraries: [], steps },
  });
  const address = runtime.server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await runtime[Symbol.asyncDispose]();
    throw new Error('Playground must bind only to loopback.');
  }
  try {
    const handshake = await fetch(runtime.serverUrl, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    await handshake.arrayBuffer();
    if (archive) {
      const inspected = preInspected || await inspectArchive(archive);
      const replacements = buildUrlReplacements(inspected, runtime.serverUrl);
      await normalizeCheckpointUrls(runtime, replacements);
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
