const $ = id => document.getElementById(id);
const EXAMPLES = [
  'How do I make part of a route path optional?',
  "How do I turn on all of Express's internal debug logs?",
  'Which Node.js version can run .ts files directly?',
  'What function must a template engine export so res.render can use it?',
  'How do I store user sessions in Redis?',
  'How do I protect against CSRF attacks?',
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let collection = null; const NAME = () => (collection ? 'your documents' : 'the Express 5 documentation');
const MAXF = 8, MAXB = 150 * 1024; let picked = [];
const setTab = mine => {
  $('tab-express').classList.toggle('on', !mine); $('tab-mine').classList.toggle('on', mine);
  $('tab-express').setAttribute('aria-selected', String(!mine)); $('tab-mine').setAttribute('aria-selected', String(mine));
  $('panel-mine').hidden = !mine; $('chips').hidden = mine || !!collection;
  if (!mine) { $('h1').innerHTML = 'Ask the Express 5 docs.<br><em>Get the passage, not a guess.</em>'; collection = null; $('q').placeholder = "e.g. Why doesn't my error handler catch 404s?"; }
  else { $('h1').innerHTML = 'Ask your documents.<br><em>Get the passage, not a guess.</em>'; $('q').placeholder = collection ? 'Ask about your documents' : 'Add documents above first'; }
  $('result').hidden = true;
};
$('tab-express').onclick = () => setTab(false); $('tab-mine').onclick = () => setTab(true);
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
    collection = d.id; $('forget').hidden = false; $('chips').hidden = true; $('q').placeholder = 'Ask about your documents'; $('q').disabled = false;
    const p = document.createElement('p'); p.className = 'indexed'; p.id = 'indexedNote'; p.textContent = `Indexed ${d.docs.length} document${d.docs.length === 1 ? '' : 's'} as ${d.chunks} passages. They expire in ${d.expiresInMinutes} minutes.`;
    $('indexedNote')?.remove(); $('filelist').before(p); $('live').textContent = p.textContent; $('q').focus();
  } catch (e) { $('mineErr').textContent = e.message; }
  finally { $('index').textContent = 'Index documents'; renderPicked(); }
};
$('forget').onclick = async () => { if (collection) await fetch(`/api/collections/${collection}`, { method: 'DELETE' }).catch(() => {}); collection = null; picked = []; $('pasted').value = ''; $('indexedNote')?.remove(); $('forget').hidden = true; renderPicked(); setTab(true); };
addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); } });

$('chips').innerHTML = EXAMPLES.map(q => `<button class="chip" type="button">${esc(q)}</button>`).join('');
$('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { $('q').value = b.textContent; $('form').requestSubmit(); } });

fetch('/api/health').then(r => r.json()).then(h => {
  $('mode').textContent = h.mode === 'extractive' ? 'Extractive mode' : `Model: ${h.mode}`;
  $('mode').title = h.mode === 'extractive' ? 'Answers are copied from the best matching sentence. No text is generated.' : 'Answers are generated from retrieved passages only.';
}).catch(() => { $('mode').textContent = 'Offline'; });

let sources = [];

function renderSources(list, cited = new Set(), best = '') {
  sources = list;
  $('sources').innerHTML = list.length ? '<h2>Retrieved passages</h2>' + list.map((s, i) => {
    const body = esc(s.text.length > 1400 ? s.text.slice(0, 1400) + '…' : s.text);
    const shown = best && body.includes(esc(best)) ? body.replace(esc(best), `<mark>${esc(best)}</mark>`) : body;
    return `<div class="src ${cited.has(s.id) ? 'on' : ''}" id="src-${i + 1}" data-id="${esc(s.id)}"><header><span class="n">${i + 1}</span><span class="where">${esc(s.file.replace(/__/g, ' / ').replace('.mdx', ''))}${s.heading ? ' · ' + esc(s.heading) : ''}</span><span class="score">score ${s.score}</span></header><pre>${shown}</pre><button class="more" type="button">Show more</button></div>`;
  }).join('') : '';
}

$('sources').addEventListener('click', e => { const b = e.target.closest('.more'); if (b) { const card = b.closest('.src'); const open = card.classList.toggle('open'); b.textContent = open ? 'Show less' : 'Show more'; } });
$('answer').addEventListener('click', e => { const c = e.target.closest('.cite'); if (!c) return; const el = $(`src-${c.dataset.n}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('on', 'open'); } });

function linkCitations(text, citations) {
  const ids = sources.map(s => s.id);
  let html = esc(text).replace(/\[(\d+)\]/g, (m, n) => `<button class="cite" data-n="${n}" aria-label="Open source ${n}">${n}</button>`);
  if (!/class="cite"/.test(html) && citations.length) html += ' ' + citations.map(c => `<button class="cite" data-n="${ids.indexOf(c.id) + 1}" aria-label="Open source ${ids.indexOf(c.id) + 1}">${ids.indexOf(c.id) + 1}</button>`).join('');
  return html;
}

const REASONS = {
  unknown_terms: 'The question uses terms that never appear in these docs.',
  low_coverage: 'No passage covers enough of what you asked to answer safely. These thresholds were tuned on the Express docs, so on your own documents they may be stricter or looser than ideal.',
  model_abstained: 'The model found nothing in the retrieved passages that answers this.',
  no_valid_citation: 'The model replied without citing a retrieved passage, so the reply was discarded.',
};

async function ask(question) {
  $('result').hidden = false;
  $('answer').className = 'answer';
  $('answer').innerHTML = '<p class="label">Searching</p><div class="skeleton"></div><div class="skeleton s"></div>';
  $('sources').innerHTML = '';
  $('go').disabled = true;
  let streamed = '';
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collection ? { question, collection } : { question }) });
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
        if (ev.type === 'sources') renderSources(ev.sources);
        else if (ev.type === 'delta') { streamed += ev.text; $('answer').innerHTML = `<p class="label">Writing from the passages…</p><p>${esc(streamed)}</p>`; }
        else if (ev.type === 'answer') {
          if (ev.abstained) {
            $('answer').className = 'answer refused';
            $('answer').innerHTML = `<p class="label">Not covered by these docs</p><p>I can't answer that from ${NAME()}, so I won't guess.</p><p class="why">${esc(REASONS[ev.reason] || '')} The closest passages are below in case they help.</p>`;
          } else {
            const ids = new Set(ev.citations.map(c => c.id));
            $('answer').innerHTML = `<p class="label">${ev.mode === 'extractive' ? 'Copied from ' : 'From '}${collection ? 'your documents' : 'the docs'}<button class="copy" type="button" id="copyAns">Copy</button></p><p>${linkCitations(ev.text, ev.citations)}</p>`;
            renderSources(sources, ids, ev.mode === 'extractive' ? ev.text.split(/(?<=[.!?])\s+/)[0] : '');
            $('copyAns').onclick = async () => { try { await navigator.clipboard.writeText(ev.text); $('copyAns').textContent = 'Copied'; } catch { $('copyAns').textContent = 'Copy blocked'; } setTimeout(() => { const b = $('copyAns'); if (b) b.textContent = 'Copy'; }, 1500); };
          }
        } else if (ev.type === 'error') { $('answer').className = 'answer error'; $('answer').innerHTML = `<p class="label">Error</p><p>${esc(ev.message)}</p>`; }
      }
    }
  } catch (err) {
    $('answer').className = 'answer error';
    $('answer').innerHTML = `<p class="label">Error</p><p>${esc(err.message)}</p>`;
  } finally { $('go').disabled = false; }
}

$('form').addEventListener('submit', e => { e.preventDefault(); const q = $('q').value.trim(); if (q) ask(q); });
