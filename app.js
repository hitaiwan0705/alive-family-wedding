'use strict';
const data = window.WEDDING;
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (className) n.className = className; return n; };
const PARTIES = Object.keys(data.parties);
const STORE_KEY = 'alive-wedding-draft-v1';
const phaseById = Object.fromEntries(data.phases.map(p => [p.id, p]));
const baseItems = {};
for (const p of data.phases) for (const item of p.budget) baseItems[item.id] = { ...item, phase: p.id };

// ---------- 格式 ----------
const ntd = n => `NT$${Math.round(n).toLocaleString('zh-TW')}`;
function wan(n) {
  if (!n) return '0 元';
  if (Math.abs(n) < 10000) return `${Math.round(n).toLocaleString('zh-TW')} 元`;
  return `${parseFloat((n / 10000).toFixed(2))} 萬`;
}
const signedWan = n => (n > 0 ? '多 ' : '少 ') + wan(Math.abs(n));
const splitText = s => PARTIES.filter(k => s[k]).map(k => `${data.parties[k]} ${s[k]}%`).join('、');
const sameSplit = (a, b) => PARTIES.every(k => (a[k] || 0) === (b[k] || 0));
const today = new Date();
const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

// ---------- 草稿（只存在這支手機）與提案連結 ----------
const emptyDraft = () => ({ e: {}, ad: [], pr: [], d: {}, n: '', m: '' });
function cleanStr(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function cleanAmount(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1e8 ? Math.round(n) : undefined; }
function cleanSplit(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {}; let total = 0;
  for (const k of PARTIES) { const v = Number(s[k]); if (Number.isFinite(v) && v > 0 && v <= 100) { out[k] = Math.round(v); total += out[k]; } }
  return total === 100 ? out : undefined;
}
function sanitize(raw) {
  const d = emptyDraft();
  if (!raw || typeof raw !== 'object') return d;
  for (const [id, e] of Object.entries(raw.e || {})) {
    if (!baseItems[id] || baseItems[id].locked || !e || typeof e !== 'object') continue;
    const x = {}; const a = cleanAmount(e.a); const s = cleanSplit(e.s);
    if (a !== undefined) x.a = a; if (s) x.s = s; if (e.r) x.r = 1; if (e.c) x.c = cleanStr(e.c, 500);
    if (Object.keys(x).length) d.e[id] = x;
  }
  for (const a of Array.isArray(raw.ad) ? raw.ad.slice(0, 40) : []) {
    if (!a || !phaseById[a.p] || !cleanStr(a.nm, 40).trim()) continue;
    d.ad.push({ id: cleanStr(a.id, 20) || `n${d.ad.length}`, p: a.p, nm: cleanStr(a.nm, 40), a: cleanAmount(a.a) ?? 0, s: cleanSplit(a.s) || { groom: 100 }, c: cleanStr(a.c, 500) });
  }
  for (const x of Array.isArray(raw.pr) ? raw.pr.slice(0, 40) : []) if (x && phaseById[x.p] && cleanStr(x.x, 100).trim()) d.pr.push({ p: x.p, x: cleanStr(x.x, 100) });
  for (const [p, t] of Object.entries(raw.d || {})) if (phaseById[p] && cleanStr(t, 100).trim()) d.d[p] = cleanStr(t, 100);
  d.n = cleanStr(raw.n, 40); d.m = cleanStr(raw.m, 2000);
  return d;
}
function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

let proposal = null;
if (location.hash.startsWith('#p=')) {
  try { proposal = decode(location.hash.slice(3)); } catch (_) { proposal = null; }
}
const readOnly = !!proposal;
let draft = emptyDraft();
if (readOnly) draft = sanitize(proposal);
else {
  try { const saved = localStorage.getItem(STORE_KEY); if (saved) draft = sanitize(JSON.parse(saved)); } catch (_) { /* 無法讀取就從空白開始 */ }
}
function save() {
  if (readOnly) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(draft)); } catch (_) { /* 私密瀏覽等情況，只在本次瀏覽有效 */ }
}

