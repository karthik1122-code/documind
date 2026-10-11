/**
 * Gemini adapter (REST, no SDK). Written from the public API shape; it has been exercised only
 * against a mocked fetch, not the live service, because no API key is available where it was written.
 * Run `npm run eval:gemini` with GEMINI_API_KEY set to verify it end to end.
 *
 * The key is read from the environment only. It is sent in a header, never in a URL.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createGemini({ apiKey = process.env.GEMINI_API_KEY, embedModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001', model = process.env.GEMINI_MODEL || 'gemini-3.8-flash', fetchImpl = fetch, dims = 768 } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  const post = async (path, body) => {
    const res = await fetchImpl(`${BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  };
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
    async generate({ system, user }) {
      const res = await post(`models/${model}:generateContent`, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0 } });
      const json = await res.json();
      return (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    },
    /** Yields text fragments as they arrive (server-sent events). */
    async *stream({ system, user }) {
      const res = await post(`models/${model}:streamGenerateContent?alt=sse`, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0 } });
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
