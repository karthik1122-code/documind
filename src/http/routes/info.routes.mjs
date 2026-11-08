import { json } from '../respond.mjs';

// GET /api/health (what is loaded) and GET /api/doc (full text of one source, for the reader panel).
export async function infoRoutes(req, res, url, { pipeline, collections, llm }) {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/health') {
    return json(res, 200, { status: 'ok', mode: pipeline.mode, fallback: llm ? 'extractive' : null, docs: pipeline.docCount, chunks: pipeline.chunkCount, files: pipeline.docs });
  }
  if (url.pathname === '/api/doc') {
    let target = pipeline;
    const cid = url.searchParams.get('collection');
    if (cid !== null) { target = collections.get(cid); if (!target) return json(res, 404, { error: 'collection_not_found' }); }
    const d = target.doc(url.searchParams.get('file') || '');
    if (!d) return json(res, 404, { error: 'doc_not_found' });
    return json(res, 200, d);
  }
  return false;
}
