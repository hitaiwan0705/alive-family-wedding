'use strict';
// 互動層：只負責顯示 content.js 與收集長輩意見。內容（日期、金額、文字）一律由 content.js 提供。
const data = window.WEDDING;
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (className) n.className = className; return n; };
const phases = (data.phases || []).map(p => ({ candidates: [], schedule: [], prepare: [], budget: [], ...p }));
const PARTIES = Object.keys(data.parties || { groom: '男方', couple: '新人', bride: '女方' });
const partyName = k => (data.parties || {})[k] || k;
const STORE_KEY = 'alive-wedding-draft-v2';
const ENDPOINT = (() => { const u = ((window.SITE_CONFIG || {}).sheetEndpoint || '').trim(); return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) ? u : ''; })();
const OLD_STORE_KEY = 'alive-wedding-draft-v1';
const phaseById = Object.fromEntries(phases.map(p => [p.id, p]));
const baseItems = {};
for (const p of phases) for (const item of p.budget) baseItems[item.id] = { ...item, phase: p.id };

// ---------- 介面用語（看法選項） ----------
// 日期、行程、清單、預算：旁邊是兩顆同位階的按鈕「合理，OK」與「我有意見」。
// choices 第一項 ok 只由「合理，OK」記下（試算表看法欄仍寫原本的字，如「金額剛好」）；「我有意見」視窗只列不同意見。
const OK_TEXT = '合理，OK';
const MORE_TEXT = '我有意見';
const KINDS = {
  date: { label: '日期', title: '對日期的意見', choices: [['ok', '這天可以'], ['no', '這天不方便'], ['other', '想建議別的日子']], placeholder: '例如：10/25 比較方便，上午出發比較好' },
  sched: { label: '當天行程', title: '對當天行程的意見', choices: [['ok', '這樣安排可以'], ['rush', '時間太趕'], ['change', '想加或減某個步驟']], placeholder: '例如：希望先拍長輩合照，大家比較不用久候' },
  prep: { label: '準備清單', title: '對準備清單的意見', choices: [['ok', '清單沒問題'], ['add', '我想補充一項'], ['who', '分工想調整']], placeholder: '例如：要準備讓長輩休息的椅子' },
  bok: { label: '其他花費', button: '其他花費都沒意見', title: '其他花費', choices: [['ok', '都沒意見']] },
  q: { label: '一起商量', button: '回答這題', title: '回答這一題', choices: [], placeholder: '想到什麼都可以說，例如：我覺得 7/24 比較好' },
  budget: { label: '預算', title: '對這筆花費的意見', choices: [['ok', '金額剛好'], ['less', '太多，可以少一點'], ['more', '不太夠，要多一點'], ['drop', '這項可以不用'], ['who', '想改由誰負擔']] }
};
const WHO = [['groom', `${partyName('groom')}全出`, { groom: 100 }], ['couple', `${partyName('couple')}全出`, { couple: 100 }], ['bride', `${partyName('bride')}全出`, { bride: 100 }], ['half', `${partyName('groom')}、${partyName('bride')}各半`, { groom: 50, bride: 50 }], ['other', '其他（請寫在下面）', null]];
const choiceLabel = (kind, f) => (KINDS[kind].choices.find(c => c[0] === f) || [])[1] || '';
// 字串雜湊：讓「一起商量」的題目不必有 id，Codex 改字也不會弄丟已寫的回答（回答內附原題目）
function hashOf(str) { let h = 5381; for (const ch of str) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0; return h.toString(36); }
// questions 可以是純文字（只能寫回答），或 { q, scope, choices }：scope 標示由誰決定，choices 是一按就記下的選項
const SCOPES = { both: '兩家一起商量', couple: '新人決定・先聽聽您的意見' };
const questionList = () => (data.questions || []).map(x => {
  const o = typeof x === 'string' ? { q: x } : x || {};
  return { key: hashOf(o.q || ''), q: o.q || '', scope: SCOPES[o.scope] ? o.scope : '', choices: Array.isArray(o.choices) ? o.choices.filter(c => typeof c === 'string' && c.trim()) : [] };
}).filter(x => x.q);
const questionByKey = key => questionList().find(x => x.key === key);
// 精簡模式要表態的地方：content.js 可用 ask: true/false 指定；預設為未確認、可表態的項目
function needsAsk(x) {
  if (x.ask === true) return true;
  if (x.ask === false || x.locked || x.private) return false;
  const st = x.status || '';
  return !(st.includes('已確認') && !st.includes('待'));
}
const whoLabel = w => (WHO.find(x => x[0] === w) || [])[1] || '';

// ---------- 格式 ----------
const ntd = n => `NT$${Math.round(n).toLocaleString('zh-TW')}`;
function wan(n) {
  if (!n) return '0 元';
  if (Math.abs(n) < 10000) return `${Math.round(n).toLocaleString('zh-TW')} 元`;
  return `${parseFloat((n / 10000).toFixed(2))} 萬`;
}
const signedWan = n => (n > 0 ? '多 ' : '少 ') + wan(Math.abs(n));
const splitText = s => PARTIES.filter(k => s && s[k]).map(k => `${partyName(k)} ${s[k]}%`).join('、') || '待定';
const today = new Date();
const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function icon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 5h16v11H9l-5 4z'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); return svg;
}

