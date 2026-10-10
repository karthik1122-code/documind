# EXPLAIN.md: DocuMind, for the person who built it

Read this out loud before every interview. If you cannot explain a section without looking, read the file it names.

## The 30-second version

DocuMind answers questions about the Express 5 docs and shows which paragraph the answer came from. If the docs do not cover the question, it refuses instead of guessing. I built the evaluation first: 50 hand-written questions with a verified evidence phrase each. Every choice (how to split pages, which search method, when to refuse) was decided by a number from that set, not by taste. The honest result is that a local, no-key version refuses safely but answers under a third of questions correctly, which is why the next step is a language model reading the retrieved passages.

## The 2-minute version

1. **Corpus:** 16 Express 5 doc pages, CC BY 4.0, copied unchanged.
2. **Questions:** 50, in four types (lookup, paraphrase, multi-doc, unanswerable). Each answerable one has an evidence phrase that must exist in the corpus. A script checks this, and it runs in the tests.
3. **Chunking** (`src/chunk.mjs`): split at markdown headings, cap at 800 characters, prefix each chunk with page title and heading. At equal context cost this beat fixed-size windows.
4. **Retrieval** (`src/bm25.mjs`, `lsa.mjs`, `hybrid.mjs`, `rerank.mjs`): BM25 with a light stemmer, plus LSA (a small semantic index learned from the chunks), combined with reciprocal rank fusion, then reordered by a feature reranker.
5. **Answering** (`src/answer.mjs`): by default it copies the best-matching sentence. It refuses if the question uses words that never appear in the docs, or if no sentence covers enough of the question. With a model key, a model answers from the passages only, with `[n]` citations.
6. **Serving** (`server.mjs`, `public/`): a streaming API (server-sent events) and a chat UI that shows the passages, highlights the cited sentence, and shows "not covered by these docs" for refusals.

## Decisions and why

| Decision | Why | Trade-off |
|---|---|---|
| Evaluation before pipeline | Without numbers, every choice is an opinion. | A small set (35 answerable) is noisy: one question is 2.9 points. |
| Relevance = chunk contains evidence text | Compares different chunkings fairly. A chunk id changes with the chunker. | Needs a good evidence phrase per question. |
| Report context cost next to recall | Big chunks look better only because they contain more text. | One more column. |
| Heading-based chunks | Keeps one idea together and gives each chunk its context. | Sections vary in size, so long ones are split again. |
| Fixed hyperparameters, no tuning | Tuning on 35 questions would overfit them and the report would flatter itself. | Possibly leaves a little performance behind. |
| LSA instead of a downloaded model | No key or download needed, and it is something I can fully explain. | It is weak: it cannot connect words it never saw together. |
| Threshold picked on one half, reported on the other | The honest way to report a tuned setting. | Only 25 questions per half. |
| Refuse on unknown words | Questions about multer, JWT or Docker contain words that appear nowhere in the docs. A strong, cheap signal. | A paraphrase with unusual words can be refused wrongly. |
| Passages treated as data, delimiters neutralised, citations validated | A document can contain instructions aimed at the model. | Reduces the risk, does not remove it. Only a test with a real model shows how it holds. |
| Extractive by default | Nothing can be invented, and it works with no key. | Low answer rate. |

## What I found (these are the interview stories)

1. **Big chunks look better than they are.** Recall at k=3 rose from 57% to 91% as chunks grew from 400 to 1600 characters, but the model would receive four times as much text. Comparing at equal cost showed heading-based chunks winning (recall@1 65.7% vs 51.4% at about 2.2K characters).
2. **Fancy was not better.** Hashed n-gram vectors scored below plain keyword search. Hybrid helped recall@5 (88.6% to 94.3%) and the reranker helped the top result, but only by a question or two, so I say so.
3. **Two questions no local method can answer.** q01 ("my catch-all error middleware never fires for unknown URLs") and q23 ("error handler as (err, req, res) is ignored") share almost no words with the docs. That is the case for neural embeddings.
4. **A score threshold cannot separate "not covered" from "covered".** The top keyword score on unanswerable questions overlapped the answerable ones, because words like "express" match everything. That is why refusal uses coverage plus unknown-word share, and why I measured it on held-out questions.
5. **My own correctness check was too strict.** First I counted an answer as correct only if it contained the exact evidence phrase, which marked a correct "Node.js 18 or higher" sentence wrong. I added a looser token-overlap check and kept the strict one visible.
6. **A real server bug found by a test.** An oversized request destroyed the connection instead of returning 413. The test caught it and I changed it to discard the body and reply properly.
7. **Environment trap.** Port 4190 is on the browsers' blocked-ports list, so `fetch` refused it. Changed the test port.

## Likely interview questions

**1. What is RAG, and why not just paste all the docs into the prompt?**
Retrieval-augmented generation fetches the few relevant passages and gives only those to the model. Pasting everything costs more, hits context limits, and makes the model more likely to use the wrong part. Here 16 pages would fit, but the same design works for thousands.

**2. Why BM25 plus a semantic index instead of one?**
They fail differently. BM25 needs shared words but is precise on rare terms like `mergeParams`. A semantic index can bridge wording but can miss exact terms. Fusing ranks (RRF) takes the best of both without needing comparable scores.

**3. What is reciprocal rank fusion?**
Each retriever gives a ranked list. A passage's score is the sum of 1/(60 + rank) over the lists. It only uses ranks, so you do not need to normalise scores from different systems.

**4. What is LSA?**
Build a tf-idf matrix of chunks by terms, find its main directions with an eigen-decomposition, and represent each chunk and query by a few dozen coordinates. Terms that appear in the same chunks end up close. It is an old, small cousin of neural embeddings.

**5. How do you know the chunking is good?**
I compared strategies on the same questions, judged relevance by whether the chunk contains the evidence text, and reported the context cost beside recall so bigger chunks could not win just by being bigger.

**6. How does it avoid making things up?**
The default mode only copies sentences. In model mode the prompt allows only the supplied passages, requires citations, and the reply is discarded if it cites nothing valid or says NOT_IN_DOCS.

**7. What is prompt injection and how do you handle it here?**
A retrieved document can contain text like "ignore your instructions". Passages are wrapped in delimiters, delimiter text inside them is neutralised, the system prompt says passages are data, and replies must cite real passages. I wrote a test with 18 attacks for a real model. Until I have run it, I do not claim it is resistant.

**8. What is wrong with your evaluation?**
Small (35 answerable), written by me for one corpus, and the extractive refusal setting was tuned on half of it. One question is 2.9 points. It is good for catching regressions and comparing methods roughly, not for claiming accuracy on other docs.

**9. What would you do with more time?**
Run the neural-embedding and model-answer evaluations with a key, add a second corpus to test generalisation, have someone else write a third of the questions, and evaluate answer faithfulness with a stronger check than phrase overlap.

**10. How would this scale?**
Keep chunk vectors in a vector database (pgvector), build the index offline, cache query embeddings, and move reranking to a cross-encoder. The searcher interface already hides the index behind a `search(query, k)` call.

## Things I should say honestly

- All numbers are on my own 50 questions about one set of docs.
- The default mode is extractive and answers under a third of answerable questions. It is safe, not impressive.
- The model-based results are not measured yet, and the Gemini adapter has only run against a mock.
- I built this with AI assistance. I can walk through every file listed above and change any rule live.

## Files to know by heart

`src/chunk.mjs`, `src/bm25.mjs`, `src/hybrid.mjs`, `src/answer.mjs` (refusal logic and the prompt), `src/pipeline.mjs`, `eval/answer-eval.mjs`.
