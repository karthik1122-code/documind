import { json, readJson, clientIp, limited, securityHeaders } from '../respond.mjs';
import { UPLOAD, checkFiles, isCollectionId } from '../collections.mjs';

const MAX_QUESTION = 400;

// POST /api/ask: streams Server-Sent Events: sources first, then answer pieces, then the final answer.
export async function askRoutes(req, res, url, { pipeline, collections }) {
  if (req.method !== 'POST' || url.pathname !== '/api/ask') return false;
  if (limited(clientIp(req))) return json(res, 429, { error: 'rate_limited' });
  const { body, status, error } = await readJson(req, UPLOAD.maxBody);
  if (error) return json(res, status, { error });
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION) return json(res, 400, { error: 'invalid_question' });

  // Which index to search: the built-in docs, or an uploaded collection.
  let target = pipeline;
  if (body.collection !== undefined) {
    target = collections.get(body.collection);
    if (!target && isCollectionId(body.collection) && Array.isArray(body.files)) {
      const checked = checkFiles(body.files); if (checked.error) return json(res, checked.status, checked.error);
      try { target = collections.rebuild(body.collection, checked.docs); }
      catch (e) { if (e.code === 'empty' || e.code === 'too_many_chunks') return json(res, 422, { error: e.code, message: e.message }); throw e; }
    }
    if (!target) return json(res, 404, { error: 'collection_not_found', message: 'Those documents expired or were removed. Add them again.' });
  }

  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', ...securityHeaders });
  try {
    for await (const event of target.ask(question)) res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (err) {
    console.error(err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'The model call failed. Showing retrieved passages only.' })}\n\n`);
  }
  res.end();
  return true;
}
