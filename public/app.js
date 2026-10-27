const $ = id => document.getElementById(id);
const EXAMPLES = [
  'How do I make part of a route path optional?',
  "How do I turn on all of Express's internal debug logs?",
  'Which Node.js version can run .ts files directly?',
  'What function must a template engine export so res.render can use it?',
  'How do I store user sessions in Redis?',
  'How do I protect against CSRF attacks?',
];
const REASONS = {
  unknown_terms: 'The question uses terms that never appear in these docs.',
  low_coverage: 'No passage covers enough of what you asked to answer safely. These thresholds were tuned on the Express docs, so on your own documents they may be stricter or looser than ideal.',
  model_abstained: 'The model found nothing in the retrieved passages that answers this.',
  no_valid_citation: 'The model replied without citing a retrieved passage, so the reply was discarded.',
};
const app = $('app'); const emptyR = $('emptyR');
const nice = f => f.replace(/__/g, ' / ').replace(/\.(mdx|md|txt)$/, '');
const sentences = t => t.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

let collection = null, mineTab = false, collFiles = [], corpusFiles = [];
let collPayload = []; const collTexts = new Map();
const docCache = new Map();
const turns = []; let cur = -1; let selSrc = -1;

/* ---------- source switch ---------- */
const setScope = () => {
  $('h1').innerHTML = mineTab ? 'What do you want to <span class="hl">find</span> in your files?' : 'What do you want to <span class="hl">find</span>?';
  $('q').placeholder = mineTab ? (collection ? 'Ask about your documents' : 'Add documents above first') : 'Ask about routing, middleware, error handling';
  $('chips').hidden = mineTab || app.classList.contains('asked');
  $('panel-mine').hidden = !mineTab;
};
const setTab = mine => {
  mineTab = mine; if (!mine) { collection = null; collFiles = []; collPayload = []; collTexts.clear(); }
  $('tab-express').classList.toggle('on', !mine); $('tab-mine').classList.toggle('on', mine);
  $('tab-express').setAttribute('aria-selected', String(!mine)); $('tab-mine').setAttribute('aria-selected', String(mine));
  app.classList.remove('asked'); $('turn').hidden = true; setScope(); fillPages(); clearReader();
};
$('tab-express').onclick = () => setTab(false); $('tab-mine').onclick = () => setTab(true);