// ---------- 套用修改後的項目 ----------
function effective(item) {
  const e = draft.e[item.id] || {};
  return { ...item, amount: e.a ?? item.amount, split: e.s || item.split, removed: !!e.r, comment: e.c || '', edited: !!draft.e[item.id] };
}
function itemsOf(phaseId, useDraft = true) {
  const base = phaseById[phaseId].budget.map(i => ({ ...i, phase: phaseId }));
  if (!useDraft) return base.map(i => ({ ...i, split: i.split, removed: false }));
  const list = base.map(effective);
  for (const a of draft.ad.filter(a => a.p === phaseId)) list.push({ id: a.id, phase: phaseId, name: a.nm, amount: a.a, split: a.s, comment: a.c, added: true, status: '新增建議' });
  return list;
}
const counts = i => !i.removed && !i.locked && typeof i.amount === 'number';
const phaseTotal = (pid, useDraft = true) => itemsOf(pid, useDraft).filter(counts).reduce((s, i) => s + i.amount, 0);
const grandTotal = (useDraft = true) => data.phases.reduce((s, p) => s + phaseTotal(p.id, useDraft), 0);
function partyTotals(useDraft = true) {
  const t = Object.fromEntries(PARTIES.map(k => [k, 0]));
  for (const p of data.phases) for (const i of itemsOf(p.id, useDraft).filter(counts)) for (const k of PARTIES) t[k] += i.amount * (i.split[k] || 0) / 100;
  return t;
}

// ---------- 修改清單（給新人看的文字） ----------
function changeLines() {
  const lines = [];
  for (const p of data.phases) {
    if (draft.d[p.id]) lines.push(`【${p.short}】建議日期：${draft.d[p.id]}`);
    for (const item of p.budget) {
      const e = draft.e[item.id]; if (!e) continue;
      const parts = [];
      if (e.r) parts.push('建議不需要');
      if (e.a !== undefined && e.a !== item.amount) parts.push(item.private && item.amount === undefined ? `建議金額 ${ntd(e.a)}` : `金額 ${ntd(item.amount || 0)} → ${ntd(e.a)}`);
      if (e.s && !sameSplit(e.s, item.split)) parts.push(`負擔改為 ${splitText(e.s)}`);
      if (e.c) parts.push(`原因：${e.c}`);
      if (parts.length) lines.push(`【${p.short}】${item.name}：${parts.join('；')}`);
    }
    for (const a of draft.ad.filter(a => a.p === p.id)) lines.push(`【${p.short}】新增預算「${a.nm}」${ntd(a.a)}（${splitText(a.s)}）${a.c ? `；原因：${a.c}` : ''}`);
    for (const x of draft.pr.filter(x => x.p === p.id)) lines.push(`【${p.short}】補充要準備：${x.x}`);
  }
  return lines;
}
function proposalUrl() {
  const payload = { v: 1, ver: data.version, t: isoToday, n: draft.n, m: draft.m, e: draft.e, ad: draft.ad, pr: draft.pr, d: draft.d };
  return `${location.origin}${location.pathname}#p=${encode(payload)}`;
}
function feedbackText() {
  const lines = changeLines();
  const before = grandTotal(false), after = grandTotal(true);
  const out = [`婚禮小冊建議（${data.version}）`, `來自：${draft.n.trim() || '未填寫'}`, ''];
  if (lines.length) { out.push(`我改了 ${lines.length} 個地方：`, ...lines.map(l => `・${l}`), ''); }
  if (before !== after) out.push(`預算合計：${wan(before)} → ${wan(after)}（${signedWan(after - before)}）`, '');
  if (draft.m.trim()) out.push(`想說的話：${draft.m.trim()}`, '');
  if (lines.length) out.push('點開看我改的版本：', proposalUrl(), '');
  out.push('（這是建議，請新人和兩家討論後再決定是否採納。）');
  return out.join('\n');
}

// ---------- 畫面 ----------
document.title = data.title;
$('version').textContent = data.version;
$('updated').textContent = `更新日期：${data.updated.replaceAll('-', ' / ')}`;
$('notice').textContent = data.notice;

