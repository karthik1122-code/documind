// Low-level HTTP helpers shared by every route.

export const MAX_BODY = 4 * 1024;
export const securityHeaders = {
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

export const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders });
  res.end(JSON.stringify(body));
  return true; // routes return this to say "handled"
};

export const readBody = (req, max = MAX_BODY) => new Promise((resolve, reject) => {
  // Some serverless runtimes parse and consume the body before the handler runs.
  if (process.env.VERCEL && req.body !== undefined) {
    const t = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    return t.length > max ? reject(Object.assign(new Error('too_large'), { status: 413 })) : resolve(t);
  }
  let size = 0, tooBig = false;
  const chunks = [];
  req.on('data', c => { if (tooBig) return; size += c.length; if (size > max) { tooBig = true; chunks.length = 0; req.resume(); reject(Object.assign(new Error('too_large'), { status: 413 })); } else chunks.push(c); });
  req.on('end', () => { if (!tooBig) resolve(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', reject);
});

/** Parses a JSON body. Returns { body } or { status, error } ready to send. */
export async function readJson(req, max) {
  try { return { body: JSON.parse(await readBody(req, max) || '{}') }; }
  catch (e) { return e.message === 'too_large' ? { status: e.status || 413, error: 'too_large' } : { status: 400, error: 'invalid_json' }; }
}

// Behind Vercel or a known proxy, the real visitor is the first X-Forwarded-For address.
export const clientIp = req => ((process.env.VERCEL || process.env.TRUST_PROXY) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

// Small in-memory limiter: RATE_LIMIT requests per minute per client address (per server instance).
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 20);
const hits = new Map();
export const limited = ip => {
  const now = Date.now();
  // Forget visitors with no request in the last minute, so the map cannot grow without bound.
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] >= 60_000) hits.delete(k);
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000); list.push(now); hits.set(ip, list);
  return list.length > RATE_LIMIT;
};
