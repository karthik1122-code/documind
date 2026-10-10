// Deliberately small suffix stripper. Not Porter: fewer rules, easy to explain and test.
export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) { w = w.slice(0, -3); }
  else if (w.endsWith('ed') && w.length > 4) { w = w.slice(0, -2); }
  else if (w.endsWith('es') && w.length > 4) { w = w.slice(0, -2); }
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) { w = w.slice(0, -1); }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1); // response/responses -> respons
  if (w.length > 3 && w.at(-1) === w.at(-2) && !/[aeiouls]/.test(w.at(-1))) w = w.slice(0, -1); // runn -> run
  return w;
}
