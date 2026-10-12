import yauzl from 'yauzl';
import CRC32 from 'crc-32';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from './config.mjs';

async function inspectDatabaseBuffer(sqliteBytes) {
  const dir = await mkdtemp(resolve(tmpdir(), 'static-playground-sqlite-'));
  const file = resolve(dir, '.ht.sqlite');
  try {
    await writeFile(file, sqliteBytes);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const integrityRow = db.prepare('PRAGMA integrity_check').get();
      const databaseIntegrity = integrityRow?.integrity_check || Object.values(integrityRow || {})[0];
      if (databaseIntegrity !== 'ok') throw new Error('SQLite integrity check failed');
      const rows = db.prepare("SELECT option_name, option_value FROM wp_options WHERE option_name IN ('_transient_wp_core_block_css_files', 'siteurl', 'home')").all();
      const options = Object.fromEntries(rows.map(r => [r.option_name, String(r.option_value ?? '')]));
      const versionMatch = options._transient_wp_core_block_css_files?.match(/s:7:"version";s:\d+:"([^"]+)";/);
      return {
        databaseIntegrity,
        detectedWordpressVersion: versionMatch?.[1] || null,
        databaseSiteUrl: options.siteurl || null,
        databaseHomeUrl: options.home || null,
      };
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Check the complete ZIP before passing it to WordPress's importer. No extraction of archive tree to disk.
export async function inspectArchive(file) {
  const bytes = await readFile(file);
  if (bytes.length > 250 * 1024 * 1024) throw new Error('Snapshot exceeds the v1 limit of 250 MiB.');
  const raw = await new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const names = new Set(); let total = 0; let manifest; let database = false; let sqliteBuffer = null;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        const name = entry.fileName;
        if (names.has(name.toLowerCase()) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.generalPurposeBitFlag & 1) return fail(new Error(`Unsafe ZIP entry: ${name}`));
        names.add(name.toLowerCase()); total += entry.uncompressedSize;
        if (total > 1024 * 1024 * 1024 || names.size > 50000) return fail(new Error('Expanded snapshot exceeds v1 limits.'));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = []; let length = 0; let crc = 0;
          stream.on('error', fail);
          stream.on('data', chunk => {
            length += chunk.length;
            crc = CRC32.buf(chunk, crc);
            if (name === 'playground-export.json' && length <= 65536) chunks.push(chunk);
            else if (name === 'wp-content/database/.ht.sqlite') chunks.push(chunk);
          });
          stream.on('end', () => {
            try {
              if (length !== entry.uncompressedSize) throw new Error(`Truncated ZIP entry: ${name}`);
              if ((crc >>> 0) !== entry.crc32) throw new Error(`ZIP checksum mismatch: ${name}`);
              if (name === 'playground-export.json') {
                if (length > 65536) throw new Error('Export manifest is too large.');
                manifest = JSON.parse(Buffer.concat(chunks).toString());
                if (![1, 2].includes(manifest.formatVersion) || typeof manifest.siteUrl !== 'string') throw new Error('Unsupported Playground export manifest.');
                if (!['http:', 'https:'].includes(new URL(manifest.siteUrl).protocol)) throw new Error('Export siteUrl must use HTTP or HTTPS.');
              }
              if (name === 'wp-content/database/.ht.sqlite') {
                sqliteBuffer = Buffer.concat(chunks);
                database = sqliteBuffer.subarray(0, 16).toString() === 'SQLite format 3\0';
              }
              zip.readEntry();
            } catch (error) { fail(error); }
          });
        });
      });
      zip.on('end', () => {
        if (!manifest || !database) return reject(new Error('Use a current Playground ZIP with playground-export.json and wp-content/database/.ht.sqlite at the archive root.'));
        resolvePromise({ sha256: sha256(bytes), bytes: bytes.length, entries: names.size, manifest, sqliteBuffer });
      });
      zip.readEntry();
    });
  });
  const dbInfo = await inspectDatabaseBuffer(raw.sqliteBuffer);
  return {
    sha256: raw.sha256,
    bytes: raw.bytes,
    entries: raw.entries,
    manifest: raw.manifest,
    ...dbInfo,
  };
}
