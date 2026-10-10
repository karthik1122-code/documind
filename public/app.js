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
const ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

let collection = null; let mineTab = false;
const NAME = () => (collection ? 'your documents' : 'the Express 5 documentation');
const app = $('app');

const setScope = () => {
  const name = collection ? 'your documents' : 'Express 5 docs';
  $('scope').textContent = 'Searching ' + name;
  $('crumbSrc').textContent = collection || mineTab ? 'Your documents' : 'Express 5 docs';
  $('h1').textContent = mineTab ? 'What do you want to find in your documents?' : 'What do you want to find in the Express 5 docs?';
  $('q').placeholder = mineTab ? (collection ? 'Ask about your documents' : 'Add documents above first') : 'Ask about routing, middleware, error handling…';
  $('chips').hidden = mineTab;
};
const setTab = mine => {
  mineTab = mine; if (!mine) collection = null;
  $('tab-express').classList.toggle('on', !mine); $('tab-mine').classList.toggle('on', mine);
  $('tab-express').setAttribute('aria-selected', String(!mine)); $('tab-mine').setAttribute('aria-selected', String(mine));
  $('panel-mine').hidden = !mine; setScope(); app.classList.add('empty'); closeNav();
  $('crumbPage').textContent = 'New question';
};
$('tab-express').onclick = () => setTab(false); $('tab-mine').onclick = () => setTab(true);
$('newq').onclick = () => { setTab(mineTab && collection ? true : mineTab); $('q').focus(); };
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
    collection = d.id; $('forget').hidden = false; setScope(); $('q').disabled = false;
    const p = document.createElement('p'); p.className = 'indexed'; p.id = 'indexedNote'; p.textContent = `Indexed ${d.docs.length} document${d.docs.length === 1 ? '' : 's'} as ${d.chunks} passages. They expire in ${d.expiresInMinutes} minutes.`;
    $('indexedNote')?.remove(); $('filelist').before(p); $('live').textContent = p.textContent; $('mineN').textContent = d.docs.length + ' file' + (d.docs.length === 1 ? '' : 's'); $('q').focus();
  } catch (e) { $('mineErr').textContent = e.message; }
  finally { $('index').textContent = 'Index documents'; renderPicked(); }
};
$('forget').onclick = async () => { if (collection) await fetch(`/api/collections/${collection}`, { method: 'DELETE' }).catch(() => {}); collection = null; picked = []; $('pasted').value = ''; $('indexedNote')?.remove(); $('forget').hidden = true; $('mineN').textContent = 'upload'; renderPicked(); setTab(true); };

const openNav = () => { app.classList.add('nav'); $('scrim').hidden = false; };
const closeNav = () => { app.classList.remove('nav'); $('scrim').hidden = true; };
$('menu').onclick = openNav; $('scrim').onclick = closeNav;
$('howbtn').onclick = () => { closeNav(); $('how').showModal(); }; $('howclose').onclick = () => $('how').close();
$('how').addEventListener('click', e => { if (e.target === $('how')) $('how').close(); });
const THEME_KEY = 'documind-theme';
try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch {}
$('theme').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
};
addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !$('how').open) { e.preventDefault(); $('q').focus(); } });

$('chips').innerHTML = EXAMPLES.map(q => `<button class="chip-q" type="button">${ARROW}<span>${esc(q)}</span></button>`).join('');
$('chips').addEventListener('click', e => { const b = e.target.closest('.chip-q'); if (b) { $('q').value = b.textContent; $('form').requestSubmit(); } });

