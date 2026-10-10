import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const norm = s => s.replace(/\s+/g, ' ').trim();

/** Loads every .mdx file in a directory as { file, text }. */
export function loadCorpus(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.mdx')).sort().map(file => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}