function renderNext() {
  const now = new Date(isoToday);
  const next = data.phases.find(p => new Date(p.target) >= now);
  const box = $('next-event'); box.replaceChildren();
  if (!next) return;
  const days = Math.round((new Date(next.target) - now) / 86400000);
  const confirmed = next.status.includes('已確認') && !next.status.includes('待');
  box.append(node('span', '下一件事', 'next-label'), node('strong', `${next.label}`), node('span', confirmed ? `${next.when}・還有 ${days} 天` : `建議 ${next.when}・約 ${days} 天後`, 'next-when'));
}

function renderRoadmap() {
  const ol = $('roadmap'); ol.replaceChildren();
  data.phases.forEach((p, i) => {
    const li = node('li'); const a = node('a'); a.href = `#phase-${p.id}`;
    a.append(node('span', String(i + 1), 'step-no'), node('strong', p.short), node('span', p.when, 'step-when'), node('span', p.status, 'pill'), node('span', `預算 ${wan(phaseTotal(p.id))}`, 'step-money'));
    li.append(a); ol.append(li);
  });
  const nav = $('jump'); nav.replaceChildren();
  for (const p of data.phases) { const a = node('a', p.short); a.href = `#phase-${p.id}`; nav.append(a); }
  for (const [href, text] of [['#months', '時間表'], ['#budget', '預算'], ['#feedback', '送出建議']]) { const a = node('a', text); a.href = href; nav.append(a); }
}

function rangeBar(item) {
  if (typeof item.low !== 'number' || typeof item.high !== 'number' || item.high <= item.low) return null;
  const wrap = node('div', undefined, 'range');
  const pos = Math.max(0, Math.min(100, (item.amount - item.low) / (item.high - item.low) * 100));
  const track = node('div', undefined, 'range-track'); const dot = node('span', undefined, 'range-dot'); dot.style.left = `${pos}%`; track.append(dot);
  const labels = node('div', undefined, 'range-labels'); labels.append(node('span', `低 ${wan(item.low)}`), node('span', `高 ${wan(item.high)}`));
  wrap.append(track, labels); wrap.setAttribute('aria-hidden', 'true');
  return wrap;
}

function renderBudgetRow(item) {
  const row = node('article', undefined, 'budget-row');
  if (item.removed) row.classList.add('is-removed');
  if (item.edited || item.added) row.classList.add('is-changed');
  const head = node('div', undefined, 'budget-head');
  const title = node('h4', item.name);
  const tag = item.added ? node('span', '新增建議', 'pill pill-new') : item.removed ? node('span', '建議不需要', 'pill pill-new') : item.edited ? node('span', '已修改', 'pill pill-new') : node('span', item.status, 'pill');
  head.append(title, tag);
  const money = node('p', undefined, 'money');
  if (item.locked) money.textContent = '女方家負擔・不列入';
  else if (typeof item.amount !== 'number') money.textContent = '不列金額';
  else { money.append(node('strong', wan(item.amount)), node('span', ntd(item.amount), 'ntd')); }
  row.append(head, money);
  const base = baseItems[item.id];
  if (base && item.edited && typeof base.amount === 'number' && item.amount !== base.amount) row.append(node('p', `原本 ${wan(base.amount)}`, 'was'));
  if (!item.locked && typeof item.amount === 'number') { const bar = rangeBar(item); if (bar) row.append(bar); }
  row.append(node('p', `由誰負擔：${splitText(item.split)}`, 'who'));
  if (item.note) row.append(node('p', item.note, 'note'));
  if (item.comment) row.append(node('p', `我的想法：${item.comment}`, 'mine'));
  if (!readOnly && !item.locked) {
    const btn = node('button', '修改', 'edit-button'); btn.type = 'button';
    btn.setAttribute('aria-label', `修改「${item.name}」`);
    btn.addEventListener('click', () => openEditor(item.phase, item.id));
    row.append(btn);
  }
  return row;
}

