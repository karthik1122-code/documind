const root = document.documentElement; const $ = id => document.getElementById(id);


  const THEME_KEY = 'documind-theme';
  try { const t = localStorage.getItem(THEME_KEY); if (t) root.dataset.theme = t; } catch {}
  $('lpTheme').onclick = () => {
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  };
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); o.unobserve(e.target); } }), { threshold: .3 }).observe($('lpEv'));
  document.querySelectorAll('.lp-row .fl').forEach(f => { f.style.width = f.dataset.w + '%'; });

  const QS = ['How do I make part of a route path optional?', 'How do I protect against CSRF attacks?'];
  const nice = f => f.replace(/__/g, ' / ').replace('.mdx', '');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function ask(q) { for (let n = 0; n < 4; n++) { const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) }); if (res.status !== 429) return res; await wait((Number(res.headers.get('retry-after')) || 3) * 1000); } throw new Error('busy'); }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function run(q) {
    const t0 = performance.now(); const res = await ask(q);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', sources = [], answer = null;
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 2); if (!l.startsWith('data:')) continue; const ev = JSON.parse(l.slice(5)); if (ev.type === 'sources') sources = ev.sources; else if (ev.type === 'answer') answer = ev; } }
    const src = (answer && !answer.abstained && sources.find(s => s.id === answer.citations[0].id)) || sources[0];
    const doc = await (await fetch('/api/doc?file=' + encodeURIComponent(src.file))).json();
    return { src, answer, doc, ms: Math.round(performance.now() - t0) };
  }
  function sheet(r) {
    const text = r.doc.text, lines = text.split('\n'); const body = r.src.text.slice(r.src.text.indexOf('\n') + 1).trim();
    const pi = text.indexOf(body); const pe = pi + body.length; const ans = r.answer.abstained ? null : r.answer.text.split(/(?<=[.!?])\s+/)[0]; const ai = ans ? text.indexOf(ans) : -1;
    let off = 0, hit = 0; const offs = lines.map(l => { const s = off; off += l.length + 1; return s; });
    if (ai >= 0) hit = offs.findIndex((s, i) => s + lines[i].length >= ai); else if (pi >= 0) hit = offs.findIndex((s, i) => s + lines[i].length >= pi);
    const from = Math.max(0, hit - 3), to = Math.min(lines.length, from + 9); const box = $('ds'); box.replaceChildren();
    for (let i = from; i < to; i++) {
      const row = document.createElement('div'); row.className = 'ln'; const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; const c = document.createElement('span'); c.className = 'c';
      const s = offs[i], e = s + lines[i].length; if (pi >= 0 && s < pe && e > pi) row.classList.add('inp');
      if (ai >= 0 && s <= ai && ai < e + 1) { const a = ai - s, b = Math.min(lines[i].length, a + ans.length); c.append(document.createTextNode(lines[i].slice(0, a))); const m = document.createElement('mark'); m.textContent = lines[i].slice(a, b); c.append(m, document.createTextNode(lines[i].slice(b))); }
      else c.textContent = lines[i] || ' ';
      row.append(n, c); box.append(row);
    }
    return ai >= 0 ? hit + 1 : null;
  }
  async function play(q, r) {
    const dq = $('dq'), da = $('da'), dm = $('dm'), ds = $('ds');
    da.className = 'sp-a'; da.replaceChildren(); dm.className = 'sp-m'; ds.className = 'sp-sheet'; dq.replaceChildren(); $('dl').textContent = ''; $('dh').textContent = nice(r.src.file);
    const b = document.createElement('b'), cur = document.createElement('span'); cur.className = 'cur'; dq.append('Q  ', b, cur);
    for (const ch of q) { b.textContent += ch; if (!still) await wait(22); } cur.remove(); await wait(still ? 0 : 350);
    const line = sheet(r);
    if (r.answer.abstained) {
      da.className = 'sp-a ref'; da.innerHTML = '<span class="big">Not in the docs.</span><span class="sm">Nothing here covers it, so nothing is marked. The closest passage is shown tinted.</span>';
      requestAnimationFrame(() => { da.classList.add('on'); ds.classList.add('on'); }); dm.textContent = `Refused after ${r.ms} ms · reason: ${r.answer.reason.replace('_', ' ')}`;
    } else {
      const m = document.createElement('mark'); m.textContent = r.answer.text; const c = document.createElement('span'); c.className = 'cite'; c.textContent = '1'; da.append(m, c);
      requestAnimationFrame(() => { da.classList.add('on'); }); await wait(still ? 0 : 700);
      ds.classList.add('on'); await wait(60); ds.classList.add('hit'); $('dl').textContent = line ? 'line ' + line : '';
      dm.textContent = `Copied from the source, nothing generated · ${r.ms} ms`;
    }
    dm.classList.add('on');
  }

  /* marquee: every example question, run through the real pipeline */
  const EX = ['How do I make part of a route path optional?', "How do I turn on all of Express's internal debug logs?", 'Which Node.js version can run .ts files directly?', 'What function must a template engine export so res.render can use it?', 'How do I store user sessions in Redis?', 'How do I protect against CSRF attacks?', 'What is the capital of Australia?'];
  async function probe(q) { const res = await ask(q); const t = await res.text(); const ev = t.split('\n\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))); return { sources: ev.find(e => e.type === 'sources').sources, answer: ev.find(e => e.type === 'answer') }; }
  async function marquee() {
    const rs = await Promise.all(EX.map(probe)); const t = $('mq');
    const one = () => rs.map((r, i) => { const d = document.createElement('div'); d.className = 'lp-mq-i ' + (r.answer.abstained ? 'no' : 'ok'); const sp = document.createElement('span'); sp.textContent = EX[i]; const sm = document.createElement('small'); sm.textContent = r.answer.abstained ? 'not in the docs' : 'answered · ' + nice(r.answer.citations[0].file); d.append(sp, sm); return d; });
    t.replaceChildren(...one(), ...one());
  }

  /* pinned story: real data from one answered and one refused question */
  async function story() {
    const A = await probe(EX[0]), B = await probe('How do I protect against CSRF attacks?');
    const src = A.sources.find(s => s.id === A.answer.citations[0].id) || A.sources[0];
    const doc = await (await fetch('/api/doc?file=' + encodeURIComponent(src.file))).json(); const text = doc.text;
    const body = src.text.slice(src.text.indexOf('\n') + 1).trim(); const pi = text.indexOf(body);
    // 0: a page cut into passages (real headings from this page)
    const lines = text.split('\n'); let ls = 0; for (let i = 0, o = 0; i < lines.length; i++) { if (o + lines[i].length >= pi) { ls = i; break; } o += lines[i].length + 1; }
    const from = Math.max(0, ls - 8); const win = lines.slice(from, from + 22); const blocks = []; let cur = [];
    for (const l of win) { if (/^#{2,3}\s/.test(l) && cur.length) { blocks.push(cur); cur = []; } cur.push(l); } if (cur.length) blocks.push(cur);
    $('pn0h').textContent = nice(src.file) + ' · cut at headings';
    $('pn0b').replaceChildren(...blocks.map((b, i) => { const d = document.createElement('div'); d.className = 'blk'; d.textContent = b.slice(0, 7).join('\n').trim(); const m = b.find(l => /^#{2,3}\s/.test(l)); if (m) { const e = document.createElement('em'); e.textContent = m.replace(/^#+\s*/, '').slice(0, 26); d.append(e); } return d; }));
    // 1: five passages with real scores
    $('pn1h').textContent = 'Top five passages for: ' + EX[0]; const max = Math.max(...A.sources.map(s => s.score));
    $('pn1b').replaceChildren(...A.sources.map((s, i) => { const d = document.createElement('div'); d.className = 'pc' + (i === 0 ? ' top' : ''); d.innerHTML = '<span class="no"></span><span class="t"></span><span class="bt"><i></i></span>'; d.querySelector('.no').textContent = i + 1; const t = d.querySelector('.t'); t.textContent = s.heading || nice(s.file); const sm = document.createElement('small'); sm.textContent = nice(s.file) + ' · score ' + s.score; t.append(sm); d.querySelector('i').style.width = Math.round(s.score / max * 100) + '%'; return d; }));
    // 2: coverage gauge, answered vs refused
    const TH = 0.5; const row = (q, r) => { const c = r.answer.confidence || 0; const d = document.createElement('div'); d.className = 'row'; d.innerHTML = '<div><div class="q"></div><div class="trk"><i></i><u></u></div></div><div class="v"></div>'; d.querySelector('.q').textContent = q; const sm = document.createElement('small'); sm.textContent = r.answer.abstained ? (r.answer.reason === 'unknown_terms' ? 'unknown words in the question' : 'too little coverage') : 'covers enough, so it answers'; d.querySelector('.q').append(sm); d.querySelector('i').style.width = Math.min(100, c * 100) + '%'; d.querySelector('u').style.left = TH * 100 + '%'; const v = d.querySelector('.v'); v.textContent = c.toFixed(2); const res = document.createElement('div'); res.className = 'res ' + (r.answer.abstained ? 'n' : 'y'); res.textContent = r.answer.abstained ? 'REFUSED' : 'ANSWERS'; v.append(res); return d; };
    $('pn2b').replaceChildren(row(EX[0], A), row('How do I protect against CSRF attacks?', B));
    // 3: the mark
    const sentence = A.answer.text.split(/(?<=[.!?])\s+/)[0]; const ai = text.indexOf(sentence);
    $('pn3h').textContent = 'Source 1 · ' + nice(src.file); const ans = $('pn3a'); const m = document.createElement('mark'); m.textContent = A.answer.text; ans.replaceChildren(m);
    const tl = text.split('\n'); let off = 0; const offs = tl.map(l => { const o = off; off += l.length + 1; return o; }); const hl = offs.findIndex((o, i) => o + tl[i].length >= ai); const f2 = Math.max(0, hl - 2); const sh = $('pn3b'); sh.replaceChildren();
    for (let i = f2; i < Math.min(tl.length, f2 + 13); i++) { const row2 = document.createElement('div'); row2.className = 'ln'; const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; const c = document.createElement('span'); c.className = 'c'; const s2 = offs[i]; if (ai >= 0 && s2 <= ai && ai < s2 + tl[i].length + 1) { const a = ai - s2; c.append(document.createTextNode(tl[i].slice(0, a))); const mk = document.createElement('mark'); mk.textContent = tl[i].slice(a, a + sentence.length); c.append(mk, document.createTextNode(tl[i].slice(a + sentence.length))); } else c.textContent = tl[i] || ' '; row2.append(n, c); sh.append(row2); }
    sh.className = 'pg-s sp-sheet on';
    // scroll driver
    const sec = $('story'), steps = [...$('steps').children], pns = [0, 1, 2, 3].map(i => $('pn' + i));
    let last = -1;
    const tick = () => {
      {
        const r = sec.getBoundingClientRect(); const p = Math.max(0, Math.min(1, -r.top / (r.height - innerHeight)));
        $('prog').style.width = (p * 100) + '%'; const k = Math.min(3, Math.floor(p * 4));
        if (k !== last) { last = k; steps.forEach((s, i) => s.classList.toggle('on', i === k)); pns.forEach((n, i) => n.classList.toggle('on', i === k)); sh.classList.toggle('hit', k === 3); }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  (async () => {

    fetch('/api/health').then(r => r.json()).then(h => { $('nChunks').textContent = h.chunks; $('nDocs').textContent = h.docs; }).catch(() => {});
    marquee().catch(() => {}); story().catch(() => {});
    let results; try { results = []; for (const q of QS) results.push(await run(q)); } catch { $('dm').textContent = 'The live demo is busy. Open the app to ask your own question.'; $('dm').classList.add('on'); return; }
    for (let k = 0; ; k = (k + 1) % QS.length) { await play(QS[k], results[k]); if (still) break; await wait(5200); }
  })();