const grow = () => { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; };
$('q').addEventListener('input', grow);
$('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });

fetch('/api/health').then(r => r.json()).then(h => {
  $('modeTxt').textContent = h.mode === 'extractive' ? 'Extractive mode' : `Model: ${h.mode}`;
  $('mode').title = h.mode === 'extractive' ? 'Answers are copied from the best matching sentence. No text is generated.' : 'Answers are generated from retrieved passages only.';
  $('expN').textContent = `${h.docs} pages`; $('stat').textContent = `${h.chunks} passages indexed`;
}).catch(() => { $('modeTxt').textContent = 'Offline'; });

const REASONS = {
  unknown_terms: 'The question uses terms that never appear in these docs.',
  low_coverage: 'No passage covers enough of what you asked to answer safely. These thresholds were tuned on the Express docs, so on your own documents they may be stricter or looser than ideal.',
  model_abstained: 'The model found nothing in the retrieved passages that answers this.',
  no_valid_citation: 'The model replied without citing a retrieved passage, so the reply was discarded.',
};
const nice = s => s.file.replace(/__/g, ' / ').replace('.mdx', '');
let seq = 0;

function stepEl(text, state, ms) { const li = document.createElement('li'); li.className = state; li.innerHTML = `<span class="tick"></span><span>${text}</span><em>${ms || ''}</em>`; return li; }

async function ask(question) {
  const id = 't' + (++seq);
  app.classList.remove('empty');
  const turn = document.createElement('article'); turn.className = 'turn'; turn.id = id;
  const h = document.createElement('h2'); h.textContent = question;
  const trace = document.createElement('ol'); trace.className = 'trace';
  const cards = document.createElement('div'); cards.className = 'cards';
  const ans = document.createElement('div'); ans.className = 'ans'; ans.innerHTML = '<div class="skel"></div><div class="skel s"></div>';
  const pass = document.createElement('div'); pass.className = 'pass';
  const s1 = stepEl(`Searching ${esc(NAME())}`, 'run');
  trace.append(s1);
  turn.append(h, trace, cards, ans, pass);
  $('thread').append(turn);
  const none = $('hist').querySelector('.none'); if (none) none.remove();
  const li = document.createElement('li'); const hb = document.createElement('button'); hb.type = 'button'; hb.textContent = question; hb.title = question;
  hb.onclick = () => { app.classList.remove('empty'); closeNav(); $('crumbPage').textContent = question; turn.scrollIntoView({ block: 'start' }); };
  li.append(hb); $('hist').prepend(li);
  $('crumbPage').textContent = question; $('crumbSrc').textContent = collection ? 'Your documents' : 'Express 5 docs';
  $('q').value = ''; grow(); $('go').disabled = true; $('stat').textContent = 'Searching…';
  requestAnimationFrame(() => turn.scrollIntoView({ block: 'start' }));
  const t0 = performance.now();
  let sources = []; let streamed = '';
  const renderSources = (best = '', used = new Set()) => {
    cards.replaceChildren(...sources.map((s, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'card' + (used.has(s.id) ? ' used' : ''); b.dataset.n = i + 1;
      b.innerHTML = `<span class="t">${esc(s.heading || nice(s))}</span><span class="m"><span class="n">${i + 1}</span><span>${esc(nice(s))}</span></span>`;
      return b;
    }));
    pass.innerHTML = sources.length ? '<h3>Retrieved passages</h3>' + sources.map((s, i) => {
      const body = esc(s.text.length > 1400 ? s.text.slice(0, 1400) + '…' : s.text);
      const shown = best && body.includes(esc(best)) ? body.replace(esc(best), `<mark>${esc(best)}</mark>`) : body;
      return `<div class="p ${used.has(s.id) ? 'on' : ''}" id="${id}-p${i + 1}"><header><span class="n">${i + 1}</span><span class="w">${esc(nice(s))}${s.heading ? ' · ' + esc(s.heading) : ''}</span><span>score ${s.score}</span></header><pre>${shown}</pre><button class="more" type="button">Show more</button></div>`;
    }).join('') : '';
  };
  const openPassage = n => { const el = document.getElementById(`${id}-p${n}`); if (el) { el.classList.add('on', 'open'); const mb = el.querySelector('.more'); if (mb) mb.textContent = 'Show less'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  turn.addEventListener('click', e => {
    const c = e.target.closest('.card, .cite'); if (c) return openPassage(c.dataset.n);
    const b = e.target.closest('.more'); if (b) { const card = b.closest('.p'); const open = card.classList.toggle('open'); b.textContent = open ? 'Show less' : 'Show more'; }
  });
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
        const ms = Math.round(performance.now() - t0) + ' ms';
        if (ev.type === 'sources') {
          sources = ev.sources; renderSources();
          s1.className = 'done'; s1.innerHTML = `<span class="tick"></span><span>Retrieved <b>${sources.length}</b> passages, keyword + semantic, reranked</span><em>${ms}</em>`;
          trace.append(stepEl('Checking the passages cover your question', 'run'));
        } else if (ev.type === 'delta') { streamed += ev.text; ans.textContent = streamed; }
        else if (ev.type === 'answer') {
          const last = trace.lastElementChild;
          if (ev.abstained) {
            last.className = 'done'; last.innerHTML = `<span class="tick"></span><span>Coverage too weak, so no answer was written</span><em>${ms}</em>`;
            ans.className = 'ans refused';
            ans.innerHTML = `<p class="hd">Not covered by ${esc(NAME())}</p><p>I can't answer that from ${esc(NAME())}, so I won't guess.</p><p class="why">${esc(REASONS[ev.reason] || '')} The closest passages are below in case they help.</p>`;
          } else {
            last.className = 'done'; last.innerHTML = `<span class="tick"></span><span>${ev.mode === 'extractive' ? 'Copied the best matching sentence' : 'Wrote from the passages'}, with citations</span><em>${ms}</em>`;
            const ids = new Set(ev.citations.map(c => c.id)); const order = sources.map(s => s.id);
            let html = esc(ev.text).replace(/\[(\d+)\]/g, (m, n) => `<button class="cite" data-n="${n}" aria-label="Open source ${n}">${n}</button>`);
            if (!/class="cite"/.test(html) && ev.citations.length) html += ' ' + ev.citations.map(c => { const n = order.indexOf(c.id) + 1; return `<button class="cite" data-n="${n}" aria-label="Open source ${n}">${n}</button>`; }).join('');
            ans.className = 'ans'; ans.innerHTML = `<p>${html}</p><div class="acts"><button class="act" type="button" data-copy>Copy answer</button><span>${ev.mode === 'extractive' ? 'Extractive: no text was generated' : 'Generated from passages only'}</span></div>`;
            ans.querySelector('[data-copy]').onclick = async e => { const b = e.currentTarget; try { await navigator.clipboard.writeText(ev.text); b.textContent = 'Copied'; } catch { b.textContent = 'Copy blocked'; } setTimeout(() => { b.textContent = 'Copy answer'; }, 1500); };
            renderSources(ev.mode === 'extractive' ? ev.text.split(/(?<=[.!?])\s+/)[0] : '', ids);
          }
          $('stat').textContent = `Answered in ${ms}`;
        } else if (ev.type === 'error') { ans.className = 'ans err'; ans.textContent = ev.message; }
      }
    }
  } catch (err) { ans.className = 'ans err'; ans.textContent = err.message; $('stat').textContent = 'Error'; }
  finally { $('go').disabled = false; }
}

$('form').addEventListener('submit', e => { e.preventDefault(); const q = $('q').value.trim(); if (!q) return; if (mineTab && !collection) { $('mineErr').textContent = 'Index your documents first, then ask.'; return; } ask(q); });