function renderPhases() {
  const host = $('phases'); host.replaceChildren();
  data.phases.forEach((p, idx) => {
    const sec = node('section', undefined, 'phase'); sec.id = `phase-${p.id}`; sec.setAttribute('aria-labelledby', `h-${p.id}`);
    const head = node('div', undefined, 'section-head');
    const hgroup = node('div'); hgroup.append(node('p', `0${idx + 2} / 第 ${idx + 1} 件事`, 'eyebrow'));
    const h2 = node('h2', p.label); h2.id = `h-${p.id}`; hgroup.append(h2);
    head.append(hgroup, node('span', p.status, 'pill'));
    sec.append(head);

    // 日期卡
    const card = node('div', undefined, 'date-card wide');
    card.append(node('p', '日期', 'label'), node('h3', p.when, 'when-big'));
    if (p.candidates.length) { const chips = node('div', undefined, 'chips'); for (const c of p.candidates) chips.append(node('span', c, 'chip')); card.append(chips); }
    card.append(node('p', `地點：${p.place}`, 'detail'), node('p', p.why, 'detail'));
    const tip = node('p', undefined, 'tip'); tip.append(node('strong', '婚顧提醒　'), document.createTextNode(p.avoid)); card.append(tip);
    if (!readOnly || draft.d[p.id]) {
      const lab = node('label', '我建議的日期或時段 '); lab.htmlFor = `date-${p.id}`; lab.append(node('span', '（選填）'));
      const inp = node('input'); inp.id = `date-${p.id}`; inp.maxLength = 100; inp.placeholder = p.candidates.length ? `例如：${p.candidates[p.candidates.length > 1 ? 1 : 0]} 比較方便` : '例如：上午比較方便'; inp.value = draft.d[p.id] || '';
      inp.disabled = readOnly;
      inp.addEventListener('change', () => { const v = inp.value.trim(); if (v) draft.d[p.id] = v; else delete draft.d[p.id]; save(); refreshSummary(); });
      const wrap = node('div', undefined, 'date-suggest'); wrap.append(lab, inp); card.append(wrap);
    }
    sec.append(card);

    // 行程與準備
    const grid = node('div', undefined, 'phase-grid');
    const left = node('div'); left.append(node('h3', '當天行程（示意時間）', 'block-title'));
    const tl = node('ol', undefined, 'timeline');
    for (const s of p.schedule) {
      const li = node('li'); const body = node('div');
      body.append(node('h4', s.title), node('p', s.detail), node('span', s.who, 'who'));
      li.append(node('span', s.time, 'event-time'), body); tl.append(li);
    }
    left.append(tl);
    if (p.scheduleNote) left.append(node('p', p.scheduleNote, 'planning-note'));
    const right = node('div', undefined, 'prepare'); right.append(node('h3', '要準備的東西', 'block-title'));
    for (const g of p.prepare) {
      right.append(node('h4', g.group, 'prep-group'));
      const ul = node('ul', undefined, 'checklist');
      for (const it of g.items) { const li = node('li'); li.append(node('span', it.text), node('span', it.who, 'who')); ul.append(li); }
      right.append(ul);
    }
    const extra = draft.pr.filter(x => x.p === p.id);
    if (extra.length) {
      right.append(node('h4', '家人補充', 'prep-group'));
      const ul = node('ul', undefined, 'checklist added');
      for (const x of extra) {
        const li = node('li'); li.append(node('span', x.x));
        if (!readOnly) { const del = node('button', '刪除', 'text-button'); del.type = 'button'; del.addEventListener('click', () => { draft.pr.splice(draft.pr.indexOf(x), 1); save(); renderAll(); }); li.append(del); }
        ul.append(li);
      }
      right.append(ul);
    }
    if (!readOnly) {
      const form = node('form', undefined, 'add-prep');
      const lab = node('label', '補充一項要準備的'); lab.htmlFor = `prep-${p.id}`;
      const inp = node('input'); inp.id = `prep-${p.id}`; inp.maxLength = 100; inp.placeholder = '例如：準備長輩休息的椅子';
      const btn = node('button', '加入', 'button small secondary'); btn.type = 'submit';
      form.append(lab, node('div', undefined, 'inline')); form.lastChild.append(inp, btn);
      form.addEventListener('submit', ev => { ev.preventDefault(); const v = inp.value.trim(); if (!v) return; draft.pr.push({ p: p.id, x: v }); save(); renderAll(); $(`prep-${p.id}`)?.focus(); });
      right.append(form);
    }
    grid.append(left, right); sec.append(grid);

    // 預算
    const bud = node('div', undefined, 'phase-budget');
    const bh = node('div', undefined, 'budget-title');
    bh.append(node('h3', '這一場的預算', 'block-title'));
    const now = phaseTotal(p.id), was = phaseTotal(p.id, false);
    const sub = node('p', undefined, 'subtotal'); sub.append(node('span', '小計 '), node('strong', wan(now)));
    if (now !== was) sub.append(node('span', `（原本 ${wan(was)}）`, 'was'));
    bh.append(sub); bud.append(bh);
    const list = node('div', undefined, 'budget-list');
    for (const item of itemsOf(p.id)) list.append(renderBudgetRow(item));
    bud.append(list);
    if (!readOnly) { const add = node('button', '＋ 新增一項預算', 'button secondary add-item'); add.type = 'button'; add.addEventListener('click', () => openEditor(p.id, null)); bud.append(add); }
    sec.append(bud);
    host.append(sec);
  });
}

