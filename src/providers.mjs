/**
 * Gemini adapter (REST, no SDK). Written from the public API shape; it has been exercised only
 * against a mocked fetch, not the live service, because no API key is available where it was written.
 * Run `npm run eval:gemini` with GEMINI_API_KEY set to verify it end to end.
 *
 * The key is read from the environment only. It is sent in a header, never in a URL.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Overloaded (503), rate limited (429) and other server errors are worth retrying; a bad request is not.
const RETRYABLE = status => status === 429 || status >= 500;

export function createGemini({
  apiKey = process.env.GEMINI_API_KEY,
  embedModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  model = process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  fallbackModel = process.env.GEMINI_FALLBACK_MODEL || '',
  attempts = 3,
  retryDelayMs = 600,
  fetchImpl = fetch,
  dims = 768,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  const post = async (path, body, signal) => {
    const res = await fetchImpl(`${BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
    return res;
  };
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
  });
  /** Tries the main model a few times with backoff, then the fallback model, before giving up. */
  const withRetry = async (call, signal) => {
    let last;
    for (const m of [model, fallbackModel].filter(Boolean)) {
      for (let i = 0; i < attempts; i += 1) {
        try { return await call(m); } catch (e) {
          last = e;
          if (signal?.aborted || !RETRYABLE(e.status)) throw e;
          if (i < attempts - 1) await sleep(retryDelayMs * 2 ** i, signal);
        }
      }
    }
    throw last;
  };
  const body = (system, user) => ({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0 } });
  return {
    name: `gemini:${model}`,
    /** Embeds texts in batches of up to 100. task is RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY. */
    async embed(texts, task = 'RETRIEVAL_DOCUMENT') {
      const out = [];
      for (let i = 0; i < texts.length; i += 100) {
        const batch = texts.slice(i, i + 100);
        const res = await post(`models/${embedModel}:batchEmbedContents`, { requests: batch.map(text => ({ model: `models/${embedModel}`, content: { parts: [{ text }] }, taskType: task, outputDimensionality: dims })) });
        const json = await res.json();
        for (const e of json.embeddings) out.push(normalise(e.values));
      }
      return out;
    },
    async generate({ system, user, signal }) {
      const res = await withRetry(m => post(`models/${m}:generateContent`, body(system, user), signal), signal);
      const json = await res.json();
      return (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    },
    /** Yields text fragments as they arrive (server-sent events). Retries happen only before the first fragment. */
    async *stream({ system, user, signal }) {
      const res = await withRetry(m => post(`models/${m}:streamGenerateContent?alt=sse`, body(system, user), signal), signal);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const part of res.body) {
        buffer += decoder.decode(part, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const json = JSON.parse(data);
          const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
          if (text) yield text;
        }
      }
    },
  };
}

const normalise = v => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };

/** Dense index over any embedder with embed(texts, task). Searching is async because embedding the query is. */
export async function buildDenseIndex(chunks, embedder) {
  const vecs = await embedder.embed(chunks.map(c => c.text), 'RETRIEVAL_DOCUMENT');
  return {
    async search(query, k = 10) {
      const [q] = await embedder.embed([query], 'RETRIEVAL_QUERY');
      return chunks.map((chunk, i) => { let s = 0; for (let d = 0; d < q.length; d += 1) s += q[d] * vecs[i][d]; return { chunk, score: s }; }).sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}
