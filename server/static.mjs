// Serves the production build (dist/) from the same Node process as the API, so a
// deployment is one process: `npm run build && npm start`. No dependencies.
//
// - paths are resolved inside dist/ only (no traversal), dotfiles are never served
// - /assets/* are content-hashed by Vite, so they are cached for a year
// - HTML is always revalidated; other files are cached for a day
// - text-like files are gzip-compressed (and the result is cached in memory)

import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);

export function createStatic(distDir) {
  const root = resolve(distDir);
  const available = existsSync(join(root, 'index.html'));
  const gzCache = new Map(); // file path + mtime -> { buf, etag }

  function respond(req, res, file, { fallbackHtml = false } = {}) {
    const ext = extname(file).toLowerCase();
    const st = statSync(file);
    const isAsset = file.startsWith(join(root, 'assets') + sep);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || fallbackHtml ? 'no-cache' : isAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      'Last-Modified': st.mtime.toUTCString(),
    };
    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && st.size > 512;
    if (wantsGzip) {
      const key = `${file}:${st.mtimeMs}`;
      let entry = gzCache.get(key);
      if (!entry) {
        const buf = gzipSync(readFileSync(file), { level: 9 });
        entry = { buf, etag: `"${createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"` };
        gzCache.set(key, entry);
      }
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      headers.ETag = entry.etag;
      if (req.headers['if-none-match'] === entry.etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      headers['Content-Length'] = entry.buf.length;
      res.writeHead(200, headers);
      return req.method === 'HEAD' ? res.end() : res.end(entry.buf);
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file).pipe(res);
  }

  return {
    available,
    root,
    /** Returns true when the request was answered. */
    handle(req, res, pathname) {
      if (!available || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
      let rel;
      try {
        rel = decodeURIComponent(pathname);
      } catch {
        res.writeHead(400);
        res.end();
        return true;
      }
      if (rel.includes('\0') || rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return true;
      }
      const file = resolve(join(root, normalize(rel === '/' ? '/index.html' : rel)));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return true;
      }
      if (existsSync(file) && statSync(file).isFile()) {
        respond(req, res, file);
        return true;
      }
      // Navigation to an unknown path falls back to the game; a missing file with an extension is a real 404.
      if (!extname(rel)) {
        respond(req, res, join(root, 'index.html'), { fallbackHtml: true });
        return true;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return true;
    },
  };
}
