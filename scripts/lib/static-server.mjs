import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { safePath } from './urls.mjs';

export async function serve(directory) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml' };
  const server = http.createServer(async (req, res) => {
    try {
      let path = safePath(new URL(req.url, 'http://localhost').pathname).slice(1);
      if (!path || path.endsWith('/')) path += 'index.html';
      const bytes = await readFile(resolve(directory, path));
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolvePromise => server.close(resolvePromise)) };
}
