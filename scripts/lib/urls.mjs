import path from 'node:path';
import { sha256 } from './config.mjs';

export function safePath(raw) {
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new Error(`Invalid encoded path: ${raw}`); }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p === '..' || p === '.' || p.startsWith('.')) || /[<>:"|?*]/.test(decoded)) throw new Error(`Unsafe output path: ${raw}`);
  if (/\.(php\d*|phtml|phar|sqlite\d*|sql|zip|log)(?:\/|$)/i.test(decoded) || /^\/(wp-admin|wp-json|wp-content\/(database|cache|upgrade|backups?))(\/|$)/i.test(decoded)) throw new Error(`Non-public path: ${raw}`);
  return decoded;
}
export function routeFile(route) {
  const clean = safePath(route);
  if (clean !== '/' && !clean.endsWith('/')) throw new Error(`Route must have a trailing slash: ${route}`);
  return clean.slice(1) + 'index.html';
}
export function assetFile(url) {
  const clean = safePath(url.pathname).slice(1);
  if (!clean || clean.endsWith('/')) throw new Error(`Asset has no filename: ${url.pathname}`);
  const query = new URLSearchParams(url.search);
  query.delete('ver');
  if (!query.size) return clean;
  const ext = path.posix.extname(clean);
  return clean.slice(0, clean.length - ext.length) + '.' + sha256(query.toString()).slice(0, 12) + ext;
}
export function temporaryUrl(text) {
  const plain = text.replaceAll('\\/', '/');
  return /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/"\s]|$)|playground\.wordpress\.net\/(?:scope:|wp-content\/|wp-includes\/|wp-admin\/|wp-json\/)|\/scope:[a-zA-Z0-9_-]+\//i.test(plain);
}