// ---------- 意見草稿（只存在這支手機）與提案連結 ----------
// e：預算項目 {f 看法, a 建議金額, w 由誰負擔, t 文字}；ad：新增項目；c：日期／行程／準備清單 {f, t}；o：方案傾向
const emptyDraft = () => ({ e: {}, ad: [], c: {}, o: {}, q: {}, n: '', m: '' });
const cleanStr = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
function cleanAmount(v) { const n = Number(v); return v !== '' && v !== null && Number.isFinite(n) && n >= 0 && n <= 1e8 ? Math.round(n) : undefined; }
const validChoice = (kind, f) => KINDS[kind].choices.some(c => c[0] === f) ? f : undefined;
function sanitize(raw) {
  const d = emptyDraft();
  if (!raw || typeof raw !== 'object') return d;
  for (const [id, e] of Object.entries(raw.e || {})) {
    const base = baseItems[id];
    if (!base || base.locked || !e || typeof e !== 'object') continue;
    const x = {}; const a = cleanAmount(e.a);
    x.f = validChoice('budget', e.f) || (e.r ? 'drop' : a !== undefined ? (a < (base.amount || 0) ? 'less' : 'more') : e.s ? 'who' : undefined);
    if (a !== undefined && (x.f === 'less' || x.f === 'more')) x.a = a;
    if (x.f === 'who' && WHO.some(w => w[0] === e.w)) x.w = e.w;
    const t = cleanStr(e.t || e.c, 500).trim(); if (t) x.t = t;
    if (!x.f) delete x.f;
    if (x.f || x.t) d.e[id] = x;
  }
  for (const a of Array.isArray(raw.ad) ? raw.ad.slice(0, 40) : []) {
    if (!a || !phaseById[a.p] || !cleanStr(a.nm, 40).trim()) continue;
    const x = { id: cleanStr(a.id, 20) || `n${d.ad.length}`, p: a.p, nm: cleanStr(a.nm, 40).trim() };
    const amt = cleanAmount(a.a); if (amt !== undefined) x.a = amt;
    if (WHO.some(w => w[0] === a.w)) x.w = a.w;
    const t = cleanStr(a.t || a.c, 500).trim(); if (t) x.t = t;
    d.ad.push(x);
  }
  for (const [key, v] of Object.entries(raw.c || {})) {
    const [kind, pid] = key.split(':');
    if (!KINDS[kind] || kind === 'budget' || !phaseById[pid] || !v || typeof v !== 'object') continue;
    const x = {}; const f = validChoice(kind, v.f); if (f) x.f = f;
    const t = cleanStr(v.t, 500).trim(); if (t) x.t = t;
    if (x.f || x.t) d.c[key] = x;
  }
  // 舊版（v1）資料：建議日期、補充準備
  for (const [p, t] of Object.entries(raw.d || {})) if (phaseById[p] && cleanStr(t, 100).trim()) d.c[`date:${p}`] = { f: 'other', t: cleanStr(t, 100).trim() };
  for (const x of Array.isArray(raw.pr) ? raw.pr : []) if (x && phaseById[x.p] && cleanStr(x.x, 100).trim()) {
    const key = `prep:${x.p}`; const prev = d.c[key] ? `${d.c[key].t}；` : '';
    d.c[key] = { f: 'add', t: (prev + cleanStr(x.x, 100).trim()).slice(0, 500) };
  }
  for (const [p, id] of Object.entries(raw.o || {})) { const c = phaseById[p] && phaseById[p].compare; if (c && c.options.some(o => o.id === id)) d.o[p] = id; }
  for (const [k, v] of Object.entries(raw.q || {})) {
    if (!v || typeof v !== 'object' || !/^[0-9a-z]{1,10}$/.test(k)) continue;
    const t = cleanStr(v.t, 500).trim(); const q = cleanStr(v.q, 200).trim(); const c = cleanStr(v.c, 40).trim();
    if (q && (t || c)) { d.q[k] = { q }; if (c) d.q[k].c = c; if (t) d.q[k].t = t; }
  }
  if (typeof raw.sid === 'string' && /^[a-z0-9]{6,40}$/.test(raw.sid)) d.sid = raw.sid;
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
if (location.hash.startsWith('#p=')) { try { proposal = decode(location.hash.slice(3)); } catch (_) { proposal = null; } }
const readOnly = !!proposal;
let draft = emptyDraft();
if (readOnly) draft = sanitize(proposal);
else {
  try { const saved = localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_STORE_KEY); if (saved) draft = sanitize(JSON.parse(saved)); } catch (_) { /* 無法讀取就從空白開始 */ }
}
function save() {
  if (readOnly) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(draft)); } catch (_) { /* 私密瀏覽等情況，只在本次瀏覽有效 */ }
}

// ---------- 套用意見後的項目 ----------
function effective(item) {
  const e = draft.e[item.id];
  if (!e) return { ...item };
  const who = e.w && WHO.find(w => w[0] === e.w);
  return { ...item, amount: e.a ?? item.amount, split: (who && who[2]) || item.split, removed: e.f === 'drop', opinion: e };
}
function itemsOf(pid, useDraft = true) {
  const base = phaseById[pid].budget.map(i => ({ ...i, phase: pid }));
  if (!useDraft) return base;
  const list = base.map(effective);
  for (const a of draft.ad.filter(a => a.p === pid)) {
    const who = a.w && WHO.find(w => w[0] === a.w);
    list.push({ id: a.id, phase: pid, name: a.nm, amount: a.a, split: (who && who[2]) || {}, added: a, status: '家人新增' });
  }
  return list;
}
const counts = i => !i.removed && !i.locked && typeof i.amount === 'number';
const phaseTotal = (pid, useDraft = true) => itemsOf(pid, useDraft).filter(counts).reduce((s, i) => s + i.amount, 0);
const grandTotal = (useDraft = true) => phases.reduce((s, p) => s + phaseTotal(p.id, useDraft), 0);
function partyTotals(useDraft = true) {
  const t = Object.fromEntries(PARTIES.map(k => [k, 0]));
  for (const p of phases) for (const i of itemsOf(p.id, useDraft).filter(counts)) for (const k of PARTIES) t[k] += i.amount * ((i.split || {})[k] || 0) / 100;
  return t;
}

// ---------- 意見清單（同一份資料給畫面與 LINE 文字） ----------
function opinionText(kind, o, item) {
  const parts = [];
  if (o.f) parts.push(choiceLabel(kind, o.f));
  if (kind === 'budget' && o.a !== undefined) parts.push(`建議 ${wan(o.a)}`);
  if (o.w) parts.push(`改成 ${whoLabel(o.w)}`);
  let s = parts.join('，');
  if (o.t) s += (s ? '——' : '') + o.t;
  return s || (item ? '' : '');
}
function opinions() {
  // 每則意見：畫面文字（label/text）＋給試算表的欄位（rec）
  const list = [];
  const push = (phase, label, text, rec, open, remove) => list.push({ phase, label, text, rec: { phaseId: phase.id || '', phaseLabel: phase.short || phase.label || '', targetName: label, text: '', ...rec }, open, remove });
  for (const p of phases) {
    for (const kind of ['date', 'sched', 'prep', 'bok']) {
      const o = draft.c[`${kind}:${p.id}`];
      if (o) push(p, KINDS[kind].label, opinionText(kind, o), { kind, targetId: `${kind}:${p.id}`, choice: o.f || '', choiceLabel: choiceLabel(kind, o.f), text: o.t || '' }, () => kind === 'bok' ? document.getElementById(`budget-${p.id}`)?.scrollIntoView({ block: 'start' }) : openSheet({ kind, pid: p.id }), () => { delete draft.c[`${kind}:${p.id}`]; });
    }
    if (draft.o[p.id] && p.compare) {
      const opt = p.compare.options.find(o => o.id === draft.o[p.id]);
      push(p, p.compare.title ? '方案比較' : '方案', `比較傾向 ${opt.name}`, { kind: 'compare', targetId: `compare:${p.id}`, choice: opt.id, choiceLabel: opt.name }, () => document.getElementById(`compare-${p.id}`)?.scrollIntoView({ block: 'start' }), () => { delete draft.o[p.id]; });
    }
    for (const item of p.budget) {
      const o = draft.e[item.id]; if (!o) continue;
      push(p, item.name, opinionText('budget', o), { kind: 'budget', targetId: item.id, choice: o.f || '', choiceLabel: choiceLabel('budget', o.f), amount: o.a ?? '', baseAmount: item.amount ?? '', who: o.w ? whoLabel(o.w) : '', text: o.t || '' }, () => openSheet({ kind: 'budget', pid: p.id, id: item.id }), () => { delete draft.e[item.id]; });
    }
    for (const a of draft.ad.filter(a => a.p === p.id)) {
      const bits = [a.a !== undefined ? `約 ${wan(a.a)}` : '', a.w ? whoLabel(a.w) : ''].filter(Boolean).join('，');
      push(p, `想加一項：${a.nm}`, bits + (a.t ? (bits ? '——' : '') + a.t : ''), { kind: 'add', targetId: a.id, targetName: a.nm, choice: 'add', choiceLabel: '想加一項花費', amount: a.a ?? '', who: a.w ? whoLabel(a.w) : '', text: a.t || '' }, () => openSheet({ kind: 'add', pid: p.id, id: a.id }), () => { draft.ad = draft.ad.filter(x => x !== a); });
    }
  }
  const qPhase = { id: 'questions', short: '一起商量', label: '一起商量' };
  for (const [key, o] of Object.entries(draft.q)) {
    push(qPhase, o.q, [o.c, o.t].filter(Boolean).join('——'), { kind: 'q', targetId: `q:${key}`, choiceLabel: o.c || '回答', text: o.t || '' }, () => openSheet({ kind: 'q', key, q: o.q, choices: (questionByKey(key) || {}).choices || [] }), () => { delete draft.q[key]; });
  }
  return list;
}
function proposalUrl() {
  const payload = { v: 2, ver: data.version, t: isoToday, n: draft.n, m: draft.m, e: draft.e, ad: draft.ad, c: draft.c, o: draft.o, q: draft.q };
  return `${location.origin}${location.pathname}#p=${encode(payload)}`;
}
function feedbackText() {
  const list = opinions();
  const before = grandTotal(false), after = grandTotal(true);
  const out = [`婚禮小冊的意見（${data.version}）`, `來自：${draft.n.trim() || '（沒有留名字）'}`, ''];
  if (list.length) out.push(`我有 ${list.length} 則意見：`, ...list.map((o, i) => `${i + 1}. 【${o.phase.short}】${o.label}：${o.text}`), '');
  if (before !== after) out.push(`照我的意見，預算合計 ${wan(before)} → ${wan(after)}（${signedWan(after - before)}）`, '');
  if (draft.m.trim()) out.push(`其他想說的話：${draft.m.trim()}`, '');
  if (list.length) out.push('（新人用）點開看完整內容：', proposalUrl(), '');
  out.push('這是我的意見，請新人和兩家討論後再決定。');
  return out.join('\n');
}

