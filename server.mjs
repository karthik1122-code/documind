import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { createPipeline } from './src/pipeline.mjs';
import { createGemini } from './src/providers.mjs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 4180);
const publicRoot = new URL('./public/', import.meta.url).pathname;
const MAX_BODY = 4 * 1024, MAX_QUESTION = 400;
// "Your documents": uploaded text is indexed in memory only, for one hour, behind an unguessable id. Nothing is written to disk.
const UPLOAD = { maxBody: 220 * 1024, maxFiles: 8, maxBytes: 150 * 1024, maxChunks: 300, maxCollections: 20, ttlMs: 60 * 60_000, nameOk: /\.(md|mdx|txt)$/i };
const collections = new Map();
let building = false;
const sweepCollections = () => { const now = Date.now(); for (const [id, c] of collections) if (now - c.created > UPLOAD.ttlMs) collections.delete(id); };
const llm = process.env.GEMINI_API_KEY ? createGemini() : null;
const pipeline = createPipeline({ corpusDir: new URL('./corpus', import.meta.url).pathname, llm });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const headers = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

// Small in-memory limiter: 20 questions per minute per client address.
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 20);
const hits = new Map();
const clientIp = req => ((process.env.VERCEL || process.env.TRUST_PROXY) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
const limited = ip => {
  const now = Date.now();
  // Forget visitors with no request in the last minute, so the map cannot grow without bound.
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] >= 60_000) hits.delete(k);
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000); list.push(now); hits.set(ip, list);
  return list.length > RATE_LIMIT;
};

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
const readBody = (req, max = MAX_BODY) => new Promise((resolve, reject) => {
  // Some serverless runtimes parse and consume the body before the handler runs.
  if (process.env.VERCEL && req.body !== undefined) { const t = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body); return t.length > max ? reject(Object.assign(new Error('too_large'), { status: 413 })) : resolve(t); }
  let size = 0, tooBig = false;
  const chunks = [];
  req.on('data', c => { if (tooBig) return; size += c.length; if (size > max) { tooBig = true; chunks.length = 0; req.resume(); reject(Object.assign(new Error('too_large'), { status: 413 })); } else chunks.push(c); });
  req.on('end', () => { if (!tooBig) resolve(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', reject);
});

// Validates uploaded files the same way for the upload route and for a rebuild after a restart or on another server instance.
const checkFiles = files => {
  if (!files.length || files.length > UPLOAD.maxFiles) return { status: 400, error: { error: 'invalid_files', message: `Add between 1 and ${UPLOAD.maxFiles} documents.` } };
  const docs = []; let bytes = 0;
  for (const f of files) {
    const name = String(f && f.name || '').split(/[\\/]/).pop().replace(/[^\w .()-]/g, '_').slice(0, 80);
    if (!UPLOAD.nameOk.test(name)) return { status: 400, error: { error: 'invalid_file_type', message: `"${name || 'unnamed'}" is not a .md, .mdx or .txt file.` } };
    if (typeof f.text !== 'string' || !f.text.trim()) return { status: 400, error: { error: 'empty_file', message: `"${name}" is empty.` } };
    bytes += Buffer.byteLength(f.text);
    docs.push({ file: name, text: f.text.replace(/\r\n/g, '\n').replace(/\u0000/g, '') });
  }
  if (bytes > UPLOAD.maxBytes) return { status: 413, error: { error: 'too_large', message: 'That is more than 150 KB of text.' } };
  return { docs };
};

export const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', mode: pipeline.mode, fallback: llm ? 'extractive' : null, docs: pipeline.docCount, chunks: pipeline.chunkCount, files: pipeline.docs });
    if (req.method === 'POST' && url.pathname === '/api/collections') {
      if (limited(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
      if (building) return json(res, 429, { error: 'busy', message: 'Another set of documents is being indexed. Try again in a few seconds.' });
      let body; try { body = JSON.parse(await readBody(req, UPLOAD.maxBody) || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.message === 'too_large' ? 'too_large' : 'invalid_json', message: e.message === 'too_large' ? 'That is more than 150 KB of text.' : 'The upload was not valid JSON.' }); }
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length || files.length > UPLOAD.maxFiles) return json(res, 400, { error: 'invalid_files', message: `Add between 1 and ${UPLOAD.maxFiles} documents.` });
      const checked = checkFiles(files); if (checked.error) return json(res, checked.status, checked.error);
      const docs = checked.docs;
      sweepCollections();
      building = true;
      try {
        let p;
        try { p = createPipeline({ docs, llm, maxChunks: UPLOAD.maxChunks }); }
        catch (e) { if (e.code === 'empty' || e.code === 'too_many_chunks') return json(res, 422, { error: e.code, message: e.message }); throw e; }
        if (collections.size >= UPLOAD.maxCollections) collections.delete([...collections.keys()][0]);
        const id = randomBytes(16).toString('hex');
        collections.set(id, { pipeline: p, created: Date.now() });
        return json(res, 201, { id, docs: p.docs, chunks: p.chunkCount, expiresInMinutes: UPLOAD.ttlMs / 60_000 });
      } finally { building = false; }
    }
    if (req.method === 'GET' && url.pathname === '/api/doc') {
      let target = pipeline; const cid = url.searchParams.get('collection');
      if (cid !== null) { sweepCollections(); const c = /^[0-9a-f]{32}$/.test(cid) && collections.get(cid); if (!c) return json(res, 404, { error: 'collection_not_found' }); target = c.pipeline; }
      const d = target.doc(url.searchParams.get('file') || '');
      if (!d) return json(res, 404, { error: 'doc_not_found' });
      return json(res, 200, d);
    }
    const del = url.pathname.match(/^\/api\/collections\/([0-9a-f]{32})$/);
    if (del && req.method === 'DELETE') { collections.delete(del[1]); return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      if (limited(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
      let body; try { body = JSON.parse(await readBody(req, UPLOAD.maxBody) || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.message === 'too_large' ? 'too_large' : 'invalid_json' }); }
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question || question.length > MAX_QUESTION) return json(res, 400, { error: 'invalid_question' });
      let target = pipeline;
      if (body.collection !== undefined) {
        sweepCollections();
        let c = typeof body.collection === 'string' && collections.get(body.collection);
        // Serverless hosting can route a follow-up request to a fresh instance. The browser still holds the text, so it may send it again and the index is rebuilt under the same id.
        if (!c && /^[0-9a-f]{32}$/.test(String(body.collection)) && Array.isArray(body.files)) {
          const checked = checkFiles(body.files); if (checked.error) return json(res, checked.status, checked.error);
          try { c = { pipeline: createPipeline({ docs: checked.docs, llm, maxChunks: UPLOAD.maxChunks }), created: Date.now() }; }
          catch (e) { if (e.code === 'empty' || e.code === 'too_many_chunks') return json(res, 422, { error: e.code, message: e.message }); throw e; }
          if (collections.size >= UPLOAD.maxCollections) collections.delete([...collections.keys()][0]);
          collections.set(body.collection, c);
        }
        if (!c) return json(res, 404, { error: 'collection_not_found', message: 'Those documents expired or were removed. Add them again.' });
        target = c.pipeline;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', ...headers });
      try {
        for await (const event of target.ask(question)) res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        console.error(error.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'The model call failed. Showing retrieved passages only.' })}\n\n`);
      }
      return res.end();
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      let requested; try { requested = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad_path' }); }
      if (requested === '/') requested = '/index.html';
      if (requested === '/app') requested = '/app.html';
      const path = normalize(join(publicRoot, requested));
      const type = mime[extname(path)];
      if (!path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep) || !type) return json(res, 404, { error: 'not_found' });
      let file; try { file = await readFile(path); } catch { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, { 'content-type': type, 'cache-control': /\.html$/.test(requested) ? 'no-cache' : 'public, max-age=300', ...headers });
      return res.end(req.method === 'HEAD' ? undefined : file);
    }
    json(res, 404, { error: 'not_found' });
  } catch (error) { console.error(error); if (!res.headersSent) json(res, 500, { error: 'internal_error' }); else res.end(); }
};
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(port, () => console.log(`DocuMind ready at http://localhost:${port} (${pipeline.mode})`));
}
