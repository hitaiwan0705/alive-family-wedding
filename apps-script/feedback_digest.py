#!/usr/bin/env python3
"""婚禮小冊・長輩意見摘要（給 Codex 用，只需 Python 標準庫）

讀取 Google 試算表收件程式（apps-script/Code.gs）裡的意見，整理成給新人看的 Markdown 摘要；
新人決定後，再用 mark 指令回寫「處理狀態」。

環境變數：
  ALIVE_FEEDBACK_ENDPOINT  Apps Script 網頁應用程式網址（同 config.js 的 sheetEndpoint）
  ALIVE_FEEDBACK_TOKEN     setup() 產生的讀取用 token（不可提交到任何儲存庫）

用法：
  python3 feedback_digest.py digest [--status 待處理|all] [--since 2026-10-15] [--out 摘要.md]
  python3 feedback_digest.py digest --from-json 意見.json     # 離線：用已下載的 JSON
  python3 feedback_digest.py mark <意見編號> <待處理|採納|部分採納|不採納|已回覆> [處理說明]
"""
import argparse, json, os, statistics, sys, urllib.parse, urllib.request
from collections import Counter, OrderedDict
from datetime import datetime

STATUSES = ['待處理', '採納', '部分採納', '不採納', '已回覆']
PHASE_ORDER = ['提親', '結婚登記', '登記', '訂婚', '訂婚（文定）', '結婚', '迎娶與台北婚宴', '一起商量']
KIND_ORDER = ['日期', '方案傾向', '預算', '新增花費', '其他花費都沒意見', '當天行程', '準備清單', '一起商量']


def env(name):
    v = os.environ.get(name, '').strip()
    if not v:
        sys.exit(f'缺少環境變數 {name}（見 apps-script/CODEX.md）')
    return v


def http_get(params):
    url = env('ALIVE_FEEDBACK_ENDPOINT') + '?' + urllib.parse.urlencode({**params, 'token': env('ALIVE_FEEDBACK_TOKEN')})
    with urllib.request.urlopen(url, timeout=60) as r:  # Apps Script 會 302 轉址，urllib 會自動跟隨
        data = json.loads(r.read().decode('utf-8'))
    if not data.get('ok'):
        sys.exit(f'讀取失敗：{data.get("error")}（token 是否正確？）')
    return data['rows']


