import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assetFile, routeFile, safePath } from './urls.mjs';
import { html, css } from './transform.mjs';
import { init, parse as parseModules } from 'es-module-lexer';

export async function download(url, file, allow404 = false) {
  await mkdir(dirname(file), { recursive: true });
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`Wget failed (network, HTTP unknown) for ${url}\n${error.message}`);
  }
  const status = response.status;
  const type = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(file, bytes);
  if ((status < 200 || status >= 300) && !(allow404 && status === 404)) {
    throw new Error(`Wget failed (8, HTTP ${status}) for ${url}`);
  }
  return { status, type };
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
    if (previous && previous !== key && new URL(previous).pathname !== url.pathname) throw new Error(`Asset collision: ${file}`);
    if (!previous) { files.set(file, key); queue.set(key, file); }
    return '/' + file.split('/').map(encodeURIComponent).join('/');
  }
  function rewriter(base) {
    return (raw, kind) => {
      if (!raw || /^(#|data:|mailto:|tel:|javascript:|blob:)/i.test(raw)) return raw;
      const isHint = kind === 'resource-hint' || (kind === 'canonical' && raw.startsWith('//'));
      const { url, internal } = local(raw, base);
      if (isHint) return internal ? null : raw;
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
    const rendered = html(await readFile(target, 'utf8'), rewriter(new URL(route, origin)), rewriteText)
      .replace(/<link\b[^>]*\brel=["']?(?:dns-prefetch|preconnect)["']?(?![^>]*\bhref=)[^>]*>/gi, '');
    await writeFile(target, rendered);
  }
  const notFound = resolve(output, '404.html');
  const missingUrl = new URL('/__static_playground_missing_page__/', origin);
  const missing = await download(missingUrl.href, notFound, true);
  if (missing.status !== 404) throw new Error('WordPress must return HTTP 404 for missing routes.');
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
