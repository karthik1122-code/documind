// One self-contained HTML file: the real retrieval pipeline (BM25 + LSA + RRF + reranker + extractive answerer) running in the browser over the bundled Express 5 docs.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const R = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const mods = ['stem', 'bm25', 'chunk', 'corpus', 'lsa', 'hybrid', 'rerank', 'answer', 'pipeline'];
const wrap = name => {
  let s = R(`src/${name}.mjs`); const ex = [];
  s = s.replace(/^import\s*\{[^}]*\}\s*from\s*'node:[a-z]+';?$/gm, '');
  s = s.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+)\.mjs';?$/gm, (_, n, m) => `const {${n}} = M['${m}'];`);
  s = s.replace(/^export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/gm, (m0, n) => { ex.push(n); return m0.replace(/^export\s+/, ''); });
  s = s.replace(/^export\s*\{([^}]*)\};?$/gm, (_, n) => { ex.push(...n.split(',').map(x => x.trim())); return ''; });
  if (name === 'corpus') s = s.replace(/export function loadCorpus[\s\S]*$/, '').replace(/\/\*\*[^]*?\*\/\s*$/, '');
  if (/^(import|export)\b/m.test(s)) throw new Error(`unhandled import/export in ${name}`);
  return `M['${name}'] = (() => {\n${s}\nreturn { ${ex.join(', ')} };\n})();\n`;
};
const docs = readdirSync(new URL('../corpus/', import.meta.url)).filter(f => f.endsWith('.mdx')).sort().map(file => ({ file, text: R('corpus/' + file) }));
const html = R('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="/app.js"')).trim();
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const links = [...head.matchAll(/<link[^>]*(?:fonts|icon)[^>]*>/g)].map(m => m[0]).join('\n');
const css = R('public/style.css');
const app = R('public/app.js');
const shim = `
const Buffer = { byteLength: s => new TextEncoder().encode(s).length };
const M = {};
`;
const server = `
{
  const { createPipeline } = M.pipeline;
  const DOCS = ${JSON.stringify(docs)};
  const pipeline = createPipeline({ docs: DOCS });
  const collections = new Map();
  const UPLOAD = { maxFiles: 8, maxBytes: 150 * 1024, maxChunks: 300, nameOk: /\\.(md|mdx|txt)$/i };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = (init.method || 'GET').toUpperCase(), p = url.pathname;
    if (!p.includes('/api/')) return realFetch(input, init);
    const path = p.slice(p.indexOf('/api/')), body = init.body ? JSON.parse(init.body) : {};
    if (method === 'GET' && path === '/api/health') return json(200, { status: 'ok', mode: pipeline.mode, docs: pipeline.docCount, chunks: pipeline.chunkCount });
    if (method === 'POST' && path === '/api/collections') {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length || files.length > UPLOAD.maxFiles) return json(400, { error: 'invalid_files', message: 'Add between 1 and ' + UPLOAD.maxFiles + ' documents.' });
      const docs = []; let bytes = 0;
      for (const f of files) {
        const name = String(f && f.name || '').split(/[\\\\/]/).pop().replace(/[^\\w .()-]/g, '_').slice(0, 80);
        if (!UPLOAD.nameOk.test(name)) return json(400, { error: 'invalid_file_type', message: '"' + (name || 'unnamed') + '" is not a .md, .mdx or .txt file.' });
        if (typeof f.text !== 'string' || !f.text.trim()) return json(400, { error: 'empty_file', message: '"' + name + '" is empty.' });
        bytes += Buffer.byteLength(f.text); docs.push({ file: name, text: f.text.replace(/\\r\\n/g, '\\n').replace(/\\u0000/g, '') });
      }
      if (bytes > UPLOAD.maxBytes) return json(413, { error: 'too_large', message: 'That is more than 150 KB of text.' });
      let pp; try { pp = createPipeline({ docs, maxChunks: UPLOAD.maxChunks }); } catch (e) { if (e.code === 'empty' || e.code === 'too_many_chunks') return json(422, { error: e.code, message: e.message }); throw e; }
      const id = rid(); collections.set(id, pp);
      return json(201, { id, docs: pp.docs, chunks: pp.chunkCount, expiresInMinutes: 60 });
    }
    const del = path.match(/^\\/api\\/collections\\/([0-9a-f]{32})$/);
    if (del && method === 'DELETE') { collections.delete(del[1]); return json(200, { ok: true }); }
    if (method === 'POST' && path === '/api/ask') {
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question || question.length > 400) return json(400, { error: 'invalid_question' });
      let target = pipeline;
      if (body.collection !== undefined) { target = collections.get(body.collection); if (!target) return json(404, { error: 'collection_not_found', message: 'Those documents were removed. Add them again.' }); }
      const enc = new TextEncoder();
      const stream = new ReadableStream({ async start(c) { try { for await (const ev of target.ask(question)) { c.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\\n\\n')); await new Promise(r => setTimeout(r, 40)); } } catch (e) { c.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'error', message: 'Something went wrong.' }) + '\\n\\n')); } c.close(); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return json(404, { error: 'not_found' });
  };
}
`;
const out = `<title>DocuMind</title>
<meta name="description" content="Question answering over the Express 5 docs. Every answer cites its source passage, and questions the docs do not cover are refused. Runs entirely in your browser.">
${links}
<style>${css}</style>
${R('demo/landing.html')}
${body}
<script>
(async () => {
${shim}
${mods.map(wrap).join('\n')}
${server}
${app}
})();
</script>
`;
writeFileSync(new URL('./dist.html', import.meta.url), out);
console.log('built', out.length);
