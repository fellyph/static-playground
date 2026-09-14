import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assetFile, routeFile, safePath } from './urls.mjs';
import { html, css } from './transform.mjs';
import { init, parse as parseModules } from 'es-module-lexer';

export async function download(url, file, allow404 = false) {
  await mkdir(dirname(file), { recursive: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn('wget', ['--no-config', '--no-proxy', '--no-cookies', '--timeout=30', '--tries=2', '--max-redirect=0', '--server-response', '--content-on-error', '--output-document', file, '--', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', data => { log = (log + data).slice(-16000); });
    child.on('error', reject);
    child.on('close', code => {
      const status = [...log.matchAll(/HTTP\/\S+ (\d+)/g)].at(-1)?.[1];
      const type = [...log.matchAll(/Content-Type:\s*([^\r\n]+)/gi)].at(-1)?.[1] || '';
      if (code !== 0 && !(allow404 && status === '404')) reject(new Error(`Wget failed (${code}, HTTP ${status || 'unknown'}) for ${url}\n${log}`));
      else resolvePromise({ status: Number(status), type });
    });
  });
}

export async function capture({ origin, oldOrigin, productionUrl, routes, output }) {
  await init;
  const queue = new Map(); const files = new Map(); const external = new Set(); const references = []; const omittedLinks = [];
  const origins = [origin, oldOrigin].filter(Boolean).map(s => s.replace(/\/$/, '')).sort((a, b) => b.length - a.length);
  function local(raw, base) {
    let value = raw;
    for (const from of origins) if (value === from || value.startsWith(from + '/') || value.startsWith(from + '?')) { value = origin + value.slice(from.length); break; }
    const url = new URL(value, base);
    return { url, internal: url.origin === origin || url.origin === productionUrl || url.hostname === new URL(origin).hostname };
  }
  function enqueue(url) {
    const file = assetFile(url);
    const key = new URL(url.pathname + url.search, origin).href;
    const previous = files.get(file);
    // WordPress's version query identifies a cache key, not a separate response.
    if (previous && previous !== key && new URL(previous).pathname !== url.pathname) throw new Error(`Asset collision: ${file}`);
    if (!previous) { files.set(file, key); queue.set(key, file); }
    return '/' + file.split('/').map(encodeURIComponent).join('/');
  }
  function rewriter(base) {
    return (raw, kind) => {
      if (!raw || /^(#|data:|mailto:|tel:|javascript:|blob:)/i.test(raw)) return raw;
      const { url, internal } = local(raw, base);
      if (!internal) { if (kind.includes('asset')) external.add(url.href); return raw; }
      if (kind === 'link' && /^\/(wp-admin(?:\/|$)|wp-login\.php(?:$|\/))/.test(url.pathname)) {
        omittedLinks.push({ from: new URL(base).pathname, target: url.pathname, reason: 'WordPress administration is unavailable on the static host.' });
        return null;
      }
      safePath(url.pathname);
      let target;
      if (kind.includes('asset') || kind === 'link' && /\.(png|jpe?g|gif|webp|avif|svg|pdf|mp[34]|webm|ogg|wav|woff2?|ttf|css|m?js)$/i.test(url.pathname)) target = enqueue(url);
      else {
        if (url.search) throw new Error(`Dynamic local link needs an explicit static route: ${url.pathname}${url.search}`);
        target = url.pathname;
      }
      references.push({ from: new URL(base).pathname, target, kind });
      return (kind === 'canonical' || kind === 'social-asset' ? productionUrl : '') + target + url.hash;
    };
  }
  function rewriteText(text) {
    for (const from of origins) {
      text = text.replaceAll(from, productionUrl).replaceAll(from.replaceAll('/', '\\/'), productionUrl.replaceAll('/', '\\/'));
    }
    return text;
  }
  for (const route of routes) {
    const file = routeFile(route);
    files.set(file, new URL(route, origin).href);
    const target = resolve(output, file);
    const response = await download(new URL(route, origin).href, target);
    if (!response.type.includes('text/html')) throw new Error(`Expected HTML for ${route}, received ${response.type}`);
    await writeFile(target, html(await readFile(target, 'utf8'), rewriter(new URL(route, origin)), rewriteText));
  }
  const notFound = resolve(output, '404.html');
  const missingUrl = new URL('/__static_playground_missing_page__/', origin);
  const missing = await download(missingUrl.href, notFound, true);
  if (missing.status !== 404) throw new Error('WordPress must return HTTP 404 for missing routes.');
  // Themes often include native search on their 404 template; use a static 404 instead.
  await writeFile(notFound, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>Page not found</h1><p><a href="/">Return home</a></p></html>');
  for (const [url, file] of queue) {
    if (queue.size > 20000) throw new Error('Asset limit exceeded (20,000).');
    const target = resolve(output, file);
    const response = await download(url, target);
    if (response.type.includes('text/html')) throw new Error(`Asset returned HTML: ${url}`);
    if (/\.css$/i.test(file)) await writeFile(target, rewriteText(css(await readFile(target, 'utf8'), rewriter(url))));
    else if (/\.m?js$/i.test(file)) {
      let text = await readFile(target, 'utf8');
      const [imports] = parseModules(text);
      for (const item of imports.toReversed()) {
        if (!item.n || !/^(\.|\/|https?:)/.test(item.n)) continue;
        const replacement = rewriter(url)(item.n, 'asset');
        text = text.slice(0, item.s) + (item.d >= 0 ? JSON.stringify(replacement) : replacement) + text.slice(item.e);
      }
      await writeFile(target, rewriteText(text));
    } else if (/\.(json|svg|xml|txt)$/i.test(file)) await writeFile(target, rewriteText(await readFile(target, 'utf8')));
  }
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  await writeFile(resolve(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + routes.map(route => `<url><loc>${escape(productionUrl + route)}</loc></url>`).join('') + '</urlset>');
  await writeFile(resolve(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${productionUrl}/sitemap.xml\n`);
  return { routes, references, omittedLinks, externalAssets: [...external].sort(), assetCount: queue.size };
}