function renderMonths() {
  const ol = $('month-list'); ol.replaceChildren();
  const cur = isoToday.slice(0, 7);
  for (const m of data.months) {
    const li = node('li', undefined, 'month'); if (m.month === cur) { li.classList.add('current'); li.setAttribute('aria-current', 'date'); }
    if (m.month < cur) li.classList.add('past');
    const [y, mo] = m.month.split('-');
    const head = node('div', undefined, 'month-head'); head.append(node('span', `${y} 年`, 'year'), node('strong', `${Number(mo)} 月`));
    if (m.month === cur) head.append(node('span', '這個月', 'pill pill-new'));
    const body = node('div'); body.append(node('h3', m.focus));
    const ul = node('ul');
    for (const t of m.tasks) { const it = node('li'); it.append(node('span', t.text), node('span', t.who, 'who')); ul.append(it); }
    body.append(ul); li.append(head, body); ol.append(li);
  }
}

function bars(rows, total) {
  const wrap = node('div', undefined, 'bars');
  for (const r of rows) {
    const row = node('div', undefined, 'bar-row');
    const pct = total ? Math.round(r.value / total * 100) : 0;
    const label = node('div', undefined, 'bar-label'); label.append(node('span', r.label), node('strong', `${wan(r.value)}・${pct}%`));
    const track = node('div', undefined, 'bar-track'); const fill = node('span', undefined, 'bar-fill'); fill.style.width = `${pct}%`; track.append(fill);
    row.append(label, track);
    if (r.was !== undefined && Math.round(r.was) !== Math.round(r.value)) row.append(node('p', `原本 ${wan(r.was)}`, 'was'));
    wrap.append(row);
  }
  return wrap;
}

function renderSummary() {
  const host = $('budget-summary'); host.replaceChildren();
  const after = grandTotal(true), before = grandTotal(false);
  const tiles = node('div', undefined, 'tiles');
  const t1 = node('div', undefined, 'tile'); t1.append(node('p', changeLines().length && !readOnly ? '您的版本合計' : readOnly ? '這份建議的合計' : '目前試算合計'), node('strong', wan(after)), node('span', ntd(after), 'ntd'));
  tiles.append(t1);
  if (after !== before) {
    const t2 = node('div', undefined, 'tile'); t2.append(node('p', '原本試算'), node('strong', wan(before)), node('span', ntd(before), 'ntd'));
    const t3 = node('div', undefined, 'tile accent'); t3.append(node('p', '差別'), node('strong', signedWan(after - before)));
    tiles.append(t2, t3);
  }
  host.append(tiles);
  const grid = node('div', undefined, 'summary-grid');
  const a = node('div'); a.append(node('h3', '依四件事分', 'block-title'));
  a.append(bars(data.phases.map(p => ({ label: p.short, value: phaseTotal(p.id), was: phaseTotal(p.id, false) })), after));
  const pt = partyTotals(true), pw = partyTotals(false);
  const b = node('div'); b.append(node('h3', '依誰負擔分', 'block-title'));
  b.append(bars(PARTIES.map(k => ({ label: data.parties[k], value: pt[k], was: pw[k] })), after));
  grid.append(a, b); host.append(grid);
  const notes = node('ul', undefined, 'fine-print');
  for (const t of ['大聘是否退回、退多少，由女方家決定；這裡以需先準備的金額計算。', '不含女方家主辦的訂婚宴，以及新人自理、不列金額的項目（戒指、媒人與迎娶紅包等）。', '金額為 2026 年的公開報價與網路實例試算；拿到 2027 年正式報價後會更新。']) notes.append(node('li', t));
  host.append(notes);
}

