import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { createPipeline } from './src/pipeline.mjs';
import { createGemini } from './src/providers.mjs';

const port = Number(process.env.PORT || 4180);
const publicRoot = new URL('./public/', import.meta.url).pathname;
const MAX_BODY = 4 * 1024, MAX_QUESTION = 400;
const llm = process.env.GEMINI_API_KEY ? createGemini() : null;
const pipeline = createPipeline({ corpusDir: new URL('./corpus', import.meta.url).pathname, llm });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const headers = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

// Small in-memory limiter: 20 questions per minute per client address.
const hits = new Map();
const limited = ip => { const now = Date.now(); const list = (hits.get(ip) || []).filter(t => now - t < 60_000); list.push(now); hits.set(ip, list); return list.length > 20; };

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let size = 0, tooBig = false;
  const chunks = [];
  req.on('data', c => { if (tooBig) return; size += c.length; if (size > MAX_BODY) { tooBig = true; chunks.length = 0; req.resume(); reject(Object.assign(new Error('too_large'), { status: 413 })); } else chunks.push(c); });
  req.on('end', () => { if (!tooBig) resolve(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', mode: pipeline.mode, docs: pipeline.docCount, chunks: pipeline.chunkCount });
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      if (limited(req.socket.remoteAddress || 'unknown')) return json(res, 429, { error: 'rate_limited' });
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.message === 'too_large' ? 'too_large' : 'invalid_json' }); }
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question || question.length > MAX_QUESTION) return json(res, 400, { error: 'invalid_question' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', ...headers });
      try {
        for await (const event of pipeline.ask(question)) res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        console.error(error.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'The model call failed. Showing retrieved passages only.' })}\n\n`);
      }
      return res.end();
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      let requested; try { requested = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad_path' }); }
      if (requested === '/') requested = '/index.html';
      const path = normalize(join(publicRoot, requested));
      const type = mime[extname(path)];
      if (!path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep) || !type) return json(res, 404, { error: 'not_found' });
      let file; try { file = await readFile(path); } catch { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, { 'content-type': type, 'cache-control': requested === '/index.html' ? 'no-cache' : 'public, max-age=300', ...headers });
      return res.end(req.method === 'HEAD' ? undefined : file);
    }
    json(res, 404, { error: 'not_found' });
  } catch (error) { console.error(error); if (!res.headersSent) json(res, 500, { error: 'internal_error' }); else res.end(); }
});
server.listen(port, () => console.log(`DocuMind ready at http://localhost:${port} (${pipeline.mode})`));