// ---------- 首頁資訊 ----------
document.title = data.title || document.title;
$('version').textContent = data.version || '';
$('updated').textContent = data.updated ? `更新日期：${data.updated.replaceAll('-', ' / ')}` : '';
$('notice').textContent = data.notice || '';

function renderNext() {
  const now = new Date(isoToday);
  const next = phases.find(p => p.target && new Date(p.target) >= now);
  const box = $('next-event'); box.replaceChildren();
  if (!next) return;
  const days = Math.round((new Date(next.target) - now) / 86400000);
  const confirmed = (next.status || '').includes('已確認') && !(next.status || '').includes('待');
  box.append(node('span', '下一件事', 'next-label'), node('strong', next.label), node('span', confirmed ? `${next.when}・還有 ${days} 天` : `${next.when}（候選）・約 ${days} 天後`, 'next-when'));
}

function renderRoadmap() {
  const ol = $('roadmap'); ol.replaceChildren();
  phases.forEach((p, i) => {
    const li = node('li'); const a = node('a'); a.href = `#phase-${p.id}`;
    a.append(node('span', String(i + 1), 'step-no'), node('strong', p.short || p.label), node('span', p.when, 'step-when'), node('span', p.status, 'pill'), node('span', `預算 ${wan(phaseTotal(p.id))}`, 'step-money'));
    li.append(a); ol.append(li);
  });
  const nav = $('jump'); nav.replaceChildren();
  for (const p of phases) { const a = node('a', p.short || p.label); a.href = `#phase-${p.id}`; nav.append(a); }
  for (const [href, text] of [['#months', '時間表'], ['#budget', '預算'], ['#feedback', '傳意見']]) { const a = node('a', text); a.href = href; nav.append(a); }
}