function renderChanges() {
  const ul = $('change-list'); ul.replaceChildren();
  const lines = changeLines();
  if (!lines.length) ul.append(node('li', '還沒有修改。可以在上面每一場的預算按「修改」，或補充要準備的東西。', 'empty-line'));
  for (const l of lines) ul.append(node('li', l));
  const dock = $('dock');
  dock.hidden = readOnly || !lines.length;
  $('dock-text').textContent = `您有 ${lines.length} 項建議還沒送出`;
  const text = feedbackText();
  $('line-button').href = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  const mail = data.feedback && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(data.feedback.email || '') ? data.feedback.email : '';
  $('email-button').hidden = !mail;
  if (mail) $('email-button').href = `mailto:${mail}?subject=${encodeURIComponent(`婚禮小冊建議${draft.n.trim() ? `：${draft.n.trim()}` : ''}`)}&body=${encodeURIComponent(text)}`;
}

function refreshSummary() { renderRoadmap(); renderSummary(); renderChanges(); }
function renderAll() { renderNext(); renderPhases(); refreshSummary(); }

for (const q of data.questions) $('questions').append(node('li', q));
for (const item of data.decisions) {
  const row = node('article', undefined, 'decision'); const time = node('time', item.date); time.dateTime = item.date;
  row.append(time, node('h3', item.title), node('p', item.detail)); $('decisions').append(row);
}
for (const s of data.sources) { const li = node('li'); const a = node('a', s.title); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); $('sources').append(li); }

