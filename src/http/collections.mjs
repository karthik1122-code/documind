import { randomBytes } from 'node:crypto';
import { createPipeline } from '../pipeline.mjs';

// "Your documents": uploaded text is indexed in memory only, for one hour, behind an unguessable id.
// Nothing is written to disk.
export const UPLOAD = { maxBody: 220 * 1024, maxFiles: 8, maxBytes: 150 * 1024, maxChunks: 300, maxCollections: 20, ttlMs: 60 * 60_000, nameOk: /\.(md|mdx|txt)$/i };
export const isCollectionId = id => /^[0-9a-f]{32}$/.test(String(id));

/** Validates uploaded files. Returns { docs } or { status, error } ready to send. */
export function checkFiles(files) {
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
}

/** The in-memory set of uploaded collections. Old ones expire; at most maxCollections are kept. */
export function createCollectionStore({ llm }) {
  const collections = new Map();
  let building = false;
  const sweep = () => { const now = Date.now(); for (const [id, c] of collections) if (now - c.created > UPLOAD.ttlMs) collections.delete(id); };
  const keep = (id, pipeline) => {
    if (collections.size >= UPLOAD.maxCollections) collections.delete([...collections.keys()][0]);
    collections.set(id, { pipeline, created: Date.now() });
  };
  // Throws { code: 'empty' | 'too_many_chunks' } for documents that cannot be indexed.
  const build = docs => createPipeline({ docs, llm, maxChunks: UPLOAD.maxChunks });

  return {
    get building() { return building; },
    get(id) { sweep(); return isCollectionId(id) ? collections.get(id)?.pipeline || null : null; },
    remove(id) { collections.delete(id); },
    /** Indexes new documents under a fresh random id. */
    create(docs) {
      sweep();
      building = true;
      try { const p = build(docs); const id = randomBytes(16).toString('hex'); keep(id, p); return { id, pipeline: p }; }
      finally { building = false; }
    },
    /** Serverless hosting can send a follow-up to a fresh instance; the browser re-sends the text and we rebuild under the same id. */
    rebuild(id, docs) { const p = build(docs); keep(id, p); return p; },
  };
}
