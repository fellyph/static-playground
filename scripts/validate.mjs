import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { outputDir, reportDir, json, saveJson, sha256 } from './lib/config.mjs';
import { html, css } from './lib/transform.mjs';
import { routeFile, safePath, temporaryUrl } from './lib/urls.mjs';

export async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in published output.');
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(directory, name + '/'));
    else result.push(name);
  }
  return result.sort();
}
export async function validate({ output = outputDir, reports = reportDir } = {}) {
  const errors = []; const checked = new Set(); const externalAssets = new Set();
  const build = await json(resolve(reports, 'build.json'));
  const files = await walk(output); const names = new Set(files); const hashes = {};
  for (const route of build.routes) if (!names.has(routeFile(route))) errors.push(`Missing route: ${route}`);
  function check(from) {
    return (raw, kind) => {
      if (!raw || /^(#|data:|mailto:|tel:|javascript:|blob:)/i.test(raw)) return raw;
      const url = new URL(raw, build.productionUrl + from);
      if (url.origin !== build.productionUrl) { if (kind.includes('asset')) externalAssets.add(url.href); return raw; }
      let path;
      try { path = safePath(url.pathname).slice(1); } catch (error) { errors.push(error.message); return raw; }
      if (url.search) errors.push(`Unexpected local query URL in ${from}: ${raw}`);
      const file = path.endsWith('/') || !path ? path + 'index.html' : path;
      checked.add(file);
      if (!names.has(file)) errors.push(`Missing local target in ${from}: ${url.pathname}`);
      return raw;
    };
  }
  for (const file of files) {
    try { safePath('/' + file); } catch (error) { errors.push(error.message); }
    const buffer = await readFile(resolve(output, file)); hashes[file] = sha256(buffer);
    if (!buffer.length) errors.push(`Empty output: ${file}`);
    if (/\.(html|css|m?js|json|svg|xml|txt)$/i.test(file)) {
      const text = buffer.toString();
      if (temporaryUrl(text)) errors.push(`Temporary URL remains in ${file}`);
      if (text.includes('<?php') || text.includes('SQLite format 3\0')) errors.push(`Private source bytes in ${file}`);
      try {
        if (file.endsWith('.html')) html(text, check('/' + file.replace(/index\.html$/, '')));
        if (file.endsWith('.css')) css(text, check('/' + file));
      } catch (error) { errors.push(`${file}: ${error.message}`); }
    }
  }
  const report = { passed: errors.length === 0, routes: build.routes.length, files: files.length, checkedTargets: checked.size, externalAssets: [...externalAssets].sort(), errors: [...new Set(errors)], hashes, checkpoint: build.checkpoint, productionUrl: build.productionUrl };
  await saveJson(resolve(reports, 'validation.json'), report);
  if (errors.length) throw new Error(`Static validation failed:\n${report.errors.join('\n')}`);
  console.log(`Validated ${files.length} files and ${checked.size} local targets.`);
  return report;
}
if (process.argv[1] === import.meta.filename) {
  try { await validate(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
