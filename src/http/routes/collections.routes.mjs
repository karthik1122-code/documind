import { json, readJson, clientIp, limited } from '../respond.mjs';
import { UPLOAD, checkFiles } from '../collections.mjs';

// POST /api/collections (index uploaded documents), DELETE /api/collections/:id (remove them now).
export async function collectionsRoutes(req, res, url, { collections }) {
  if (req.method === 'POST' && url.pathname === '/api/collections') {
    if (limited(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
    if (collections.building) return json(res, 429, { error: 'busy', message: 'Another set of documents is being indexed. Try again in a few seconds.' });
    const { body, status, error } = await readJson(req, UPLOAD.maxBody);
    if (error) return json(res, status, { error, message: error === 'too_large' ? 'That is more than 150 KB of text.' : 'The upload was not valid JSON.' });
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length || files.length > UPLOAD.maxFiles) return json(res, 400, { error: 'invalid_files', message: `Add between 1 and ${UPLOAD.maxFiles} documents.` });
    const checked = checkFiles(files); if (checked.error) return json(res, checked.status, checked.error);
    try {
      const { id, pipeline } = collections.create(checked.docs);
      return json(res, 201, { id, docs: pipeline.docs, chunks: pipeline.chunkCount, expiresInMinutes: UPLOAD.ttlMs / 60_000 });
    } catch (e) {
      if (e.code === 'empty' || e.code === 'too_many_chunks') return json(res, 422, { error: e.code, message: e.message });
      throw e;
    }
  }
  const del = url.pathname.match(/^\/api\/collections\/([0-9a-f]{32})$/);
  if (del && req.method === 'DELETE') { collections.remove(del[1]); return json(res, 200, { ok: true }); }
  return false;
}