// ---------- 「我有意見」按鈕與已記下的意見 ----------
function opinionButton(label, onClick, has, about, hasLabel = '改我的意見') {
  const b = node('button', undefined, `opinion-button${has ? ' has' : ''}`); b.type = 'button';
  b.append(icon(), node('span', has ? hasLabel : label));
  b.setAttribute('aria-label', `${has ? '修改我對' : '我對'}「${about || label}」${has ? '的意見' : '有意見'}`);
  b.addEventListener('click', onClick);
  return b;
}
// 同位階的兩顆按鈕：「合理，OK」一按就記下（再按取消），「我有意見」打開視窗只選不同意見
const isOkOnly = o => !!o && o.f === 'ok' && !o.t && o.a === undefined && !o.w;
function opinionPair(o, about, onOk, onMore) {
  const wrap = node('div', undefined, 'opinion-pair'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', `對「${about}」的看法`);
  const okOn = !!o && o.f === 'ok';
  const ok = node('button', undefined, `pair-ok${okOn ? ' on' : ''}`); ok.type = 'button';
  ok.append(node('span', okOn ? `✓ ${OK_TEXT}` : OK_TEXT));
  ok.setAttribute('aria-pressed', String(okOn));
  ok.setAttribute('aria-label', okOn ? `「${about}」已選合理，OK，再按一下取消` : `「${about}」合理，OK`);
  ok.addEventListener('click', onOk);
  wrap.append(ok, opinionButton(MORE_TEXT, onMore, !!o && !isOkOnly(o), about));
  return wrap;
}
// 按「合理，OK」：沒意見→記下；已是 OK→取消；原本有不同意見→換成 OK（可按復原找回）
function toggleOk(store, key, about, anchor) {
  const before = snapshot(); const o = store[key];
  if (o && o.f === 'ok') { delete store[key]; commit('已取消「合理，OK」', before, anchor); return; }
  store[key] = { f: 'ok' };
  commit(o ? `已改成：${about}合理，OK（原本的意見可按「復原」找回）` : `已記下：${about}合理，OK`, before, anchor);
}
function myNote(text, who = '我的意見') {
  const p = node('p', undefined, 'mine'); p.append(node('strong', `${readOnly ? '這位家人的意見' : who}：`), document.createTextNode(text));
  return p;
}
function sectionOpinion(kind, pid) {
  const key = `${kind}:${pid}`; const o = draft.c[key];
  const wrap = node('div', undefined, 'opinion-slot');
  const about = `${phaseById[pid].short || phaseById[pid].label}的${KINDS[kind].label}`;
  if (o && (readOnly || !isOkOnly(o))) wrap.append(myNote(opinionText(kind, o)));
  if (!readOnly) wrap.append(opinionPair(o, about, () => toggleOk(draft.c, key, about, `${kind}-${pid}`), () => openSheet({ kind, pid })));
  return wrap.children.length ? wrap : null;
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
  const row = node('article', undefined, `budget-row${item.added || item.opinion || needsAsk(item) ? ' ask' : ' no-ask'}`);
  if (item.removed) row.classList.add('is-removed');
  if (item.opinion || item.added) row.classList.add('is-changed');
  const head = node('div', undefined, 'budget-head');
  head.append(node('h4', item.name), node('span', item.added ? '家人新增' : item.status, item.added ? 'pill pill-new' : 'pill'));
  const money = node('p', undefined, 'money');
  if (item.locked) money.textContent = '不列入這份預算';
  else if (typeof item.amount !== 'number') money.textContent = item.added ? '金額未填' : '不列金額';
  else money.append(node('strong', wan(item.amount)), node('span', ntd(item.amount), 'ntd'));
  row.append(head, money);
  const base = baseItems[item.id];
  if (base && item.opinion && typeof base.amount === 'number' && item.amount !== base.amount) row.append(node('p', `原本 ${wan(base.amount)}`, 'was'));
  if (!item.locked && typeof item.amount === 'number' && !item.added) { const bar = rangeBar(item); if (bar) { bar.classList.add('more'); row.append(bar); } }
  row.append(node('p', `由誰負擔：${splitText(item.split)}`, 'who more'));
  if (item.note) row.append(node('p', item.note, 'note'));
  if (item.opinion && (readOnly || !isOkOnly(item.opinion))) row.append(myNote(opinionText('budget', item.opinion)));
  if (item.added && item.added.t) row.append(myNote(item.added.t));
  if (!readOnly && !item.locked) {
    if (item.added) row.append(opinionButton('修改', () => openSheet({ kind: 'add', pid: item.phase, id: item.id }), true, item.name));
    else row.append(opinionPair(item.opinion, item.name, () => toggleOk(draft.e, item.id, item.name, `budget-${item.phase}`), () => openSheet({ kind: 'budget', pid: item.phase, id: item.id })));
  }
  return row;
}

const sum = (costs, k) => costs.reduce((s, c) => s + (c[k] || 0), 0);
function renderCompare(p) {
  const c = p.compare;
  const box = node('div', undefined, 'compare'); box.id = `compare-${p.id}`;
  box.append(node('h3', c.title, 'block-title'));
  if (c.intro) box.append(node('p', c.intro, 'section-intro'));
  const options = c.options || [];
  const base = Math.min(...options.map(o => sum(o.costs || [], 'mid')));
  const grid = node('div', undefined, 'compare-grid');
  for (const o of options) {
    const costs = o.costs || [];
    const picked = draft.o[p.id] === o.id;
    const card = node('article', undefined, `compare-card${picked ? ' picked' : ''}`);
    card.append(node('h4', o.name), node('p', o.sub, 'compare-sub'));
    const mid = sum(costs, 'mid');
    const total = node('p', undefined, 'compare-total');
    total.append(node('span', '多出來約 '), node('strong', wan(mid)), node('span', `（${wan(sum(costs, 'low'))}–${wan(sum(costs, 'high'))}）`, 'ntd'));
    card.append(total);
    if (mid > base) card.append(node('p', `比最省的方案多 ${wan(mid - base)}`, 'compare-delta'));
    if (o.times && o.times.length) {
      const tl = node('ol', undefined, 'compare-times');
      for (const [t, what] of o.times) { const li = node('li'); li.append(node('span', t, 'event-time'), node('span', what)); tl.append(li); }
      card.append(node('p', '時間', 'prep-group'), tl);
    }
    const ul = node('ul', undefined, 'compare-costs');
    for (const it of costs) { const li = node('li'); li.append(node('span', it.item), node('strong', it.mid ? wan(it.mid) : '不增加')); ul.append(li); }
    card.append(node('p', '多出來的費用', 'prep-group'), ul);
    if (o.points) { const pts = node('ul', undefined, 'compare-points'); for (const t of o.points) pts.append(node('li', t)); card.append(pts); }
    if (!readOnly) {
      const btn = node('button', picked ? '✓ 我選這個（再按一下取消）' : '我比較傾向這個', 'button small secondary pick'); btn.type = 'button';
      btn.setAttribute('aria-pressed', String(picked));
      btn.addEventListener('click', () => {
        const before = snapshot();
        if (picked) delete draft.o[p.id]; else draft.o[p.id] = o.id;
        commit(picked ? '已取消選擇' : `已記下：比較傾向「${o.name}」`, before, `compare-${p.id}`);
      });
      card.append(btn);
    } else if (picked) card.append(node('p', '這位家人比較傾向這個', 'pill pill-new'));
    grid.append(card);
  }
  box.append(grid);
  if (c.conclusion) { const concl = node('p', undefined, 'tip'); concl.append(node('strong', '婚顧看法　'), document.createTextNode(c.conclusion)); box.append(concl); }
  if (c.unknown) box.append(node('p', c.unknown, 'planning-note'));
  if (c.sources) { const src = node('ul', undefined, 'fine-print'); for (const t of Object.values(c.sources)) src.append(node('li', `依據：${t}`)); box.append(src); }
  return box;
}

function renderPhases() {
  const host = $('phases'); host.replaceChildren();
  phases.forEach((p, idx) => {
    const sec = node('section', undefined, 'phase'); sec.id = `phase-${p.id}`; sec.setAttribute('aria-labelledby', `h-${p.id}`);
    const head = node('div', undefined, 'section-head');
    const hgroup = node('div'); hgroup.append(node('p', `0${idx + 2} / 第 ${idx + 1} 件事`, 'eyebrow'));
    const h2 = node('h2', p.label); h2.id = `h-${p.id}`; hgroup.append(h2);
    head.append(hgroup); if (p.status) head.append(node('span', p.status, 'pill'));
    sec.append(head);

    const card = node('div', undefined, `date-card wide${needsAsk(p) ? ' ask' : ' no-ask'}`); card.id = `date-${p.id}`;
    card.append(node('p', '日期', 'label'), node('h3', p.when, 'when-big'));
    if (p.candidates.length) { const chips = node('div', undefined, 'chips'); for (const c of p.candidates) chips.append(node('span', c, 'chip')); card.append(chips); }
    if (p.place) card.append(node('p', `地點：${p.place}`, 'detail'));
    if (p.why) card.append(node('p', p.why, 'detail more'));
    if (p.avoid) { const tip = node('p', undefined, 'tip more'); tip.append(node('strong', '婚顧提醒　'), document.createTextNode(p.avoid)); card.append(tip); }
    const dateOp = needsAsk(p) || draft.c[`date:${p.id}`] ? sectionOpinion('date', p.id) : null; if (dateOp) card.append(dateOp);
    sec.append(card);

    const grid = node('div', undefined, 'phase-grid');
    const left = node('details', undefined, 'fold'); left.id = `sched-${p.id}`; left.open = !focusMode;
    const ls = node('summary'); ls.append(node('h3', `當天行程（${p.schedule.length} 個步驟）`, 'block-title')); left.append(ls);
    const tl = node('ol', undefined, 'timeline');
    for (const s of p.schedule) {
      const li = node('li'); const body = node('div');
      body.append(node('h4', s.title), node('p', s.detail)); if (s.who) body.append(node('span', s.who, 'who'));
      li.append(node('span', s.time, 'event-time'), body); tl.append(li);
    }
    left.append(tl);
    if (p.scheduleNote) left.append(node('p', p.scheduleNote, 'planning-note'));
    const schedOp = sectionOpinion('sched', p.id); if (schedOp) left.append(schedOp);
    const right = node('details', undefined, 'prepare fold'); right.id = `prep-${p.id}`; right.open = !focusMode;
    const rs = node('summary'); rs.append(node('h3', `要準備的東西（${p.prepare.reduce((n, g) => n + (g.items || []).length, 0)} 項）`, 'block-title')); right.append(rs);
    for (const g of p.prepare) {
      right.append(node('h4', g.group, 'prep-group'));
      const ul = node('ul', undefined, 'checklist');
      for (const it of g.items || []) { const li = node('li'); li.append(node('span', it.text)); if (it.who) li.append(node('span', it.who, 'who')); ul.append(li); }
      right.append(ul);
    }
    const prepOp = sectionOpinion('prep', p.id); if (prepOp) right.append(prepOp);
    grid.append(left, right); sec.append(grid);
    if (p.compare) sec.append(renderCompare(p));

    const bud = node('div', undefined, 'phase-budget'); bud.id = `budget-${p.id}`;
    const bh = node('div', undefined, 'budget-title');
    bh.append(node('h3', '這一場的預算', 'block-title'));
    const now = phaseTotal(p.id), was = phaseTotal(p.id, false);
    const sub = node('p', undefined, 'subtotal'); sub.append(node('span', '小計 '), node('strong', wan(now)));
    if (now !== was) sub.append(node('span', `（原本 ${wan(was)}）`, 'was'));
    bh.append(sub); bud.append(bh);
    const list = node('div', undefined, 'budget-list');
    for (const item of itemsOf(p.id)) list.append(renderBudgetRow(item));
    if (!list.children.length && p.budgetNote) list.append(node('p', p.budgetNote, 'empty'));
    bud.append(list);
    const pending = p.budget.filter(i => needsAsk(i) && !draft.e[i.id]).length;
    const bok = draft.c[`bok:${p.id}`];
    if (!readOnly && (pending || bok)) {
      const label = p.budget.some(i => draft.e[i.id]) ? `其他 ${pending} 筆都${OK_TEXT}` : `這一場的花費都${OK_TEXT}`;
      const b = node('button', bok ? `✓ ${label}（再按一下取消）` : label, `button small secondary bok${bok ? ' on' : ''}`); b.type = 'button';
      b.setAttribute('aria-pressed', String(!!bok));
      b.addEventListener('click', () => { const before = snapshot(); if (bok) delete draft.c[`bok:${p.id}`]; else draft.c[`bok:${p.id}`] = { f: 'ok' }; commit(bok ? '已取消' : `已記下：${p.short || p.label}其他花費都${OK_TEXT}`, before, `budget-${p.id}`); });
      bud.append(b);
    } else if (readOnly && bok) bud.append(node('p', `這位家人表示：其他花費都${OK_TEXT}`, 'mine'));
    if (!readOnly) { const add = node('button', '＋ 我想加一項花費', 'button secondary add-item'); add.type = 'button'; add.addEventListener('click', () => openSheet({ kind: 'add', pid: p.id })); bud.append(add); }
    sec.append(bud);
    host.append(sec);
  });
}

function renderMonths() {
  const ol = $('month-list'); ol.replaceChildren();
  const cur = isoToday.slice(0, 7);
  for (const m of data.months || []) {
    const li = node('li', undefined, 'month');
    if (m.month === cur) { li.classList.add('current'); li.setAttribute('aria-current', 'date'); }
    if (m.month < cur) li.classList.add('past');
    const [y, mo] = m.month.split('-');
    const head = node('div', undefined, 'month-head'); head.append(node('span', `${y} 年`, 'year'), node('strong', `${Number(mo)} 月`));
    if (m.month === cur) head.append(node('span', '這個月', 'pill pill-new'));
    const body = node('div'); body.append(node('h3', m.focus));
    const ul = node('ul');
    for (const t of m.tasks || []) { const it = node('li'); it.append(node('span', t.text)); if (t.who) it.append(node('span', t.who, 'who')); ul.append(it); }
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
  const t1 = node('div', undefined, 'tile'); t1.append(node('p', after !== before ? (readOnly ? '照這位家人的意見' : '照您的意見') : '目前試算合計'), node('strong', wan(after)), node('span', ntd(after), 'ntd'));
  tiles.append(t1);
  if (after !== before) {
    const t2 = node('div', undefined, 'tile'); t2.append(node('p', '原本試算'), node('strong', wan(before)), node('span', ntd(before), 'ntd'));
    const t3 = node('div', undefined, 'tile accent'); t3.append(node('p', '差別'), node('strong', signedWan(after - before)));
    tiles.append(t2, t3);
  }
  host.append(tiles);
  const grid = node('div', undefined, 'summary-grid');
  const a = node('div'); a.append(node('h3', '依每一件事分', 'block-title'));
  a.append(bars(phases.map(p => ({ label: p.short || p.label, value: phaseTotal(p.id), was: phaseTotal(p.id, false) })), after));
  const pt = partyTotals(true), pw = partyTotals(false);
  const b = node('div'); b.append(node('h3', '依誰負擔分', 'block-title'));
  b.append(bars(PARTIES.map(k => ({ label: partyName(k), value: pt[k], was: pw[k] })), after));
  grid.append(a, b); host.append(grid);
  if (data.budgetNotes && data.budgetNotes.length) { const notes = node('ul', undefined, 'fine-print'); for (const t of data.budgetNotes) notes.append(node('li', t)); host.append(notes); }
}

// ---------- 傳意見區 ----------
function renderBasket() {
  const list = opinions();
  const ul = $('opinion-list'); ul.replaceChildren();
  if (!list.length) {
    const li = node('li', undefined, 'empty-line');
    li.append(document.createTextNode('還沒有意見。每一項旁邊，沒問題按 '), node('span', OK_TEXT, 'inline-chip ok-chip'), document.createTextNode('，有不同想法再按 '), node('span', MORE_TEXT, 'inline-chip'), document.createTextNode('。也可以直接在下面寫。'));
    ul.append(li);
  }
  list.forEach((o, i) => {
    const li = node('li', undefined, 'opinion-item');
    const body = node('div'); body.append(node('span', `${i + 1}. 【${o.phase.short || o.phase.label}】${o.label}`, 'opinion-label'), node('span', o.text, 'opinion-text'));
    li.append(body);
    if (!readOnly) {
      const acts = node('div', undefined, 'opinion-actions');
      const edit = node('button', '修改', 'text-button strong'); edit.type = 'button'; edit.addEventListener('click', o.open);
      const del = node('button', '刪除', 'text-button'); del.type = 'button';
      del.addEventListener('click', () => { const before = snapshot(); o.remove(); commit('已刪除這則意見', before, 'feedback'); });
      acts.append(edit, del); li.append(acts);
    }
    ul.append(li);
  });
  const count = list.length + (draft.m.trim() ? 1 : 0);
  $('opinion-count').textContent = list.length ? `共 ${list.length} 則` : '';
  const dock = $('dock');
  dock.hidden = readOnly || !count;
  $('dock-text').textContent = `已記下 ${count} 則意見，還沒${ENDPOINT ? '送出' : '傳出'}`;
  if (count) $('sent-panel').hidden = true;
  const text = feedbackText();
  $('line-button').href = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  const mail = data.feedback && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(data.feedback.email || '') ? data.feedback.email : '';
  $('email-button').hidden = !mail;
  if (mail) $('email-button').href = `mailto:${mail}?subject=${encodeURIComponent(`婚禮小冊的意見${draft.n.trim() ? `：${draft.n.trim()}` : ''}`)}&body=${encodeURIComponent(text)}`;
  $('send-area').classList.toggle('ready', !!count);
}

function renderQuestions() {
  const ol = $('questions'); ol.replaceChildren();
  // 「兩家一起商量」排前面，再來是「新人決定」；同一類保留 content.js 的順序
  const list = questionList().map((x, i) => ({ ...x, i })).sort((a, b) => (a.scope === 'couple') - (b.scope === 'couple') || a.i - b.i);
  for (const { key, q, scope, choices } of list) {
    const li = node('li', undefined, 'question'); li.id = `q-${key}`;
    if (scope) li.append(node('span', SCOPES[scope], `pill scope scope-${scope}`));
    li.append(node('span', q, 'question-text'));
    const o = draft.q[key];
    if (choices.length) {
      const row = node('div', undefined, 'q-choices'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', `「${q}」的選項`);
      for (const c of choices) {
        const on = !!o && o.c === c;
        const b = node('button', on ? `✓ ${c}` : c, `q-choice${on ? ' on' : ''}`); b.type = 'button'; b.disabled = readOnly;
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => {
          const before = snapshot(); const cur = draft.q[key];
          if (on) { if (cur.t) delete cur.c; else delete draft.q[key]; commit('已取消這個選擇', before, `q-${key}`); return; }
          draft.q[key] = { ...(cur || {}), q: q.slice(0, 200), c };
          commit(`已記下：${c}`, before, `q-${key}`);
        });
        row.append(b);
      }
      li.append(row);
    }
    if (o && (o.t || readOnly)) li.append(myNote([o.c, o.t].filter(Boolean).join('——'), '我的回答'));
    if (!readOnly) li.append(opinionButton(choices.length ? '想多說一點' : KINDS.q.button, () => openSheet({ kind: 'q', key, q, choices }), !!(o && o.t), q, choices.length ? '改我的補充' : '改我的回答'));
    ol.append(li);
  }
  // 已回答、但題目已被改寫或移除的回答，仍保留在「傳意見」清單裡
}

// ---------- 精簡模式：只看要表態的地方 ----------
let focusMode = false;
try { focusMode = !readOnly && localStorage.getItem('alive-wedding-focus') === '1'; } catch (_) { /* 忽略 */ }
// 已送出的表態點記在這支手機，送出後進度不會歸零
let sentKeys = new Set();
try { sentKeys = new Set(JSON.parse(localStorage.getItem('alive-wedding-sent') || '[]')); } catch (_) { /* 忽略 */ }
function askTargets() {
  const t = [];
  const add = (key, done, href) => t.push({ key, done: done || (!readOnly && sentKeys.has(key)), href });
  for (const p of phases) {
    if (needsAsk(p)) add(`date:${p.id}`, !!draft.c[`date:${p.id}`], `#date-${p.id}`);
    if (p.compare) add(`compare:${p.id}`, !!draft.o[p.id], `#compare-${p.id}`);
    // 每一場的預算算一個表態點：每筆都表態過，或按了「其他花費都沒意見」
    const asks = p.budget.filter(needsAsk);
    if (asks.length) add(`budget:${p.id}`, !!draft.c[`bok:${p.id}`] || asks.every(i => draft.e[i.id]), `#budget-${p.id}`);
  }
  for (const { key } of questionList()) add(`q:${key}`, !!draft.q[key], `#q-${key}`);
  return t;
}
function renderFocus() {
  document.body.classList.toggle('focus-mode', focusMode);
  for (const id of ['focus-toggle', 'focus-start']) { const b = $(id); if (!b) continue; b.setAttribute('aria-pressed', String(focusMode)); }
  $('focus-toggle').textContent = focusMode ? '看完整內容' : '只看要表態的';
  $('focus-start').textContent = focusMode ? '回到完整內容' : '只看需要我表態的地方';
  const t = askTargets(); const done = t.filter(x => x.done).length;
  const bar = $('focus-bar'); bar.hidden = !focusMode;
  $('focus-progress-text').textContent = done === t.length ? `${t.length} 個地方都表態了，謝謝您！到最下面傳給新人吧。` : `共 ${t.length} 個地方等您表態，已完成 ${done} 個`;
  $('focus-progress-fill').style.width = `${t.length ? Math.round(done / t.length * 100) : 0}%`;
  const next = t.find(x => !x.done); $('focus-next').hidden = !next; if (next) $('focus-next').href = next.href;
}
function setFocus(on) {
  focusMode = on;
  try { localStorage.setItem('alive-wedding-focus', on ? '1' : ''); } catch (_) { /* 忽略 */ }
  renderAll();
  (on ? $('focus-bar') : $('overview')).scrollIntoView({ block: 'start' });
}

function renderAll() { renderNext(); renderRoadmap(); renderPhases(); renderSummary(); renderQuestions(); renderBasket(); renderFocus(); }

// ---------- 復原與提示 ----------
const snapshot = () => JSON.stringify(draft);
let toastTimer;
function toast(message, before) {
  const t = $('toast'); $('toast-text').textContent = message;
  const undo = $('toast-undo'); undo.hidden = !before;
  undo.onclick = () => { draft = sanitize(JSON.parse(before)); save(); renderAll(); toast('已復原'); };
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}
function commit(message, before, focusId) {
  save(); renderAll(); toast(message, before);
  if (focusId) document.getElementById(focusId)?.scrollIntoView({ block: 'nearest' });
}

// ---------- 意見視窗 ----------
const sheet = $('sheet');
let ctx = null; // { kind, pid, id }
function radioGroup(host, name, options, value, onChange) {
  host.replaceChildren();
  for (const [v, label] of options) {
    const lab = node('label', undefined, 'choice');
    const inp = node('input'); inp.type = 'radio'; inp.name = name; inp.value = v; inp.checked = v === value;
    inp.addEventListener('change', () => onChange(v));
    lab.append(inp, node('span', label)); host.append(lab);
  }
}
const parseAmount = v => { const s = String(v).replace(/[^\d]/g, ''); return s ? Math.min(Number(s), 1e8) : undefined; };
const stepOf = n => n >= 100000 ? 10000 : n >= 10000 ? 1000 : 500;
// 金額提示：預算項目同時顯示和原本差多少，長輩一眼看得出是加還是減
function amountHint(n) {
  if (n === undefined) return '不確定可以不填';
  const base = ctx && ctx.kind === 'budget' && baseItems[ctx.id] ? baseItems[ctx.id].amount : undefined;
  return `＝ ${wan(n)}` + (typeof base === 'number' && n !== base ? `（比原本${signedWan(n - base)}）` : '');
}
function setAmount(n) { $('sheet-amount-input').value = n === undefined ? '' : n.toLocaleString('zh-TW'); $('sheet-amount-hint').textContent = amountHint(n); }
function syncSheet() {
  const f = ctx.f;
  const showAmount = ctx.kind === 'add' || (ctx.kind === 'budget' && (f === 'less' || f === 'more'));
  const showWho = ctx.kind === 'add' || (ctx.kind === 'budget' && f === 'who');
  $('sheet-amount').hidden = !showAmount;
  $('sheet-who').hidden = !showWho;
  $('sheet-error').textContent = '';
}
function openSheet(target) {
  if (readOnly) return;
  const p = phaseById[target.pid];
  ctx = { ...target };
  let existing = null; let item = null;
  if (target.kind === 'budget') { item = baseItems[target.id]; existing = draft.e[target.id]; }
  else if (target.kind === 'add') existing = target.id ? draft.ad.find(a => a.id === target.id) : null;
  else if (target.kind === 'q') existing = draft.q[target.key] && { ...draft.q[target.key], f: draft.q[target.key].c };
  else existing = draft.c[`${target.kind}:${target.pid}`];
  ctx.f = existing && existing.f !== 'ok' ? existing.f : undefined; ctx.w = existing && existing.w;

  $('sheet-title').textContent = target.kind === 'add' ? '我想加一項花費' : target.kind === 'q' ? KINDS.q.title : MORE_TEXT;
  const where = [p ? p.label : '一起商量'];
  if (item) where.push(item.name, typeof item.amount === 'number' ? `目前 ${wan(item.amount)}` : '');
  else if (target.kind === 'date') where.push(p.when);
  else if (target.kind === 'q') where.splice(0, 1, target.q);
  $('sheet-context').textContent = where.filter(Boolean).join('・');
  $('sheet-name-field').hidden = target.kind !== 'add';
  $('sheet-name').value = target.kind === 'add' && existing ? existing.nm : '';
  const qChoices = target.kind === 'q' ? (target.choices || []).map(c => [c, c]) : [];
  $('sheet-choices').hidden = target.kind === 'add' || (target.kind === 'q' && !qChoices.length);
  if (qChoices.length) radioGroup($('sheet-choice-list'), 'feel', qChoices, ctx.f, v => { ctx.f = v; });
  if (target.kind !== 'add' && target.kind !== 'q') radioGroup($('sheet-choice-list'), 'feel', KINDS[target.kind].choices.filter(c => c[0] !== 'ok'), ctx.f, v => { ctx.f = v; if ((v === 'less' || v === 'more') && item && $('sheet-amount-input').value === '' && typeof item.amount === 'number') setAmount(item.amount); syncSheet(); });
  radioGroup($('sheet-who-list'), 'who', WHO.map(w => [w[0], w[1]]), ctx.w, v => { ctx.w = v; });
  setAmount(existing && existing.a !== undefined ? existing.a : undefined);
  const presets = $('sheet-presets'); presets.replaceChildren();
  if (item && typeof item.low === 'number' && item.high > item.low) {
    for (const [label, v] of [['低標', item.low], ['原本', item.amount], ['高標', item.high]]) {
      const b = node('button', `${label} ${wan(v)}`, 'chip-button'); b.type = 'button'; b.addEventListener('click', () => setAmount(v)); presets.append(b);
    }
  }
  $('sheet-text').value = existing ? existing.t || '' : '';
  $('sheet-text').placeholder = target.kind === 'add' ? '例如：長輩休息室的下午茶' : KINDS[target.kind].placeholder || '想到什麼都可以寫';
  $('sheet-delete').hidden = !existing;
  syncSheet();
  if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
  (target.kind === 'add' ? $('sheet-name') : target.kind === 'q' ? $('sheet-text') : sheet.querySelector('input[name=feel]')).focus();
}
function closeSheet() { if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open'); }
$('sheet-amount-input').addEventListener('input', () => { $('sheet-amount-hint').textContent = amountHint(parseAmount($('sheet-amount-input').value)); });
$('sheet-amount-input').addEventListener('blur', () => setAmount(parseAmount($('sheet-amount-input').value)));
for (const [id, dir] of [['sheet-minus', -1], ['sheet-plus', 1]]) $(id).addEventListener('click', () => {
  const n = parseAmount($('sheet-amount-input').value) || 0;
  setAmount(Math.max(0, n + dir * stepOf(dir < 0 ? Math.max(n - 1, 0) : n)));
});
$('sheet-close').addEventListener('click', closeSheet);
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet(); });
$('sheet-delete').addEventListener('click', () => {
  const before = snapshot();
  if (ctx.kind === 'budget') delete draft.e[ctx.id];
  else if (ctx.kind === 'add') draft.ad = draft.ad.filter(a => a.id !== ctx.id);
  else if (ctx.kind === 'q') delete draft.q[ctx.key];
  else delete draft.c[`${ctx.kind}:${ctx.pid}`];
  closeSheet(); commit('已刪除這則意見', before);
});
$('sheet-form').addEventListener('submit', ev => {
  ev.preventDefault();
  const text = $('sheet-text').value.trim().slice(0, 500);
  const amount = parseAmount($('sheet-amount-input').value);
  const before = snapshot();
  let anchor;
  if (ctx.kind === 'add') {
    const name = $('sheet-name').value.trim().slice(0, 40);
    if (!name) { $('sheet-error').textContent = '請寫一下是什麼花費，例如「長輩下午茶」。'; $('sheet-name').focus(); return; }
    const x = { id: ctx.id || `n${Date.now().toString(36)}`, p: ctx.pid, nm: name };
    if (amount !== undefined) x.a = amount; if (ctx.w) x.w = ctx.w; if (text) x.t = text;
    const i = draft.ad.findIndex(a => a.id === x.id); if (i >= 0) draft.ad[i] = x; else draft.ad.push(x);
    anchor = `budget-${ctx.pid}`;
  } else if (ctx.kind === 'q') {
    if (!text && !ctx.f) { $('sheet-error').textContent = (ctx.choices || []).length ? '請點一個選項，或寫幾個字都可以。' : '請寫幾個字，或按鍵盤上的麥克風用說的。'; $('sheet-text').focus(); return; }
    const x = { q: ctx.q.slice(0, 200) }; if (ctx.f) x.c = ctx.f; if (text) x.t = text;
    draft.q[ctx.key] = x; anchor = `q-${ctx.key}`;
  } else {
    if (!ctx.f && !text) { $('sheet-error').textContent = '請點一個看法，或寫幾個字都可以。'; return; }
    const x = {}; if (ctx.f) x.f = ctx.f; if (text) x.t = text;
    if (ctx.kind === 'budget') {
      const base = baseItems[ctx.id];
      if ((x.f === 'less' || x.f === 'more') && amount !== undefined && amount !== base.amount) {
        x.a = amount;
        // 以填的金額為準：點「太多」卻填了比原本高的數字（或相反），看法跟著金額改，避免試算表出現矛盾
        if (typeof base.amount === 'number') x.f = amount < base.amount ? 'less' : 'more';
      }
      if (x.f === 'who' && ctx.w) x.w = ctx.w;
      draft.e[ctx.id] = x; anchor = `budget-${ctx.pid}`;
    } else { draft.c[`${ctx.kind}:${ctx.pid}`] = x; anchor = `${ctx.kind}-${ctx.pid}`; }
  }
  closeSheet(); commit('已記下您的意見（還沒傳出）', before, anchor);
});

// ---------- 送出 ----------
$('name').value = draft.n; $('message').value = draft.m;
$('name').addEventListener('input', () => { draft.n = $('name').value.slice(0, 40); save(); renderBasket(); });
$('message').addEventListener('input', () => { draft.m = $('message').value.slice(0, 2000); save(); renderBasket(); });
function nothingToSend(ev) {
  if (opinions().length || draft.m.trim()) return false;
  ev.preventDefault();
  $('feedback-status').textContent = '還沒有任何意見。可以先在上面按「合理，OK」或「我有意見」，或在「其他想說的話」寫下來。';
  return true;
}
$('line-button').addEventListener('click', ev => { if (!nothingToSend(ev)) $('feedback-status').textContent = '正在開啟 LINE：請選新人（或家族群組），再按「傳送」。傳完後，可以按最下面的「清空，重新開始」。'; });
$('email-button').addEventListener('click', ev => { if (!nothingToSend(ev)) $('feedback-status').textContent = '正在開啟郵件程式，請按「寄出」才會送到。沒有開啟的話，請改用 LINE 或複製文字。'; });
$('copy-button').addEventListener('click', async ev => {
  if (nothingToSend(ev)) return;
  const text = feedbackText();
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    $('manual-copy').hidden = true;
    $('feedback-status').textContent = '已複製，還沒有傳出。請到 LINE 或訊息裡「貼上」，傳給新人。';
  } catch (_) {
    $('manual-copy').hidden = false; $('copy-text').value = text; $('copy-text').focus(); $('copy-text').select();
    $('feedback-status').textContent = '無法自動複製，請長按下方文字、全選後複製。還沒有傳出。';
  }
});
$('reset-draft').addEventListener('click', () => {
  if (!confirm('確定要清空這支手機上的所有意見嗎？（已經傳出的不受影響）')) return;
  const before = snapshot();
  draft = { ...emptyDraft(), n: draft.n }; save(); $('message').value = '';
  $('feedback-status').textContent = '';
  renderAll(); toast('已清空，可以重新開始', before);
});
$('dock-go').addEventListener('click', () => { $('feedback').scrollIntoView({ block: 'start' }); $('feedback-title').focus({ preventScroll: true }); });
$('dock-go').textContent = ENDPOINT ? '去送出' : '傳給新人';

