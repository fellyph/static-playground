import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { safePath } from './urls.mjs';
import { outputDir } from './config.mjs';

export async function serve(directory, port = 0) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };
  const server = http.createServer(async (req, res) => {
    try {
      let path = safePath(new URL(req.url, 'http://localhost').pathname).slice(1);
      if (!path || path.endsWith('/')) path += 'index.html';
      const bytes = await readFile(resolve(directory, path));
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolvePromise => server.listen(port, '127.0.0.1', resolvePromise));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolvePromise => server.close(resolvePromise)) };
}
if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT || 8080);
  const instance = await serve(outputDir, port);
  console.log(`Preview server listening at ${instance.url}`);
}
