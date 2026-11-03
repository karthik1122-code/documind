import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPipeline } from './src/pipeline.mjs';
import { createGemini } from './src/providers.mjs';
import { createCollectionStore } from './src/http/collections.mjs';
import { createHandler } from './src/http/handler.mjs';

// Entry point: build the RAG pipeline over corpus/, then serve it. Request logic lives in src/http.
// Without GEMINI_API_KEY, answers are extractive (a cited sentence copied from the source).
const port = Number(process.env.PORT || 4180);
const llm = process.env.GEMINI_API_KEY ? createGemini() : null;
const pipeline = createPipeline({ corpusDir: new URL('./corpus', import.meta.url).pathname, llm });
const collections = createCollectionStore({ llm });

export const handler = createHandler({ pipeline, collections, llm });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(port, () => console.log(`DocuMind ready at http://localhost:${port} (${pipeline.mode})`));
}