// ---------- 直接送進 Google 試算表 ----------
function newId() { const a = new Uint8Array(10); crypto.getRandomValues(a); return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 20); }
if (ENDPOINT) {
  $('sheet-button').hidden = false; $('sheet-help').hidden = false;
  $('other-actions').prepend($('line-button'));
  $('line-primary').hidden = true;
  $('other-ways-summary').textContent = '送不出去？改用 LINE 或其他方式';
  $('howto-send-title').textContent = '送出給新人';
  $('howto-send-text').textContent = '全部看完，到最下面按「送出給新人」，一按就送到。';
  $('howto-privacy').textContent = '意見會先記在您的手機裡；按「送出給新人」後，才會存進新人的 Google 試算表，只有新人看得到，也不會改到這一頁。';
  $('sheet-help').textContent = '按一下就會存進新人的 Google 試算表（只有新人看得到），不用開 LINE。';
}
async function sendToSheet() {
  const list = opinions();
  if (!list.length && !draft.m.trim()) { $('feedback-status').textContent = '還沒有任何意見。可以先在上面按「合理，OK」或「我有意見」，或在「其他想說的話」寫下來。'; return; }
  if (!draft.sid) { draft.sid = newId(); save(); }
  const payload = {
    v: 1, id: draft.sid, sentAt: new Date().toISOString(), name: draft.n.trim(), version: data.version || '', message: draft.m.trim(),
    before: grandTotal(false), after: grandTotal(true), url: proposalUrl(),
    opinions: list.map(o => o.rec), raw: draft, hp: $('hp').value
  };
  const btn = $('sheet-button'); btn.disabled = true; btn.textContent = '送出中，請稍等…';
  $('feedback-status').textContent = '';
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    // 用 text/plain 避免瀏覽器先送 CORS 預檢；Apps Script 會轉址後回傳 JSON
    const res = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(payload), signal: ctrl.signal, redirect: 'follow' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'failed');
    const sentCount = list.length + (draft.m.trim() ? 1 : 0);
    for (const x of askTargets()) if (x.done) sentKeys.add(x.key);
    try { localStorage.setItem('alive-wedding-sent', JSON.stringify([...sentKeys])); } catch (_) { /* 忽略 */ }
    draft = { ...emptyDraft(), n: draft.n }; save(); $('message').value = '';
    renderAll();
    const time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    $('sent-text').textContent = `${time} 送出 ${sentCount} 則意見。新人會整理後和兩家討論。還有想到的，可以繼續按「我有意見」再送一次。`;
    $('line-notify').href = `https://line.me/R/share?text=${encodeURIComponent(`我在婚禮小冊留了 ${sentCount} 則意見，已經送到意見表了。${draft.n.trim() ? `——${draft.n.trim()}` : ''}`)}`;
    $('sent-panel').hidden = false; $('sent-panel').focus();
  } catch (_) {
    $('feedback-status').textContent = '沒有送出去，可能是網路不穩。請再按一次「送出給新人」；還是不行，請打開下面的「改用 LINE」。';
    $('other-ways').open = true;
  } finally {
    clearTimeout(timer); btn.disabled = false; btn.textContent = '送出給新人';
  }
}
$('sheet-button').addEventListener('click', sendToSheet);
for (const id of ['focus-toggle', 'focus-start']) $(id).addEventListener('click', () => setFocus(!focusMode));
$('focus-exit').addEventListener('click', () => setFocus(false));

