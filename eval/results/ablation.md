### Sections, max 800 chars (198 chunks)

| Method | recall@1 | recall@3 | recall@5 | MRR | paraphrase recall@3 | Misses at k=5 |
|---|---|---|---|---|---|---|
| BM25 | 65.7% | 80.0% | 88.6% | 0.739 | 72.7% | q01, q06, q14, q23 |
| BM25 + stemming | 65.7% | 82.9% | 91.4% | 0.758 | 63.6% | q01, q23, q25 |
| Hashed n-gram vectors | 40.0% | 62.9% | 77.1% | 0.538 | 45.5% | q01, q02, q17, q18, q23, q26, q27, q30 |
| LSA (50 dims) | 54.3% | 74.3% | 88.6% | 0.663 | 54.5% | q01, q23, q30, q35 |
| Hybrid: BM25s + LSA (RRF) | 57.1% | 82.9% | 94.3% | 0.714 | 63.6% | q01, q23 |
| Hybrid: BM25s + LSA + hash (RRF) | 60.0% | 82.9% | 91.4% | 0.703 | 63.6% | q01, q23, q26 |
| BM25s + reranker | 68.6% | 85.7% | 91.4% | 0.769 | 54.5% | q01, q23, q25 |
| Hybrid BM25s + LSA + reranker | 71.4% | 85.7% | 91.4% | 0.784 | 54.5% | q01, q23, q25 |

### Sections, max 1600 chars (114 chunks)

| Method | recall@1 | recall@3 | recall@5 | MRR | paraphrase recall@3 | Misses at k=5 |
|---|---|---|---|---|---|---|
| BM25 | 68.6% | 80.0% | 94.3% | 0.776 | 63.6% | q02, q23 |
| BM25 + stemming | 62.9% | 85.7% | 88.6% | 0.75 | 72.7% | q01, q02, q23, q25 |
| Hashed n-gram vectors | 37.1% | 65.7% | 80.0% | 0.531 | 45.5% | q01, q02, q21, q23, q26, q27, q30 |
| LSA (50 dims) | 51.4% | 80.0% | 94.3% | 0.673 | 63.6% | q02, q21 |
| Hybrid: BM25s + LSA (RRF) | 62.9% | 88.6% | 91.4% | 0.749 | 72.7% | q01, q02, q23 |
| Hybrid: BM25s + LSA + hash (RRF) | 57.1% | 80.0% | 85.7% | 0.689 | 72.7% | q01, q02, q21, q23, q26 |
| BM25s + reranker | 65.7% | 88.6% | 94.3% | 0.769 | 63.6% | q01, q23 |
| Hybrid BM25s + LSA + reranker | 62.9% | 88.6% | 94.3% | 0.754 | 63.6% | q01, q23 |