def http_post(payload):
    req = urllib.request.Request(env('ALIVE_FEEDBACK_ENDPOINT'), data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def wan(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return ''
    return f'{n / 10000:g} 萬' if abs(n) >= 10000 else f'{n:,.0f} 元'


def num(v):
    try:
        return float(v) if v not in ('', None) else None
    except (TypeError, ValueError):
        return None


def phase_key(name):
    return (PHASE_ORDER.index(name) if name in PHASE_ORDER else len(PHASE_ORDER), name)


def kind_key(name):
    return (KIND_ORDER.index(name) if name in KIND_ORDER else len(KIND_ORDER), name)


def build_digest(opinions, submissions, status_label, since):
    today = datetime.now().strftime('%Y-%m-%d')
    people = sorted({o.get('稱呼') or '（未留名）' for o in opinions})
    out = [f'# 長輩意見摘要（{today}）', '']
    scope = f'處理狀態「{status_label}」' + (f'、{since} 之後送出' if since else '')
    out.append(f'範圍：{scope}。共 **{len(opinions)} 則**意見，來自 {len(people)} 位：{"、".join(people) or "（無）"}。')
    out.append('')
    out.append('> 這是整理，不是決定。採納與否由新人和兩家討論；決定後再回寫處理狀態（見文末）。')
    out.append('')
    if not opinions and not any((s.get('其他想說的話') or '').strip() for s in submissions):
        out.append('目前沒有需要處理的意見。')
        return '\n'.join(out) + '\n'

    # 重點：多人有意見、或看法分歧的項目
    groups = OrderedDict()
    for o in sorted(opinions, key=lambda o: (phase_key(o.get('場合', '')), kind_key(o.get('類型', '')), o.get('項目名稱', ''))):
        key = (o.get('場合', ''), o.get('類型', ''), o.get('項目代碼', ''), o.get('項目名稱', ''))
        groups.setdefault(key, []).append(o)
    hot = []
    for (phase, kind, _code, name), items in groups.items():
        views = Counter(i.get('看法') or '（只寫文字）' for i in items)
        if len(items) >= 2:
            hot.append(f'- 【{phase}】{name}：{len(items)} 則，' + ('看法一致' if len(views) == 1 else '看法分歧') +
                       '（' + '、'.join(f'{v} ×{c}' for v, c in views.most_common()) + '）')
    if hot:
        out += ['## 先看這幾項（2 則以上）', ''] + hot + ['']

    current_phase = None
    for (phase, kind, code, name), items in groups.items():
        if phase != current_phase:
            out += [f'## {phase or "（未分類）"}', '']
            current_phase = phase
        label = f'{name}（{kind}' + (f'・{code}' if code and not code.startswith(('q:', 'date:', 'compare:', 'bok:')) else '') + '）'
        out.append(f'### {label}')
        views = Counter(i.get('看法') or '（只寫文字）' for i in items)
        names = sorted({i.get('稱呼') or '（未留名）' for i in items})
        verdict = '只有一位' if len(items) == 1 else ('看法一致' if len(views) == 1 else '看法分歧')
        if kind == '一起商量':
            out.append(f'- {len(names)} 位回答')
        else:
            out.append(f'- 看法：' + '、'.join(f'{v} ×{c}' for v, c in views.most_common()) + f'（{len(names)} 位，{verdict}）')
        base = next((num(i.get('原本金額')) for i in items if num(i.get('原本金額')) is not None), None)
        sugg = [(num(i.get('建議金額')), i.get('稱呼') or '（未留名）') for i in items if num(i.get('建議金額')) is not None]
        if sugg:
            vals = [v for v, _ in sugg]
            rng = wan(min(vals)) if min(vals) == max(vals) else f'{wan(min(vals))}–{wan(max(vals))}'
            out.append(f'- 建議金額：' + '、'.join(f'{wan(v)}（{who}）' for v, who in sugg) +
                       f'；範圍 {rng}，中位數 {wan(statistics.median(vals))}' + (f'；原本 {wan(base)}' if base is not None else ''))
        whos = [(i.get('由誰負擔'), i.get('稱呼') or '（未留名）') for i in items if i.get('由誰負擔')]
        if whos:
            out.append('- 由誰負擔：' + '、'.join(f'{w}（{who}）' for w, who in whos))
        for i in items:
            if (i.get('文字') or '').strip():
                out.append(f'  > {i.get("稱呼") or "（未留名）"}：{i["文字"].strip()}')
        out.append(f'- 意見編號：' + '、'.join(i.get('意見編號', '') for i in items))
        out.append('')

    messages = [s for s in submissions if (s.get('其他想說的話') or '').strip()]
    if messages:
        out += ['## 其他想說的話', '']
        for s in messages:
            out.append(f'> {s.get("稱呼") or "（未留名）"}（{str(s.get("送出時間", ""))[:10]}）：{s["其他想說的話"].strip()}')
        out.append('')

    out += ['## 給新人的決定清單', '']
    for (phase, kind, _code, name), items in groups.items():
        ids = ' '.join(i.get('意見編號', '') for i in items)
        out.append(f'- [ ] 【{phase}】{name}：採納／部分採納／不採納／已回覆　（{ids}）')
    out += ['', '決定後回寫（每則意見一行）：', '', '```bash',
            'python3 apps-script/feedback_digest.py mark <意見編號> 採納 "已改進 content.js 版本 05"', '```', '']
    return '\n'.join(out)


def cmd_digest(a):
    if a.from_json:
        with open(a.from_json, encoding='utf-8') as f:
            data = json.load(f)
        opinions = data.get('opinions', data.get('rows', data if isinstance(data, list) else []))
        submissions = data.get('submissions', []) if isinstance(data, dict) else []
        if a.status != 'all':
            opinions = [o for o in opinions if o.get('處理狀態') == a.status]
    else:
        params = {'view': 'opinions'}
        if a.status != 'all':
            params['status'] = a.status
        if a.since:
            params['since'] = a.since
        opinions = http_get(params)
        submissions = http_get({'view': 'submissions', **({'since': a.since} if a.since else {})})
        ids = {o.get('送出編號') for o in opinions}
        submissions = [s for s in submissions if s.get('送出編號') in ids or a.status == 'all']
    text = build_digest(opinions, submissions, '全部' if a.status == 'all' else a.status, a.since)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f'已寫入 {a.out}（{len(opinions)} 則）')
    else:
        sys.stdout.write(text)


def cmd_mark(a):
    if a.status not in STATUSES:
        sys.exit('處理狀態只能是：' + '、'.join(STATUSES))
    res = http_post({'action': 'mark', 'token': env('ALIVE_FEEDBACK_TOKEN'), 'opinionId': a.opinion_id, 'status': a.status, 'note': a.note or ''})
    print('已回寫' if res.get('ok') else f'回寫失敗：{res.get("error")}')
    if not res.get('ok'):
        sys.exit(1)


def main():
    p = argparse.ArgumentParser(description='婚禮小冊・長輩意見摘要')
    sub = p.add_subparsers(dest='cmd', required=True)
    d = sub.add_parser('digest', help='產生 Markdown 摘要')
    d.add_argument('--status', default='待處理', help='待處理（預設）或 all')
    d.add_argument('--since', help='只看這天之後送出的（YYYY-MM-DD）')
    d.add_argument('--out', help='輸出檔案；未指定則印出')
    d.add_argument('--from-json', help='離線模式：讀取已下載的 JSON')
    m = sub.add_parser('mark', help='回寫處理狀態')
    m.add_argument('opinion_id'); m.add_argument('status'); m.add_argument('note', nargs='?')
    a = p.parse_args()
    cmd_digest(a) if a.cmd == 'digest' else cmd_mark(a)


if __name__ == '__main__':
    main()