// ---------- 修改視窗 ----------
const dlg = $('editor');
let editing = null; // { phase, id|null, split }
function parseAmount(v) { const n = Number(String(v).replace(/[^\d]/g, '')); return Number.isFinite(n) ? Math.min(n, 1e8) : 0; }
function stepOf(n) { return n >= 100000 ? 10000 : n >= 10000 ? 1000 : 500; }
function updateAmountHint() { const n = parseAmount($('ed-amount').value); $('ed-amount-hint').textContent = `＝ ${wan(n)}`; renderSplit(); }
function rebalance(split, key, value) {
  const others = PARTIES.filter(k => k !== key);
  const rest = 100 - value; const cur = others.reduce((s, k) => s + (split[k] || 0), 0);
  const out = { [key]: value };
  if (cur === 0) others.forEach((k, i) => { out[k] = i === 0 ? rest : 0; });
  else { let used = 0; others.forEach((k, i) => { const v = i === others.length - 1 ? rest - used : Math.round((split[k] || 0) / cur * rest / 5) * 5; out[k] = Math.max(0, v); used += out[k]; }); }
  return out;
}
function renderSplit() {
  const host = $('ed-split'); host.replaceChildren();
  const amount = parseAmount($('ed-amount').value);
  for (const k of PARTIES) {
    const row = node('div', undefined, 'split-row');
    const id = `sp-${k}`;
    const lab = node('label', data.parties[k]); lab.htmlFor = id;
    const out = node('output', `${editing.split[k] || 0}%`); out.htmlFor = id;
    const range = node('input'); range.type = 'range'; range.id = id; range.min = 0; range.max = 100; range.step = 5; range.value = editing.split[k] || 0;
    range.addEventListener('input', () => { editing.split = rebalance(editing.split, k, Number(range.value)); renderSplit(); $(`sp-${k}`).focus(); });
    const money = node('span', amount ? wan(amount * (editing.split[k] || 0) / 100) : '', 'split-money');
    const top = node('div', undefined, 'split-top'); top.append(lab, out, money);
    row.append(top, range); host.append(row);
  }
}
function openEditor(phaseId, itemId) {
  const phase = phaseById[phaseId];
  const added = itemId ? draft.ad.find(a => a.id === itemId) : null;
  const base = itemId && !added ? baseItems[itemId] : null;
  const eff = base ? effective(base) : null;
  editing = { phase: phaseId, id: itemId, added: !!added || !itemId, split: { ...((added && added.s) || (eff && eff.split) || phase.budget[0].split) } };
  $('editor-title').textContent = itemId ? `修改：${added ? added.nm : base.name}` : '新增一項預算';
  $('editor-phase').textContent = `${phase.label}・${phase.when}`;
  $('name-field').hidden = !editing.added;
  $('ed-name').value = added ? added.nm : '';
  const amt = added ? added.a : eff && typeof eff.amount === 'number' ? eff.amount : 0;
  $('ed-amount').value = amt ? amt.toLocaleString('zh-TW') : '';
  $('ed-note').value = added ? added.c : eff ? eff.comment : '';
  $('remove-field').hidden = !base; $('ed-remove').checked = !!(eff && eff.removed);
  $('ed-revert').textContent = added ? '刪除這項' : '恢復原本';
  $('ed-revert').hidden = !itemId;
  const presets = $('ed-presets'); presets.replaceChildren();
  if (base && typeof base.low === 'number' && base.high > base.low) {
    for (const [label, v] of [['低標', base.low], ['原本試算', base.amount], ['高標', base.high]]) {
      const b = node('button', `${label} ${wan(v)}`, 'chip-button'); b.type = 'button';
      b.addEventListener('click', () => { $('ed-amount').value = v.toLocaleString('zh-TW'); updateAmountHint(); });
      presets.append(b);
    }
  }
  updateAmountHint();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  (editing.added && !itemId ? $('ed-name') : $('ed-amount')).focus();
}
function closeEditor() { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
$('ed-amount').addEventListener('input', updateAmountHint);
$('ed-amount').addEventListener('blur', () => { const n = parseAmount($('ed-amount').value); $('ed-amount').value = n ? n.toLocaleString('zh-TW') : ''; });
for (const [id, dir] of [['ed-minus', -1], ['ed-plus', 1]]) $(id).addEventListener('click', () => {
  const n = parseAmount($('ed-amount').value); const step = stepOf(dir < 0 ? Math.max(n - 1, 0) : n);
  $('ed-amount').value = Math.max(0, n + dir * step).toLocaleString('zh-TW'); updateAmountHint();
});
$('editor-close').addEventListener('click', closeEditor);
$('ed-revert').addEventListener('click', () => {
  if (!editing) return;
  if (editing.added) draft.ad = draft.ad.filter(a => a.id !== editing.id); else delete draft.e[editing.id];
  save(); closeEditor(); renderAll();
});
$('editor-form').addEventListener('submit', ev => {
  ev.preventDefault();
  const amount = parseAmount($('ed-amount').value);
  const note = $('ed-note').value.trim().slice(0, 500);
  const split = cleanSplit(editing.split) || { groom: 100 };
  if (editing.added) {
    const name = $('ed-name').value.trim().slice(0, 40);
    if (!name) { $('ed-name').setCustomValidity('請寫項目名稱'); $('ed-name').reportValidity(); return; }
    if (editing.id) Object.assign(draft.ad.find(a => a.id === editing.id), { nm: name, a: amount, s: split, c: note });
    else draft.ad.push({ id: `n${Date.now().toString(36)}`, p: editing.phase, nm: name, a: amount, s: split, c: note });
  } else {
    const base = baseItems[editing.id]; const e = {};
    const baseAmount = typeof base.amount === 'number' ? base.amount : undefined;
    if ($('ed-amount').value.trim() !== '' && amount !== baseAmount) e.a = amount;
    if (!sameSplit(split, base.split)) e.s = split;
    if ($('ed-remove').checked) e.r = 1;
    if (note) e.c = note;
    if (Object.keys(e).length) draft.e[editing.id] = e; else delete draft.e[editing.id];
  }
  const target = editing.phase;
  save(); closeEditor(); renderAll();
  document.getElementById(`phase-${target}`)?.querySelector('.phase-budget')?.scrollIntoView({ block: 'start' });
});
$('ed-name').addEventListener('input', () => $('ed-name').setCustomValidity(''));
dlg.addEventListener('click', ev => { if (ev.target === dlg) closeEditor(); });

// ---------- 送出 ----------
$('name').value = draft.n; $('message').value = draft.m;
$('name').addEventListener('input', () => { draft.n = $('name').value.slice(0, 40); save(); renderChanges(); });
$('message').addEventListener('input', () => { draft.m = $('message').value.slice(0, 2000); save(); renderChanges(); });
function nothingToSend(ev) {
  if (changeLines().length || draft.m.trim()) return false;
  ev.preventDefault();
  $('feedback-status').textContent = '還沒有任何修改或想說的話。可以先在上面修改，或在「還想說的話」寫下來。';
  return true;
}
$('line-button').addEventListener('click', ev => { if (!nothingToSend(ev)) $('feedback-status').textContent = '正在開啟 LINE。請選擇新人或家族群組，再按「傳送」才會送出。'; });
$('email-button').addEventListener('click', ev => { if (!nothingToSend(ev)) $('feedback-status').textContent = '正在開啟郵件程式。請在郵件程式按「寄出」才會送達；沒有開啟的話，請改用 LINE 或複製文字。'; });
$('copy-button').addEventListener('click', async ev => {
  if (nothingToSend(ev)) return;
  const text = feedbackText();
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    $('manual-copy').hidden = true;
    $('feedback-status').textContent = '已複製，還沒有傳送。請貼到 LINE 或訊息中傳給新人。';
  } catch (_) {
    $('manual-copy').hidden = false; $('copy-text').value = text; $('copy-text').focus(); $('copy-text').select();
    $('feedback-status').textContent = '無法自動複製，請複製下方文字後傳給新人。尚未傳送。';
  }
});
$('reset-draft').addEventListener('click', () => {
  if (!confirm('確定要清除您在這支手機上的所有修改嗎？')) return;
  draft = emptyDraft(); save(); $('name').value = ''; $('message').value = ''; $('feedback-status').textContent = '已清除，回到原本的版本。'; renderAll();
});

