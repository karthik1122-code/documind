/**
 * Chunkers return [{ id, file, heading, text }]. Chunks keep raw markdown so evidence phrases
 * (which include backticks) can be matched exactly.
 */

// Fixed-size windows with overlap, cut at whitespace so words are not split.
export function chunkFixed(docs, { size = 800, overlap = 100 } = {}) {
  const chunks = [];
  for (const { file, text } of docs) {
    let start = 0, n = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) { const cut = text.lastIndexOf(' ', end); if (cut > start + size / 2) end = cut; }
      chunks.push({ id: `${file}#${n++}`, file, heading: '', text: text.slice(start, end) });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}

// One chunk per markdown section (## or ###). Sections longer than maxChars are split with chunkFixed.
// Every chunk is prefixed with its document title and heading so a bare paragraph still has context.
export function chunkSections(docs, { maxChars = 1600, overlap = 100 } = {}) {
  const chunks = [];
  for (const { file, text } of docs) {
    const title = (text.match(/^title:\s*(.+)$/m) || [, file])[1].trim();
    const lines = text.split('\n');
    const sections = [];
    let heading = title, buf = [], inCode = false;
    const flush = () => { const body = buf.join('\n').trim(); if (body) sections.push({ heading, body }); buf = []; };
    for (const line of lines) {
      if (/^```/.test(line)) inCode = !inCode;
      const h = !inCode && line.match(/^#{2,3}\s+(.*)$/);
      if (h) { flush(); heading = h[1].trim(); } else buf.push(line);
    }
    flush();
    let n = 0;
    for (const s of sections) {
      const prefix = `${title} > ${s.heading}\n`;
      if (s.body.length <= maxChars) chunks.push({ id: `${file}#${n++}`, file, heading: s.heading, text: prefix + s.body });
      else for (const part of chunkFixed([{ file, text: s.body }], { size: maxChars, overlap })) chunks.push({ id: `${file}#${n++}`, file, heading: s.heading, text: prefix + part.text });
    }
  }
  return chunks;
}
