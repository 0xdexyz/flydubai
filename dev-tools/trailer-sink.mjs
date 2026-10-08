// Dev tool: receives trailer frames rendered in the browser (src/dev/Trailer.js)
// and writes them to trailer/frames/ for ffmpeg. Not part of the game.
//
//   node dev-tools/trailer-sink.mjs        (port 8792)

import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'trailer');
const FRAMES = join(ROOT, 'frames');
mkdirSync(FRAMES, { recursive: true });

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (url.pathname === '/reset') {
      rmSync(FRAMES, { recursive: true, force: true });
      mkdirSync(FRAMES, { recursive: true });
    } else if (url.pathname === '/frame') {
      const i = String(Number(url.searchParams.get('i'))).padStart(5, '0');
      writeFileSync(join(FRAMES, `f_${i}.jpg`), body);
    } else if (url.pathname === '/timeline') {
      writeFileSync(join(ROOT, 'timeline.json'), body);
    } else {
      res.writeHead(404, cors);
      return res.end();
    }
    res.writeHead(200, cors);
    res.end('ok');
  });
}).listen(8792, () => console.log('[trailer-sink] listening on http://localhost:8792 ->', ROOT));