// ---------- 提案檢視（新人點開長輩傳來的連結） ----------
if (readOnly) {
  document.body.classList.add('read-only');
  $('proposal-banner').hidden = false;
  $('proposal-title').textContent = `${draft.n.trim() || '家人'}的建議（尚未採納）`;
  const when = typeof proposal.t === 'string' ? proposal.t.slice(0, 10) : '';
  const ver = typeof proposal.ver === 'string' ? proposal.ver.slice(0, 40) : '';
  $('proposal-meta').textContent = `${when ? `${when} 提出・` : ''}根據「${ver || '未知版本'}」修改。標示「已修改／新增建議」的地方就是這位家人的意見。${ver && ver !== data.version ? '（注意：正式版本已更新，部分內容可能不同。）' : ''}`;
  $('feedback-title').textContent = '這份建議改了哪些地方';
  $('name').disabled = true; $('message').disabled = true;
  $('copy-json').addEventListener('click', async () => {
    const json = JSON.stringify({ from: draft.n, date: when, baseVersion: ver, message: draft.m, edits: draft.e, added: draft.ad, prepare: draft.pr, dates: draft.d }, null, 2);
    try { await navigator.clipboard.writeText(json); $('copy-json').textContent = '已複製'; }
    catch (_) { $('manual-copy').hidden = false; $('copy-text').value = json; $('copy-text').select(); location.hash = 'feedback'; }
  });
}

$('font').addEventListener('click', () => {
  const large = document.documentElement.classList.toggle('large-text');
  $('font').setAttribute('aria-pressed', String(large));
  $('font').textContent = large ? '恢復原本字級' : '字再大一點';
});
$('print').addEventListener('click', () => window.print());

renderAll();
