'use strict';
const data = window.WEDDING;
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
document.title = data.title;
$('version').textContent = data.version;
$('updated').textContent = `更新日期：${data.updated.replaceAll('-', ' / ')}`;
$('notice').textContent = data.notice;
for (const item of data.dates) {
  const card = node('article', undefined, 'date-card');
  card.append(node('p', item.label), node('h3', item.value), node('p', item.detail, 'detail'), node('span', item.status, 'pill'));
  $('date-cards').append(card);
}
function renderEvent(event) {
  $('event-intro').textContent = event.intro;
  $('timeline').replaceChildren();
  for (const item of event.steps) {
    const li = node('li');
    const time = node('span', item.time, 'event-time');
    const body = node('div');
    body.append(node('h3', item.title), node('p', item.detail), node('span', `建議協助：${item.who}`, 'who'));
    li.append(time, body); $('timeline').append(li);
  }
  for (const button of $('event-buttons').children) button.setAttribute('aria-pressed', String(button.dataset.event === event.id));
}
for (const event of data.events) {
  const button = node('button', event.label);
  button.type = 'button'; button.dataset.event = event.id;
  button.setAttribute('aria-controls', 'timeline');
  button.addEventListener('click', () => renderEvent(event));
  $('event-buttons').append(button);
}
renderEvent(data.events[0]);
for (const item of data.tasks) {
  const row = node('article', undefined, 'task');
  const body = node('div'); body.append(node('h3', item.title), node('p', item.detail), node('span', `建議分工：${item.owner}`, 'who'));
  row.append(node('p', item.when, 'when'), body, node('span', item.status, 'pill'));
  $('task-list').append(row);
}
for (const q of data.questions) $('questions').append(node('li', q));
if (!data.decisions.length) $('decisions').append(node('p', '目前還在收集想法，尚無定案公告。每次確認後，這裡會寫下日期、調整內容與原因。', 'empty'));
for (const item of data.decisions) {
  const row = node('article', undefined, 'decision'); const time = node('time', item.date); time.dateTime = item.date;
  row.append(time, node('h3', item.title), node('p', item.detail)); $('decisions').append(row);
}
$('font').addEventListener('click', () => {
  const large = document.documentElement.classList.toggle('large-text');
  $('font').setAttribute('aria-pressed', String(large));
  $('font').textContent = large ? '恢復原本字級' : '字再大一點';
});
$('print').addEventListener('click', () => window.print());
const email = typeof data.feedback.email === 'string' ? data.feedback.email.trim() : '';
const hasEmail = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email);
let formUrl;
try { const url = new URL(data.feedback.formUrl); if (url.protocol === 'https:') formUrl = url.href; } catch (_) { /* 尚未設定表單 */ }
$('email-button').hidden = !hasEmail;
if (formUrl) { $('form-link').href = formUrl; $('form-link').hidden = false; }
$('feedback-help').textContent = hasEmail
  ? '按 Email 會開啟您的郵件程式；請在郵件程式按「寄出」才會送達新人。也可複製後傳給新人。'
  : formUrl ? '可直接開啟回饋表單填寫；本頁輸入的文字不會自動帶入，請先複製再貼到表單。'
  : '回饋收件管道尚未設定。請先複製想法，再貼到 LINE 或其他訊息傳給新人；這一頁不會自動送出或儲存。';
function feedbackText() {
  return `婚禮安排建議\n稱呼：${$('name').value.trim() || '未填寫'}\n主題：${$('topic').value}\n參考版本：${data.version}（${data.updated}）\n\n${$('message').value.trim()}\n\n此為建議，請新人討論後確認是否採納。`;
}
function validFeedback() {
  $('message').setCustomValidity($('message').value.trim() ? '' : '請寫下您的想法。');
  return $('feedback-form').reportValidity();
}
$('message').addEventListener('input', () => $('message').setCustomValidity(''));
$('feedback-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!validFeedback()) return;
  if (!hasEmail) { $('feedback-status').textContent = '尚未設定收件信箱，請使用複製功能傳給新人。'; return; }
  window.location.href = `mailto:${email}?subject=${encodeURIComponent('婚禮安排建議：' + $('topic').value)}&body=${encodeURIComponent(feedbackText())}`;
  $('feedback-status').textContent = '正在嘗試開啟郵件程式。請確認收件人並按「寄出」；若沒有開啟，請改用複製功能。';
});
$('copy-button').addEventListener('click', async () => {
  if (!validFeedback()) return;
  const text = feedbackText();
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    $('manual-copy').hidden = true;
    $('feedback-status').textContent = '已複製，還沒有傳送。請貼到 LINE 或訊息中傳給新人。';
  } catch (_) {
    $('manual-copy').hidden = false; $('copy-text').value = text; $('copy-text').focus(); $('copy-text').select();
    $('feedback-status').textContent = '瀏覽器無法自動複製，請複製下方文字後傳給新人。尚未傳送。';
  }
});
