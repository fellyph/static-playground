import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const root = resolve(import.meta.dirname, '../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function saveJson(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
export async function config() {
  const file = process.env.SITE_CONFIG || resolve(root, 'site.config.json');
  const c = await json(file).catch(() => ({}));
  c.productionUrl = process.env.PRODUCTION_URL || c.productionUrl;
  c.spacefastSpace = process.env.SPACEFAST_SPACE || c.spacefastSpace;
  c.runtimeVersionsExplicit = Boolean(c.wordpressVersion && c.phpVersion);
  c.wordpressVersion = c.wordpressVersion || '6.8.3';
  c.phpVersion = c.phpVersion || '8.3';
  c.additionalRoutes ??= [];
  if (!c.productionUrl) throw new Error('Set PRODUCTION_URL or copy site.config.example.json to site.config.json.');
  const url = new URL(c.productionUrl);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('productionUrl must be an HTTPS origin, without a subdirectory or credentials.');
  }
  c.productionUrl = url.origin;
  if (!/^\d+\.\d+(\.\d+)?$/.test(c.wordpressVersion) || !/^\d+\.\d+$/.test(c.phpVersion)) throw new Error('Use explicit WordPress and PHP versions.');
  if (!Array.isArray(c.additionalRoutes) || c.additionalRoutes.some(r => typeof r !== 'string' || !r.startsWith('/') || r.startsWith('//') || /[?#]/.test(r))) throw new Error('additionalRoutes must contain absolute site paths without query strings.');
  return c;
}
export const snapshotDir = process.env.SNAPSHOT_DIR ? resolve(process.env.SNAPSHOT_DIR) : resolve(root, 'snapshots');
export const outputDir = process.env.OUTPUT_DIR ? resolve(process.env.OUTPUT_DIR) : resolve(root, 'dist');
export const reportDir = process.env.REPORT_DIR ? resolve(process.env.REPORT_DIR) : resolve(root, 'reports');