/* ---------- reader ---------- */
const fillPages = () => {
  const files = mineTab ? collFiles : corpusFiles;
  const sel = $('pg'); sel.replaceChildren();
  const first = document.createElement('option'); first.value = ''; first.textContent = files.length ? `Browse ${files.length} pages` : (mineTab ? 'No documents yet' : 'Loading…'); sel.append(first);
  for (const f of files) { const o = document.createElement('option'); o.value = f; o.textContent = nice(f); sel.append(o); }
};
$('pg').onchange = () => { const f = $('pg').value; if (f) openDoc(f, null); };
const getDoc = async file => {
  if (collection) { if (collTexts.has(file)) return { file, text: collTexts.get(file) }; throw new Error('page'); }
  const key = 'c|' + file; if (docCache.has(key)) return docCache.get(key);
  const res = await fetch(`/api/doc?file=${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error('page');
  const d = await res.json(); docCache.set(key, d); return d;
};
const clearReader = () => { $('rb').replaceChildren(emptyR); emptyR.hidden = false; $('legend').hidden = true; $('step').hidden = true; $('pg').value = ''; };
/* ranges: {passage:[s,e]|null, marks:[[s,e],...]} in characters of the raw page text */
function paint(doc, hit) {
  const rb = $('rb'); rb.replaceChildren();
  const text = doc.text; const lines = text.split('\n'); let off = 0;
  const P = hit && hit.passage, M = (hit && hit.marks) || [];
  const frag = document.createDocumentFragment(); let firstMark = null, firstPass = null;
  lines.forEach((ln, i) => {
    const s = off, e = off + ln.length; off = e + 1;
    const row = document.createElement('div'); row.className = 'ln';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    const c = document.createElement('span'); c.className = 'c';
    const inP = P && s < P[1] && e >= P[0] && !(e === P[0]); if (inP) { row.classList.add('inp'); if (!firstPass) firstPass = row; }
    if (/^#{1,3}\s/.test(ln) || /^title:/.test(ln)) row.classList.add('h');
    const cuts = new Set([s, e]); for (const [a, b] of M) { if (a < e && b > s) { cuts.add(Math.max(a, s)); cuts.add(Math.min(b, e)); } }
    const pts = [...cuts].sort((x, y) => x - y);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1]; if (a === b) continue;
      const piece = text.slice(a, b); const marked = M.some(([x, y]) => a >= x && b <= y);
      if (marked) { const m = document.createElement('mark'); m.textContent = piece; c.append(m); if (!firstMark) firstMark = m; } else c.append(document.createTextNode(piece));
    }
    if (!ln) c.textContent = ' ';
    row.append(n, c); frag.append(row);
  });
  rb.append(frag);
  const target = firstMark || firstPass;
  if (target) requestAnimationFrame(() => { const r = rb.getBoundingClientRect(), t = target.getBoundingClientRect(); rb.scrollTop += t.top - r.top - rb.clientHeight * 0.28; if (firstMark) { firstMark.classList.remove('flash'); void firstMark.offsetWidth; firstMark.classList.add('flash'); } });
  else rb.scrollTop = 0;
  $('legend').hidden = !hit; 
}
async function openDoc(file, hit) {
  try { const d = await getDoc(file); paint(d, hit); $('pg').value = [...$('pg').options].some(o => o.value === file) ? file : ''; }
  catch { $('rb').textContent = 'That page could not be loaded.'; }
}
const locate = (doc, src, answerText) => {
  const text = doc.text; const hit = { passage: null, marks: [] };
  const body = src.text.slice(src.text.indexOf('\n') + 1).trim();
  const i = body ? text.indexOf(body) : -1;
  if (i >= 0) hit.passage = [i, i + body.length];
  if (answerText) for (const s of sentences(answerText)) { const j = text.indexOf(s); if (j >= 0) hit.marks.push([j, j + s.length]); }
  return hit;
};

/* ---------- turn rendering ---------- */
function selectSource(t, i, scrollIntoReader) {
  selSrc = i; const src = t.sources[i]; if (!src) return;
  document.querySelectorAll('#ev .row').forEach((r, k) => r.classList.toggle('sel', k === i));
  $('step').hidden = false; $('stepLbl').textContent = `${i + 1} of ${t.sources.length}`;
  getDoc(src.file).then(d => {
    const cited = t.answer && !t.answer.abstained && t.answer.citations.some(c => c.id === src.id);
    paint(d, locate(d, src, cited ? t.answer.text : ''));
    $('pg').value = [...$('pg').options].some(o => o.value === src.file) ? src.file : '';
  }).catch(() => { $('rb').textContent = 'That page could not be loaded.'; });
  if (scrollIntoReader && matchMedia('(max-width:1000px)').matches) $('reader').scrollIntoView({ behavior: 'smooth' });
}
const step = d => { const t = turns[cur]; if (!t || !t.sources.length) return; selectSource(t, (selSrc + d + t.sources.length) % t.sources.length); };
$('prev').onclick = () => step(-1); $('next').onclick = () => step(1);

function renderEvidence(t) {
  const ev = $('ev'); if (!t.sources.length) { ev.replaceChildren(); return; }
  const max = Math.max(...t.sources.map(s => s.score)) || 1;
  const cited = new Set(t.answer && !t.answer.abstained ? t.answer.citations.map(c => c.id) : []);
  const h = document.createElement('h3'); h.textContent = t.answer && t.answer.abstained ? 'Closest passages, not an answer' : 'Passages retrieved';
  const ol = document.createElement('ol');
  t.sources.forEach((s, i) => {
    const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'row' + (cited.has(s.id) ? ' cited' : '') + (i === selSrc ? ' sel' : '');
    b.innerHTML = `<span class="no">${i + 1}</span><span><span class="t"></span><span class="f"></span></span><span class="bar2" title="score ${s.score}"><i></i></span>`;
    b.querySelector('.t').textContent = s.heading || nice(s.file);
    if (cited.has(s.id)) { const g = document.createElement('span'); g.className = 'tag'; g.textContent = 'ANSWER'; b.querySelector('.t').append(g); }
    b.querySelector('.f').textContent = nice(s.file);
    b.querySelector('.bar2 i').style.width = Math.max(6, Math.round(s.score / max * 100)) + '%';
    b.onclick = () => selectSource(t, i, true); li.append(b); ol.append(li);
  });
  ev.replaceChildren(h, ol);
}
function renderAnswer(t) {
  const a = $('ans'); const ans = t.answer;
  $('qline').innerHTML = ''; const b = document.createElement('b'); b.textContent = t.q; $('qline').append('Q  ', b);
  if (t.error) { a.className = 'ans err'; a.textContent = t.error; return; }
  if (!ans) { a.className = 'ans'; a.innerHTML = '<div class="skel"></div><div class="skel s"></div>'; return; }
  if (ans.abstained) {
    a.className = 'ans refused'; a.replaceChildren();
    const big = document.createElement('span'); big.className = 'big'; big.textContent = 'Not in the docs.';
    const sm = document.createElement('span'); sm.className = 'sm'; sm.textContent = `${ans.note ? ans.note + ' ' : ''}${REASONS[ans.reason] || ''}${t.sources.length ? ' The closest passages are below, in case they help.' : ' No passage in these docs shares a word with the question.'}`;
    a.append(big, sm);
  } else {
    a.className = 'ans'; a.replaceChildren();
    const m = document.createElement('mark'); m.textContent = ans.text; a.append(m);
    const order = t.sources.map(s => s.id);
    (ans.citations || []).forEach(c => { const n = order.indexOf(c.id); if (n < 0) return; const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'cite'; bt.textContent = n + 1; bt.setAttribute('aria-label', `Show source ${n + 1}`); bt.onclick = () => selectSource(t, n, true); a.append(bt); });
    const how = document.createElement('p'); how.className = 'how';
    const mode = document.createElement('span'); mode.textContent = ans.note || (ans.mode === 'extractive' ? 'Copied from the source, nothing generated' : 'Written from the passages only');
    const cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'Copy answer';
    cp.onclick = async () => { try { await navigator.clipboard.writeText(ans.text); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy blocked'; } setTimeout(() => { cp.textContent = 'Copy answer'; }, 1500); };
    how.append(mode, cp); a.append(how);
  }
}
const show = i => {
  cur = i; const t = turns[i]; app.classList.add('asked'); $('turn').hidden = false; $('chips').hidden = true;
  renderAnswer(t);
  const cites = t.answer && !t.answer.abstained && t.answer.citations.length ? t.sources.findIndex(s => s.id === t.answer.citations[0].id) : 0;
  selSrc = Math.max(0, cites); renderEvidence(t); if (t.sources.length) selectSource(t, selSrc); else clearReader();
  renderHist();
};
const renderHist = () => {
  const list = turns.map((t, i) => [t, i]).filter(([, i]) => i !== cur).reverse();
  $('earlier').hidden = !list.length; const ol = $('hist'); ol.replaceChildren();
  for (const [t, i] of list) { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.textContent = t.q; b.title = t.q; b.onclick = () => { show(i); $('desk').scrollTo({ top: 0, behavior: 'smooth' }); }; li.append(b); ol.append(li); }
};

async function ask(question) {
  const t = { q: question, sources: [], answer: null, error: '' }; turns.push(t); cur = turns.length - 1; selSrc = -1;
  app.classList.add('asked'); $('turn').hidden = false; $('chips').hidden = true;
  renderAnswer(t); $('ev').replaceChildren(); renderHist(); clearReader();
  $('q').value = ''; grow(); $('go').disabled = true; $('desk').scrollTo({ top: 0, behavior: 'smooth' });
  let streamed = '';
  try {
    const post = extra => fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collection ? { question, collection, ...extra } : { question }) });
    let res = await post();
    if (res.status === 404 && collection && collPayload.length) res = await post({ files: collPayload });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(res.status === 429 ? 'Too many questions. Wait a minute and try again.' : d.message || 'Something went wrong.'); }
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'sources') { t.sources = ev.sources; if (cur === turns.indexOf(t)) { renderEvidence(t); selectSource(t, 0); } }
        else if (ev.type === 'delta') { streamed += ev.text; if (cur === turns.indexOf(t)) { $('ans').className = 'ans'; $('ans').textContent = streamed; } }
        else if (ev.type === 'answer') { t.answer = ev; if (cur === turns.indexOf(t)) show(turns.indexOf(t)); }
        else if (ev.type === 'error') { t.error = ev.message; if (cur === turns.indexOf(t)) renderAnswer(t); }
      }
    }
  } catch (err) { t.error = err.message; if (cur === turns.indexOf(t)) renderAnswer(t); }
  finally { $('go').disabled = false; }
}
const MAXF = 8, MAXB = 150 * 1024; let picked = [];
const renderPicked = () => {
  const ul = $('filelist'); ul.replaceChildren();
  picked.forEach((f, i) => { const li = document.createElement('li'); const n = document.createElement('span'); n.textContent = `${f.name} · ${(new Blob([f.text]).size / 1024).toFixed(1)} KB`; const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', `Remove ${f.name}`); b.textContent = '×'; b.onclick = () => { picked.splice(i, 1); renderPicked(); }; li.append(n, b); ul.append(li); });
  $('index').disabled = !picked.length && !$('pasted').value.trim();
};
async function addFiles(list) {
  $('mineErr').textContent = '';
  for (const f of list) {
    if (!/\.(md|mdx|txt)$/i.test(f.name)) { $('mineErr').textContent = `"${f.name}" is not a .md, .mdx or .txt file.`; continue; }
    if (f.size > MAXB) { $('mineErr').textContent = `"${f.name}" is larger than 150 KB.`; continue; }
    if (picked.length >= MAXF) { $('mineErr').textContent = 'You can add up to 8 files.'; break; }
    picked.push({ name: f.name, text: await f.text() });
  }
  renderPicked();
}
$('drop').onclick = () => $('files').click();
$('drop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('files').click(); } };
$('files').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
['dragenter', 'dragover'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
$('pasted').oninput = renderPicked;
$('index').onclick = async () => {
  $('mineErr').textContent = ''; $('index').disabled = true; $('index').textContent = 'Indexing…';
  const files = [...picked]; if ($('pasted').value.trim()) files.push({ name: 'pasted.md', text: $('pasted').value });
  try {
    const res = await fetch('/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
    const d = await res.json(); if (!res.ok) throw new Error(d.message || 'Could not index those documents.');
    collection = d.id; collFiles = d.docs; collPayload = files; collTexts.clear(); d.docs.forEach((n, i) => collTexts.set(n, files[i].text.replace(/\r\n/g, '\n').replace(/\u0000/g, ''))); $('forget').hidden = false; setScope(); fillPages(); $('q').disabled = false;
    const p = document.createElement('p'); p.className = 'indexed'; p.id = 'indexedNote'; p.textContent = `Indexed ${d.docs.length} document${d.docs.length === 1 ? '' : 's'} as ${d.chunks} passages. They expire in ${d.expiresInMinutes} minutes.`;
    $('indexedNote')?.remove(); $('filelist').before(p); $('live').textContent = p.textContent; $('q').focus();
  } catch (e) { $('mineErr').textContent = e.message; }
  finally { $('index').textContent = 'Index documents'; renderPicked(); }
};
$('forget').onclick = async () => { if (collection) await fetch(`/api/collections/${collection}`, { method: 'DELETE' }).catch(() => {}); collection = null; collFiles = []; collPayload = []; collTexts.clear(); picked = []; $('pasted').value = ''; $('indexedNote')?.remove(); $('forget').hidden = true; renderPicked(); setTab(true); };


$('how').addEventListener('click', e => { if (e.target === $('how')) $('how').close(); });
$('howbtn').onclick = () => $('how').showModal(); $('howclose').onclick = () => $('how').close();
const THEME_KEY = 'documind-theme';
try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch {}
$('theme').onclick = () => {
  const cur2 = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur2 === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
};
addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('how').open) { e.preventDefault(); $('q').focus(); } });

$('chips').innerHTML = '';
EXAMPLES.forEach(q => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; const s = document.createElement('span'); s.textContent = q; b.append(s); b.onclick = () => { $('q').value = q; $('form').requestSubmit(); }; li.append(b); $('chips').append(li); });

const grow = () => { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 150) + 'px'; };
$('q').addEventListener('input', grow);
$('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });
$('form').addEventListener('submit', e => { e.preventDefault(); const q = $('q').value.trim(); if (!q) return; if (mineTab && !collection) { $('mineErr').textContent = 'Index your documents first, then ask.'; return; } ask(q); });

fetch('/api/health').then(r => r.json()).then(h => {
  $('modeline').textContent = h.mode === 'extractive' ? `${h.chunks} passages · extractive, no text generated` : `${h.chunks} passages · model: ${h.mode}`;
  $('modeline').title = h.mode === 'extractive' ? 'Answers are copied from the best matching sentence.' : 'Answers are generated from retrieved passages only.';
  corpusFiles = h.files || []; fillPages();
}).catch(() => { $('modeline').textContent = 'Offline'; });
