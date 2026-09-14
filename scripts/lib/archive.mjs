import yauzl from 'yauzl';
import CRC32 from 'crc-32';
import { readFile } from 'node:fs/promises';
import { sha256 } from './config.mjs';

// Check the complete ZIP before passing it to WordPress's importer. No extraction to disk.
export async function inspectArchive(file) {
  const bytes = await readFile(file);
  if (bytes.length > 250 * 1024 * 1024) throw new Error('Snapshot exceeds the v1 limit of 250 MiB.');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const names = new Set(); let total = 0; let manifest; let database = false;
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
          stream.on('data', chunk => { length += chunk.length; crc = CRC32.buf(chunk, crc); if (name === 'playground-export.json' || name === 'wp-content/database/.ht.sqlite') { if (name.endsWith('.json') && length <= 65536 || name.endsWith('.sqlite') && chunks.length === 0) chunks.push(chunk); } });
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
                database = Buffer.concat(chunks).subarray(0, 16).toString() === 'SQLite format 3\0';
              }
              zip.readEntry();
            } catch (error) { fail(error); }
          });
        });
      });
      zip.on('end', () => {
        if (!manifest || !database) return reject(new Error('Use a current Playground ZIP with playground-export.json and wp-content/database/.ht.sqlite at the archive root.'));
        resolve({ sha256: sha256(bytes), bytes: bytes.length, entries: names.size, manifest });
      });
      zip.readEntry();
    });
  });
}