// ---------- 新人點開長輩傳來的連結 ----------
if (readOnly) {
  document.body.classList.add('read-only');
  $('focus-toggle').hidden = true;
  $('proposal-banner').hidden = false;
  $('proposal-title').textContent = `${draft.n.trim() || '家人'}的意見（尚未採納）`;
  const when = typeof proposal.t === 'string' ? proposal.t.slice(0, 10) : '';
  const ver = typeof proposal.ver === 'string' ? proposal.ver.slice(0, 40) : '';
  $('proposal-meta').textContent = `${when ? `${when} 傳來・` : ''}看的是「${ver || '未知版本'}」。底色標示的地方就是這位家人的意見。${ver && ver !== data.version ? '（正式版本已更新，部分內容可能不同。）' : ''}`;
  $('feedback-title').textContent = '這位家人的意見';
  $('name').disabled = true; $('message').disabled = true;
  $('copy-json').addEventListener('click', async () => {
    const json = JSON.stringify({ from: draft.n, date: when, baseVersion: ver, message: draft.m, budget: draft.e, added: draft.ad, sections: draft.c, prefer: draft.o, readable: opinions().map(o => `【${o.phase.short}】${o.label}：${o.text}`) }, null, 2);
    try { await navigator.clipboard.writeText(json); $('copy-json').textContent = '已複製'; }
    catch (_) { $('manual-copy').hidden = false; $('copy-text').value = json; $('copy-text').select(); $('feedback').scrollIntoView(); }
  });
}

$('font').addEventListener('click', () => {
  const large = document.documentElement.classList.toggle('large-text');
  $('font').setAttribute('aria-pressed', String(large));
  $('font').textContent = large ? '恢復原本字級' : '字再大一點';
  try { localStorage.setItem('alive-wedding-large', large ? '1' : ''); } catch (_) { /* 忽略 */ }
});
try { if (localStorage.getItem('alive-wedding-large')) $('font').click(); } catch (_) { /* 忽略 */ }
$('print').addEventListener('click', () => window.print());


for (const item of data.decisions || []) {
  const row = node('article', undefined, 'decision'); const time = node('time', item.date); time.dateTime = item.date;
  row.append(time, node('h3', item.title), node('p', item.detail)); $('decisions').append(row);
}
for (const s of data.sources || []) { const li = node('li'); const a = node('a', s.title); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); $('sources').append(li); }
renderMonths();
renderAll();
