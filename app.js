/* NEHS CodeJudge 前端 */
'use strict';

// ============ 共用工具 ============
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => $('#app');
let ME = null;
let pageTimers = [];
const clearPageTimers = () => { pageTimers.forEach(clearInterval); pageTimers = []; };

const CFG = window.CJ_CONFIG || {};
// 呼叫 Google Apps Script 後端（用 text/plain 避免跨網域預檢）
async function api(method, url, body) {
  const [path, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let r;
  try {
    r = await fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ method, path, query, body: body || null, token: store.get('cj-token') }),
    });
  } catch (e) { throw new Error('無法連線到後端（請檢查 config.js 的 API_URL 或網路）'); }
  let data = {};
  try { data = await r.json(); } catch { throw new Error('後端回應格式錯誤，請確認 Apps Script 已正確部署'); }
  if (data.status === 401 && path !== '/api/login') { ME = null; store.set('cj-token', ''); location.hash = '#/login'; }
  if (data.error) throw new Error(data.error);
  return data.data;
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function fmtTime(ts, short) {
  if (!ts) return '';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  if (short && today) return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const VERDICT = { AC: '通過', WA: '答案錯誤', TLE: '執行超時', RE: '執行錯誤', CE: '編譯錯誤', OLE: '輸出過多' };
const vBadge = v => `<span class="v ${esc(v)}" title="${esc(VERDICT[v] || v)}">${esc(v)}</span>`;
const stars = n => `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 3 - n))}</span>`;
const isTeacher = () => ME && ME.role === 'teacher';
const userLabel = s => `${esc(s.cls || '')}${s.seat ? '-' + String(s.seat).padStart(2, '0') : ''} ${esc(s.name || s.account)}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
};

// ============ 友善錯誤說明（中文） ============
const FULLWIDTH = { '（': '(', '）': ')', '，': ',', '：': ':', '＝': '=', '＂': '"', '＇': "'", '“': '"', '”': '"', '‘': "'", '’': "'", '＋': '+', '－': '-', '＊': '*', '／': '/', '；': ';', '［': '[', '］': ']', '｛': '{', '｝': '}', '＜': '<', '＞': '>', '。': '.', '．': '.', '　': '半形空白' };
function friendly(err) {
  if (!err) return '';
  const m = err.msg || '', t = err.type || '';
  const at = err.line ? `第 ${err.line} 行：` : '';
  let r;
  if ((r = m.match(/invalid character '(.)' \(U\+([0-9A-F]+)\)/))) return `${at}出現全形符號「${r[1]}」。程式的符號都要用半形${FULLWIDTH[r[1]] ? `，請改成「${FULLWIDTH[r[1]]}」` : ''}。（切換輸入法到英數模式再打）`;
  if (/non-printable character U\+3000/.test(m)) return `${at}出現全形空白，請刪掉後用半形空白（英數模式）重打。`;
  if (/unterminated string literal|EOL while scanning/.test(m)) return `${at}字串少了結尾的引號。請檢查引號是否成對，例如 '哈囉' 或 "哈囉"。`;
  if (/unterminated triple-quoted/.test(m)) return `${at}三引號字串沒有結束。`;
  if ((r = m.match(/'(.)' was never closed/))) return `${at}「${r[1]}」括號沒有關閉，請補上對應的右括號。`;
  if ((r = m.match(/unmatched '(.)'/))) return `${at}多了一個「${r[1]}」，找不到對應的左括號。`;
  if ((r = m.match(/closing parenthesis '(.)' does not match opening parenthesis '(.)'/))) return `${at}括號種類不一致：「${r[2]}」要用「${({ '(': ')', '[': ']', '{': '}' })[r[2]] || ''}」關閉，不是「${r[1]}」。`;
  if (/Missing parentheses in call to 'print'/.test(m)) return `${at}print 後面要加上括號，例如 print('哈囉')。`;
  if (/Perhaps you forgot a comma/.test(m)) return `${at}可能少了逗號。print( ) 裡有多個項目時，要用半形逗號 , 分隔，例如 print('平均是', z)。`;
  if (/Maybe you meant '==' or ':=' instead of '='/.test(m)) return `${at}「=」是把值存進變數；要判斷「是否相等」請用「==」。`;
  if (/cannot assign to (literal|expression|function call)/.test(m)) return `${at}等號左邊必須是「變數名稱」，例如 a = 7 + 3，不能寫成 7 + 3 = a。`;
  if (/invalid decimal literal/.test(m)) return `${at}數字後面直接接了文字。變數名稱不能用數字開頭（例如 1a 不行，a1 可以）。`;
  if (/expected ':'/.test(m)) return `${at}這一行的結尾少了冒號「:」。`;
  if (/unexpected indent/.test(m)) return `${at}這一行開頭多了空白（縮排）。Python 很在意行首空白，請把行首的空白刪掉。`;
  if (/expected an indented block/.test(m)) return `${at}這裡需要縮排（行首空 4 格）。`;
  if (/unindent does not match/.test(m)) return `${at}縮排的空白數量不一致。`;
  if (/unexpected EOF|incomplete input/.test(m)) return `${at}程式好像還沒寫完，可能少了右括號或引號。`;
  if (t === 'SyntaxError' || t === 'IndentationError' || t === 'TabError') return `${at}語法錯誤（${m}）。請檢查這一行的括號、引號、逗號是否正確、是否使用了全形符號。`;
  if (t === 'NameError') {
    const nm = (m.match(/name '(.+?)' is not defined/) || [])[1];
    const sug = (m.match(/Did you mean: '(.+?)'/) || [])[1];
    let s = `${at}「${nm}」沒有定義。`;
    if (sug) s += `你是不是要寫「${sug}」？（Python 有分大小寫）`;
    else if (nm && /[^\x00-\x7f]/.test(nm)) s += `如果「${nm}」是要輸出的文字，記得前後加上引號，例如 '${nm}'。`;
    else s += `請檢查拼字、大小寫，或是不是還沒有先設定這個變數。`;
    return s;
  }
  if (t === 'TypeError') {
    if (/can only concatenate str \(not "(int|float)"\) to str/.test(m)) return `${at}字串不能直接和數字用 + 相加。可以改用逗號：print('答案是', x)，或用 str(x) 把數字轉成字串。`;
    if ((r = m.match(/unsupported operand type\(s\) for (.+?): '(\w+)' and '(\w+)'/))) return `${at}${r[2]} 和 ${r[3]} 不能做「${r[1]}」運算。提醒：input( ) 得到的資料是字串(str)，要計算前請用 int( ) 或 float( ) 轉換。`;
    if (/can't multiply sequence by non-int/.test(m)) return `${at}字串不能乘以小數。input( ) 得到的是字串，請先用 int( ) 或 float( ) 轉換成數字。`;
    if ((r = m.match(/'(\w+)' object is not callable/))) return `${at}把 ${r[1]} 當成函式呼叫了。是不是之前把 print、input、int 等名稱拿來當變數名稱？`;
    return `${at}資料型態錯誤（${m}）。`;
  }
  if (t === 'ValueError') {
    if ((r = m.match(/invalid literal for int\(\) with base 10: (.+)/))) return `${at}int( ) 無法把 ${r[1]} 轉換成整數。若輸入的是小數，請改用 float( )。`;
    if (/could not convert string to float/.test(m)) return `${at}float( ) 無法把這個字串轉換成數字：${m}`;
    return `${at}數值錯誤（${m}）。`;
  }
  if (t === 'ZeroDivisionError') return `${at}除數不能是 0。`;
  if (t === 'EOFError') return `${at}程式想要讀取的資料比題目給的還多，是不是多寫了 input( )？`;
  if (t === 'RecursionError') return `${at}函式呼叫自己太多層了。`;
  return `${at}${t}: ${m}`;
}

// ============ Python 執行器（Web Worker + Pyodide） ============
const Judge = {
  worker: null, ready: false, readyPromise: null, seq: 0, pending: new Map(), url: null, listeners: new Set(),
  onStatus(fn) { this.listeners.add(fn); fn(this.ready ? 'ready' : 'loading'); return () => this.listeners.delete(fn); },
  emit(s) { this.listeners.forEach(f => f(s)); },
  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.ready = false; this.emit('loading');
    this.readyPromise = (async () => {
      if (!this.url) this.url = CFG.PYODIDE_URL || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
      this.worker = new Worker('judge-worker.js');
      this.worker.onmessage = e => {
        const p = this.pending.get(e.data.id); if (!p) return;
        this.pending.delete(e.data.id);
        e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
      };
      await this.call({ type: 'init', url: this.url });
      this.ready = true; this.emit('ready');
    })().catch(e => { this.readyPromise = null; this.emit('error'); throw e; });
    return this.readyPromise;
  },
  call(msg) {
    return new Promise((resolve, reject) => { const id = ++this.seq; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); });
  },
  restart() {
    if (this.worker) this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('terminated'));
    this.pending.clear(); this.worker = null; this.readyPromise = null; this.ready = false;
    return this.start();
  },
  busy: false,
  async check(code) {
    if (this.busy) return undefined;
    await this.start();
    return this.call({ type: 'check', code });
  },
  async run(code, input, timeLimitMs = 2000) {
    await this.start();
    this.busy = true;
    try {
      let timer;
      const timeout = new Promise(res => { timer = setTimeout(() => res('TLE'), timeLimitMs + 1500); });
      const r = await Promise.race([this.call({ type: 'run', code, input }), timeout]);
      clearTimeout(timer);
      if (r === 'TLE') { this.restart(); return { status: 'TLE', stdout: '', timeMs: timeLimitMs }; }
      if (r.status === 'OK' && r.timeMs > timeLimitMs) r.status = 'TLE';
      if (r.error) r.error.friendly = friendly(r.error);
      return r;
    } finally { this.busy = false; }
  },
  // 依題目全部測資評測，回傳要送到伺服器的資料
  async judgeAll(code, problem, onProgress) {
    const tests = problem.tests || [];
    const first = await this.run(code, tests[0] ? tests[0].input : '', problem.timeLimitMs);
    if (first.status === 'CE') { first.error.friendly = friendly(first.error); return { compileError: first.error }; }
    const runs = [];
    for (let i = 0; i < tests.length; i++) {
      onProgress && onProgress(i + 1, tests.length);
      const r = i === 0 ? first : await this.run(code, tests[i].input, problem.timeLimitMs);
      runs.push({ status: r.status === 'OK' ? 'OK' : r.status, stdout: r.stdout || '', timeMs: r.timeMs || 0, error: r.error || null });
    }
    return { runs };
  },
};

// ============ 程式編輯器 ============
const PY_WORDS = [
  ['print', '輸出資料', 'fn'], ['input', '讀取輸入（得到字串）', 'fn'], ['int', '轉換成整數', 'fn'], ['float', '轉換成浮點數', 'fn'],
  ['str', '轉換成字串', 'fn'], ['type', '查詢資料型態', 'fn'], ['len', '長度', 'fn'], ['range', '產生數列', 'fn'], ['abs', '絕對值', 'fn'],
  ['round', '四捨五入', 'fn'], ['max', '最大值', 'fn'], ['min', '最小值', 'fn'], ['sum', '總和', 'fn'], ['bool', '轉換成布林值', 'fn'],
  ['list', '串列', 'fn'], ['dict', '字典', 'fn'], ['tuple', '元組', 'fn'], ['set', '集合', 'fn'], ['sorted', '排序', 'fn'],
  ['format', '格式化', 'fn'], ['divmod', '商與餘數', 'fn'], ['pow', '次方', 'fn'], ['chr', '數字轉字元', 'fn'], ['ord', '字元轉數字', 'fn'],
  ['enumerate', '編號列舉', 'fn'], ['zip', '配對', 'fn'], ['map', '對每個元素套用函式', 'fn'], ['isinstance', '判斷型態', 'fn'],
  ['True', '真', 'kw'], ['False', '假', 'kw'], ['None', '空值', 'kw'], ['and', '而且', 'kw'], ['or', '或者', 'kw'], ['not', '不是', 'kw'],
  ['if', '如果', 'kw'], ['elif', '否則如果', 'kw'], ['else', '否則', 'kw'], ['for', '重複（計數）', 'kw'], ['while', '重複（條件）', 'kw'],
  ['in', '在…之中', 'kw'], ['is', '是', 'kw'], ['break', '跳出迴圈', 'kw'], ['continue', '跳到下一圈', 'kw'], ['pass', '不做事', 'kw'],
  ['def', '定義函式', 'kw'], ['return', '傳回', 'kw'], ['import', '匯入模組', 'kw'], ['from', '從…匯入', 'kw'], ['as', '別名', 'kw'],
  ['class', '定義類別', 'kw'], ['try', '嘗試', 'kw'], ['except', '例外處理', 'kw'], ['finally', '最後', 'kw'], ['with', 'with 敘述', 'kw'],
  ['lambda', '匿名函式', 'kw'], ['global', '全域變數', 'kw'], ['del', '刪除', 'kw'], ['assert', '斷言', 'kw'], ['raise', '引發例外', 'kw'],
  ['nonlocal', '外層變數', 'kw'], ['yield', '產生值', 'kw'], ['math', '數學模組', 'mod'], ['random', '亂數模組', 'mod'],
];

function pythonHint(cm) {
  const cur = cm.getCursor(), token = cm.getTokenAt(cur);
  const line = cm.getLine(cur.line);
  let start = cur.ch; while (start > 0 && /[\w]/.test(line[start - 1])) start--;
  const word = line.slice(start, cur.ch);
  if (!word) return null;
  const lw = word.toLowerCase();
  // 文件中的變數名稱
  const seen = new Set(PY_WORDS.map(w => w[0]));
  const vars = [];
  const text = cm.getValue().replace(/(['"]).*?\1|#.*$/gm, '');
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    if (!seen.has(m[1]) && m[1] !== word) { seen.add(m[1]); vars.push([m[1], '變數', 'var']); }
  }
  const list = [...PY_WORDS, ...vars].filter(([w]) => w.toLowerCase().startsWith(lw) && w !== word)
    .sort((a, b) => (a[0].startsWith(word) ? 0 : 1) - (b[0].startsWith(word) ? 0 : 1) || a[0].length - b[0].length);
  if (!list.length) return null;
  return {
    from: CodeMirror.Pos(cur.line, start), to: CodeMirror.Pos(cur.line, cur.ch),
    list: list.slice(0, 12).map(([w, desc, kind]) => ({
      text: kind === 'fn' ? w + '()' : w,
      render(el) { el.innerHTML = `${esc(w)}${kind === 'fn' ? '( )' : ''}<span class="hd">${esc(desc)}</span>`; },
      hint(cm, data, comp) {
        const after = cm.getRange(data.to, CodeMirror.Pos(data.to.line, data.to.ch + 1));
        if (kind === 'fn' && after === '(') { cm.replaceRange(w, data.from, data.to); return; }
        cm.replaceRange(comp.text, data.from, data.to);
        if (kind === 'fn') cm.setCursor(CodeMirror.Pos(data.from.line, data.from.ch + w.length + 1));
      },
    })),
  };
}

function createEditor(el, value, { onChange, readOnly } = {}) {
  const cm = CodeMirror(el, {
    value, mode: 'python', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
    matchBrackets: true, autoCloseBrackets: !readOnly, styleActiveLine: !readOnly, readOnly: readOnly ? true : false,
    gutters: ['err-gutter', 'CodeMirror-linenumbers'],
    extraKeys: {
      Tab: cm => cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    '),
      'Shift-Tab': cm => cm.indentSelection('subtract'),
      'Ctrl-Space': cm => cm.showHint({ hint: pythonHint, completeSingle: false }),
    },
  });
  if (!readOnly) {
    cm.on('inputRead', (cm, change) => {
      if (cm.state.completionActive) return;
      const ch = change.text[0];
      if (!/^[A-Za-z_]$/.test(ch)) return;
      const tok = cm.getTokenAt(cm.getCursor());
      if (tok.type === 'string' || tok.type === 'comment') return;
      cm.showHint({ hint: pythonHint, completeSingle: false });
    });
    if (onChange) cm.on('change', () => onChange(cm));
  }
  return cm;
}

// 標示錯誤行與全形符號
function markErrors(cm, err) {
  cm.clearGutter('err-gutter');
  (cm._errLines || []).forEach(l => cm.removeLineClass(l, 'background', 'cm-error-line'));
  (cm._fwMarks || []).forEach(m => m.clear());
  cm._errLines = []; cm._fwMarks = [];
  // 全形符號（字串和註解以外）
  cm.eachLine(lh => {
    const ln = cm.getLineNumber(lh);
    for (const tok of cm.getLineTokens(ln)) {
      if (tok.type === 'string' || tok.type === 'comment') continue;
      for (let i = 0; i < tok.string.length; i++) {
        if (FULLWIDTH[tok.string[i]]) cm._fwMarks.push(cm.markText({ line: ln, ch: tok.start + i }, { line: ln, ch: tok.start + i + 1 }, { className: 'cm-fullwidth', title: `全形符號，請改成半形「${FULLWIDTH[tok.string[i]]}」` }));
      }
    }
  });
  if (err && err.line) {
    const l = Math.min(err.line - 1, cm.lineCount() - 1);
    const lh = cm.addLineClass(l, 'background', 'cm-error-line'); cm._errLines.push(lh);
    const mk = document.createElement('span'); mk.className = 'err-marker'; mk.textContent = '●'; mk.title = friendly(err);
    cm.setGutterMarker(l, 'err-gutter', mk);
  }
}

// ============ 版面 ============
function renderNav() {
  const r = location.hash.split('?')[0].split('/')[1] || '';
  const links = !ME ? [] : [
    ['problems', '題目'], ['submissions', isTeacher() ? '解題動態' : '我的紀錄'],
    ...(isTeacher() ? [['scoreboard', '成績總表'], ['admin', '管理']] : []),
  ];
  $('#nav').innerHTML = links.map(([k, t]) => `<a href="#/${k}" class="${r === k || (r === 'problem' && k === 'problems') || (r === 'submission' && k === 'submissions') ? 'on' : ''}">${t}</a>`).join('');
  $('#userbox').innerHTML = !ME ? '' : `
    <button class="bell" id="bell" title="通知">🔔<span class="dot" id="bellDot" style="display:none"></span></button>
    <span>${isTeacher() ? '👩‍🏫 ' : ''}${ME.cls ? esc(ME.cls) + ' ' : ''}${esc(ME.name)}</span>
    <a href="#/me">帳號</a>
    <button class="btn sm" id="logout">登出</button>`;
  if (ME) {
    $('#logout').onclick = async () => {
      try { await api('POST', '/api/logout'); } catch { }
      store.set('cj-token', ''); ME = null;
      try { google.accounts.id.disableAutoSelect(); } catch { }
      location.hash = '#/login';
    };
    $('#bell').onclick = toggleNotif;
    refreshNotif();
  }
}
let notifItems = [];
async function refreshNotif() {
  if (!ME) return;
  try {
    notifItems = (await api('GET', '/api/notifications')).items;
    const d = $('#bellDot'); if (!d) return;
    d.style.display = notifItems.length ? '' : 'none'; d.textContent = notifItems.length;
  } catch { }
}
setInterval(refreshNotif, 60000);
function toggleNotif() {
  const old = $('.notif-pop'); if (old) { old.remove(); return; }
  const pop = document.createElement('div'); pop.className = 'notif-pop';
  pop.innerHTML = notifItems.length ? notifItems.map(n => `<a href="#/submission/${n.submissionId}">
      <b>${esc(n.authorName)}</b> 在 ${esc(n.problemId)} 第 ${n.submissionId} 號提交留言${n.line ? `（第 ${n.line} 行）` : ''}：<br><span class="muted small">${esc(n.text.slice(0, 80))}</span></a>`).join('')
    : '<div style="padding:14px" class="muted">目前沒有新通知</div>';
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', h); } }), 0);
}

// ============ 路由 ============
async function router() {
  clearPageTimers();
  $('.notif-pop')?.remove();
  const [, page = '', arg = ''] = location.hash.split('?')[0].split('/');
  if (!CFG.API_URL || /請貼上|XXXX/.test(CFG.API_URL)) {
    app().innerHTML = '<div class="card"><h2>尚未設定</h2><p>請編輯 <code>config.js</code>，填入 Apps Script 網址（API_URL）與 Google 用戶端 ID（GOOGLE_CLIENT_ID）。</p></div>';
    return;
  }
  if (!ME && store.get('cj-token')) {
    app().innerHTML = '<div class="loading">登入中…</div>';
    try { ME = (await api('GET', '/api/me')).user; } catch { ME = null; }
  }
  if (!ME && page !== 'login') { location.hash = '#/login'; return; }
  renderNav();
  const views = { login: viewLogin, problems: viewProblems, problem: viewProblem, submissions: viewSubmissions, submission: viewSubmission, scoreboard: viewScoreboard, admin: viewAdmin, edit: viewEditProblem, me: viewMe };
  const v = views[page] || (() => { location.hash = '#/problems'; });
  try { await v(decodeURIComponent(arg)); }
  catch (e) { app().innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div></div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

// ============ 登入 ============
function viewLogin() {
  if (ME) { location.hash = '#/problems'; return; }
  app().innerHTML = `<div class="login-wrap"><div class="card" style="text-align:center">
    <h1>NEHS CodeJudge</h1><div class="muted">國中三年級資訊科技 · Python 線上解題系統</div>
    <p style="margin:24px 0 12px">請使用<b>學校的 Google 帳號</b>登入${CFG.DOMAIN ? `<br><span class="muted small">（@${esc(CFG.DOMAIN)}）</span>` : ''}</p>
    <div id="gbtn" style="display:flex;justify-content:center;min-height:44px"><span class="muted">Google 登入按鈕載入中…</span></div>
    <div class="err" id="lerr"></div>
  </div></div>`;
  const onCredential = async resp => {
    $('#lerr').textContent = ''; $('#gbtn').innerHTML = '<span class="muted">登入中…</span>';
    try {
      const r = await api('POST', '/api/login', { credential: resp.credential });
      store.set('cj-token', r.token); ME = r.user;
      location.hash = '#/problems';
    } catch (err) { $('#lerr').textContent = err.message; renderBtn(); }
  };
  const renderBtn = () => {
    $('#gbtn').innerHTML = '';
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'zh-TW', width: 280 });
  };
  const init = () => {
    if (!window.google || !google.accounts) { setTimeout(init, 200); return; }
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, hd: CFG.DOMAIN || undefined, auto_select: true, ux_mode: 'popup' });
    renderBtn();
    google.accounts.id.prompt();
  };
  init();
}

function viewMe() {
  app().innerHTML = `<div class="login-wrap"><div class="card">
    <h2>帳號資訊</h2>
    <p>${esc(ME.name)}<br><span class="muted">${esc(ME.email || ME.account)}</span><br>${ME.cls ? `${esc(ME.cls)} 班 ${ME.seat} 號` : '老師'}</p>
    <p class="muted small">本系統使用學校 Google 帳號登入，不需要另外設定密碼。登入有效時間約 6 小時。</p>
  </div></div>`;
}

// ============ 題目列表 ============
async function viewProblems() {
  const { problems } = await api('GET', '/api/problems');
  const chapters = [...new Set(problems.map(p => p.chapter || '其他'))];
  const solved = problems.filter(p => p.mine && p.mine.ac).length;
  app().innerHTML = `
    <div class="card">
      <div class="row"><h2 style="margin:0">題目列表</h2><span class="spacer"></span>
        ${isTeacher() ? '<a class="btn primary" href="#/edit/">＋ 新增題目</a>' : `<span>已通過 <b class="mine-ac">${solved}</b> / ${problems.length} 題</span>`}
        <input type="text" id="q" placeholder="搜尋題號、題目、分類…" style="width:220px">
      </div>
    </div>
    ${chapters.map(ch => `<div class="card"><h3 style="margin-top:0">${esc(ch)}</h3><div class="table-wrap"><table class="list">
      <thead><tr><th style="width:70px">題號</th><th>題目</th><th>分類</th><th>難度</th><th>${isTeacher() ? '通過人數 / 嘗試人數' : '本班通過'}</th><th>送出次數</th><th>${isTeacher() ? '狀態' : '我的狀態'}</th></tr></thead>
      <tbody>${problems.filter(p => (p.chapter || '其他') === ch).map(p => `
        <tr data-s="${esc((p.id + p.title + (p.tags || []).join(' ')).toLowerCase())}">
          <td><a href="#/problem/${esc(p.id)}">${esc(p.id)}</a></td>
          <td><a href="#/problem/${esc(p.id)}"><b>${esc(p.title)}</b></a></td>
          <td>${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
          <td>${stars(p.difficulty)}</td>
          <td>${p.stats.ac} / ${p.stats.tried}</td>
          <td>${p.stats.submissions}</td>
          <td>${isTeacher() ? (p.visible ? '公開' : '<span class="muted">隱藏</span>')
            : !p.mine ? '<span class="muted">未作答</span>'
              : p.mine.ac ? `<span class="mine-ac">✔ 通過</span> <span class="muted small">${fmtTime(p.mine.firstAC, true)}</span>`
                : `<span class="mine-tried">✘ ${p.mine.best} 分</span> <span class="muted small">(${p.mine.tries} 次)</span>`}</td>
        </tr>`).join('')}</tbody></table></div></div>`).join('')}`;
  $('#q').oninput = e => { const q = e.target.value.toLowerCase(); $$('tr[data-s]').forEach(tr => tr.style.display = tr.dataset.s.includes(q) ? '' : 'none'); };
}

// ============ 題目頁（解題） ============
async function viewProblem(id) {
  const cls = store.get('cj-cls') || '';
  const data = await api('GET', `/api/problems/${encodeURIComponent(id)}${isTeacher() ? '?cls=' + encodeURIComponent(cls) : ''}`);
  const p = data.problem;
  const draftKey = `cj-draft-${ME.account}-${p.id}`;
  const pendingLoad = sessionStorage.getItem('cj-load-code');
  sessionStorage.removeItem('cj-load-code');
  const initial = pendingLoad ?? store.get(draftKey) ?? '';

  app().innerHTML = `
  <div class="problem-layout">
    <div>
      <div class="card">
        <div class="ptitle"><span class="pid">${esc(p.id)}</span><h2 style="margin:0">${esc(p.title)}</h2>${isTeacher() ? `<a class="btn sm" href="#/edit/${esc(p.id)}">編輯題目</a>` : ''}</div>
        <div class="muted small" style="margin:4px 0 10px">${esc(p.chapter)} · ${stars(p.difficulty)} · 時間限制 ${p.timeLimitMs / 1000} 秒 · 滿分 ${p.points} · ${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <h3>內容</h3><div class="pbody">${esc(p.content)}</div>
        <h3>輸入說明</h3><div class="pbody">${esc(p.inputDesc)}</div>
        <h3>輸出說明</h3><div class="pbody">${esc(p.outputDesc)}</div>
        ${p.samples.map((s, i) => `<h3>範例 ${i + 1}</h3><div class="sample">
          <div class="box"><div class="h">範例輸入<span class="spacer"></span><a href="javascript:void 0" data-copy-in="${i}">放到測試輸入</a></div><pre>${esc(s.input) || '<span class="muted">（無）</span>'}</pre></div>
          <div class="box"><div class="h">範例輸出</div><pre>${esc(s.output)}</pre></div></div>`).join('')}
        ${p.hint ? `<h3>提示</h3><div class="hintbox">${esc(p.hint)}</div>` : ''}
      </div>
      <div class="card">
        <div class="tabs" id="ptabs"><button data-t="mine" class="on">${isTeacher() ? '我的測試' : '本題狀況（我的提交）'}</button>${isTeacher() ? '<button data-t="students">全班狀況</button>' : ''}</div>
        <div id="ptab"></div>
      </div>
    </div>
    <div>
      <div class="card editor-card">
        <div class="toolbar">
          <b>Python 程式碼</b><span class="py-status" id="pyst">Python 環境載入中…</span><span class="spacer"></span>
          <button class="btn" id="btnRun" disabled title="Ctrl + Enter">▶ 執行測試</button>
          <button class="btn primary" id="btnSubmit" disabled>送出評測</button>
        </div>
        <div id="editor"></div>
        <div class="lint" id="lint"></div>
        <div class="io-grid">
          <div><label>測試輸入（每行對應一次 input( )）</label><textarea id="stdin">${esc(p.samples[0] ? p.samples[0].input : '')}</textarea></div>
          <div><label>執行結果</label><pre class="out" id="stdout"></pre></div>
        </div>
        <div class="muted small" style="margin-top:4px">💡 打字時會自動跳出 Python 關鍵字（也可按 Ctrl+空白鍵）；評測時 input( ) 的提示文字不會輸出。</div>
        <div id="result"></div>
      </div>
    </div>
  </div>`;

  const cm = createEditor($('#editor'), initial, {
    onChange: cm => { store.set(draftKey, cm.getValue()); scheduleLint(); },
  });
  setTimeout(() => cm.refresh(), 0);
  let lintTimer;
  async function lint() {
    const code = cm.getValue();
    if (!code.trim()) { markErrors(cm, null); $('#lint').className = 'lint'; $('#lint').textContent = ''; return; }
    const err = await Judge.check(code).catch(() => undefined);
    if (err === undefined) return;
    markErrors(cm, err);
    const box = $('#lint'); if (!box) return;
    if (err) { box.className = 'lint bad'; box.textContent = '⚠ ' + friendly(err); }
    else { box.className = 'lint good'; box.textContent = '✔ 語法檢查通過'; }
  }
  function scheduleLint() { clearTimeout(lintTimer); lintTimer = setTimeout(lint, 600); }

  const off = Judge.onStatus(s => {
    const el = $('#pyst'); if (!el) { off(); return; }
    el.className = 'py-status' + (s === 'ready' ? ' ready' : '');
    el.textContent = s === 'ready' ? '● Python 已就緒' : s === 'error' ? '✘ Python 載入失敗，請重新整理' : 'Python 環境載入中…';
    $('#btnRun').disabled = $('#btnSubmit').disabled = s !== 'ready';
    if (s === 'ready') lint();
  });
  Judge.start().catch(() => { });

  $$('[data-copy-in]').forEach(a => a.onclick = () => { $('#stdin').value = p.samples[+a.dataset.copyIn].input; });

  async function run() {
    const out = $('#stdout'); out.innerHTML = '<span class="muted">執行中…</span>';
    $('#btnRun').disabled = true;
    try {
      const r = await Judge.run(cm.getValue(), $('#stdin').value, p.timeLimitMs);
      let html = esc(r.stdout || '');
      if (r.status === 'CE' || r.status === 'RE') {
        const f = friendly(r.error);
        markErrors(cm, r.error);
        html += `<span class="e">${html ? '\n' : ''}✘ ${r.status === 'CE' ? '編譯錯誤' : '執行錯誤'}\n${esc(f)}\n(${esc(r.error.type)}: ${esc(r.error.msg)})</span>`;
      } else if (r.status === 'TLE') html += `<span class="e">\n✘ 執行超過 ${p.timeLimitMs / 1000} 秒。如果測試輸入的行數不夠，input( ) 會讀不到資料。</span>`;
      else if (r.status === 'OLE') html += '<span class="e">\n✘ 輸出資料過多</span>';
      else if (!r.stdout) html = '<span class="muted">（程式沒有輸出任何東西）</span>';
      out.innerHTML = html + (r.timeMs != null && r.status !== 'TLE' ? `\n<span class="muted">— 執行時間 ${r.timeMs} ms</span>` : '');
    } catch (e) { out.innerHTML = `<span class="e">${esc(e.message)}</span>`; }
    $('#btnRun').disabled = false;
  }
  $('#btnRun').onclick = run;
  cm.setOption('extraKeys', { ...cm.getOption('extraKeys'), 'Ctrl-Enter': run });

  $('#btnSubmit').onclick = async () => {
    const code = cm.getValue();
    if (!code.trim()) { toast('請先寫程式'); return; }
    const btn = $('#btnSubmit'); btn.disabled = true; $('#btnRun').disabled = true;
    const res = $('#result');
    res.innerHTML = '<div class="result-box">評測中…</div>';
    try {
      const payload = await Judge.judgeAll(code, p, (i, n) => { res.innerHTML = `<div class="result-box">評測中… 第 ${i} / ${n} 組測資</div>`; });
      const { submission } = await api('POST', '/api/submit', { problemId: p.id, code, ...payload });
      res.innerHTML = renderResult(submission);
      markErrors(cm, submission.error);
      refreshTab();
    } catch (e) { res.innerHTML = `<div class="result-box err">${esc(e.message)}</div>`; }
    btn.disabled = false; $('#btnRun').disabled = false;
  };

  // 下方分頁：我的提交 / 全班狀況
  let tab = 'mine';
  $$('#ptabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('#ptabs button').forEach(x => x.classList.toggle('on', x === b)); refreshTab(true); });
  async function refreshTab(noFetch) {
    let d = data;
    if (!noFetch) { d = await api('GET', `/api/problems/${encodeURIComponent(id)}${isTeacher() ? '?cls=' + encodeURIComponent(store.get('cj-cls') || '') : ''}`); Object.assign(data, d); }
    const el = $('#ptab'); if (!el) return;
    const st = data.stats;
    const statHtml = `<div class="statgrid">
      <div class="stat"><b>${st.ac}</b><span>${isTeacher() ? '' : '本班'}通過人數</span></div>
      <div class="stat"><b>${st.tried}</b><span>嘗試人數</span></div>
      <div class="stat"><b>${st.submissions}</b><span>送出次數</span></div>
      ${data.mine ? `<div class="stat"><b class="${data.mine.ac ? 'mine-ac' : 'mine-tried'}">${data.mine.best}</b><span>我的最高分</span></div>
      <div class="stat"><b style="font-size:14px">${data.mine.ac ? fmtTime(data.mine.firstAC) : '尚未通過'}</b><span>首次通過時間</span></div>` : ''}</div>`;
    if (tab === 'mine') {
      el.innerHTML = statHtml + (data.mySubmissions.length ? subTable(data.mySubmissions, { hideUser: true, hideProblem: true }) : '<p class="muted">還沒有送出過這一題。</p>');
    } else {
      const c = store.get('cj-cls') || '';
      el.innerHTML = `<div class="row" style="margin-bottom:8px">班級：<select id="clsSel"><option value="">全部</option>${data.classes.map(x => `<option ${x === c ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <span class="muted small">點「看程式碼」可以檢視學生最後一次的程式並留言</span></div>${statHtml}
        <div class="table-wrap"><table class="list"><thead><tr><th>班級座號</th><th>姓名</th><th>狀態</th><th>最高分</th><th>送出次數</th><th>首次通過時間</th><th></th></tr></thead><tbody>
        ${data.students.map(s => `<tr><td>${esc(s.cls)}-${String(s.seat).padStart(2, '0')}</td><td>${esc(s.name)}</td>
          <td>${!s.tries ? '<span class="muted">未作答</span>' : s.ac ? vBadge('AC') : vBadge(s.lastVerdict)}</td>
          <td>${s.tries ? s.best : ''}</td><td>${s.tries || ''}</td><td>${s.ac ? fmtTime(s.firstAC) : ''}</td>
          <td>${s.lastId ? `<a href="#/submission/${s.lastId}">看程式碼</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      $('#clsSel').onchange = e => { store.set('cj-cls', e.target.value); refreshTab(); };
    }
  }
  refreshTab(true);
  if (isTeacher()) pageTimers.push(setInterval(() => { if (tab === 'students') refreshTab(); }, 15000));
}

function renderResult(s) {
  const tests = s.tests || [];
  return `<div class="result-box">
    <div class="result-head">${vBadge(s.verdict)}<b class="vtext ${s.verdict}">${VERDICT[s.verdict] || s.verdict}</b>
      <span>分數 <b>${s.score}</b> / ${s.maxScore}</span>${s.verdict !== 'CE' ? `<span class="muted">最長耗時 ${s.timeMs} ms</span>` : ''}
      <span class="spacer"></span><a href="#/submission/${s.id}">提交 #${s.id} 詳細資料 →</a></div>
    ${s.error && s.error.friendly ? `<div class="friendly"><b>錯誤說明：</b>${esc(s.error.friendly)}<div class="muted small">${esc(s.error.type)}: ${esc(s.error.msg)}</div></div>` : ''}
    ${tests.map((t, i) => `<div class="test-row"><span>#${i + 1}</span>${vBadge(t.status)}<span class="muted" style="min-width:60px">${t.timeMs} ms</span><span style="min-width:44px">${t.score} 分</span><span class="msg">${esc(t.message)}</span></div>`).join('')}
    ${s.verdict === 'AC' ? '<div style="margin-top:8px" class="mine-ac">🎉 恭喜通過全部測資！</div>' : ''}
  </div>`;
}

function subTable(list, { hideUser, hideProblem } = {}) {
  return `<div class="table-wrap"><table class="list"><thead><tr><th>編號</th>${hideUser ? '' : '<th>使用者</th>'}${hideProblem ? '' : '<th>題目</th>'}<th>結果</th><th>分數</th><th>耗時</th><th>送出時間</th><th>留言</th></tr></thead><tbody>
    ${list.map(s => `<tr>
      <td><a href="#/submission/${s.id}">#${s.id}</a></td>
      ${hideUser ? '' : `<td>${userLabel(s)}</td>`}
      ${hideProblem ? '' : `<td><a href="#/problem/${esc(s.problemId)}">${esc(s.problemId)} ${esc(s.problemTitle)}</a></td>`}
      <td><a href="#/submission/${s.id}">${vBadge(s.verdict)}</a></td>
      <td>${s.score}/${s.maxScore}</td><td>${s.verdict === 'CE' ? '-' : s.timeMs + ' ms'}</td>
      <td>${fmtTime(s.createdAt, true)}</td><td>${s.comments ? `💬 ${s.comments}` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ============ 解題動態 / 我的紀錄 ============
async function viewSubmissions() {
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const { problems } = await api('GET', '/api/problems');
  app().innerHTML = `<div class="card">
    <div class="row"><h2 style="margin:0">${isTeacher() ? '解題動態' : '我的提交紀錄'}</h2><span class="spacer"></span>
      ${isTeacher() ? '<select id="fcls"><option value="">全部班級</option></select>' : ''}
      <select id="fprob"><option value="">全部題目</option>${problems.map(p => `<option value="${esc(p.id)}">${esc(p.id)} ${esc(p.title)}</option>`).join('')}</select>
      <select id="fv"><option value="">全部結果</option>${Object.entries(VERDICT).map(([k, v]) => `<option value="${k}">${k} ${v}</option>`).join('')}</select>
      ${isTeacher() ? '<label class="small"><input type="checkbox" id="auto" checked> 每 20 秒自動更新</label>' : ''}
    </div></div>
    <div class="card" id="subs"><div class="loading">載入中…</div></div>`;
  let page = 1;
  const f = { cls: q.cls || store.get('cj-cls') || '', problem: q.problem || '', verdict: q.verdict || '', account: q.account || '' };
  $('#fprob').value = f.problem; $('#fv').value = f.verdict;
  async function load() {
    const qs = new URLSearchParams({ ...f, page }).toString();
    const d = await api('GET', '/api/submissions?' + qs);
    if (isTeacher() && $('#fcls').options.length === 1) {
      $('#fcls').innerHTML += d.classes.map(c => `<option>${esc(c)}</option>`).join(''); $('#fcls').value = f.cls;
    }
    const pages = Math.ceil(d.total / d.size);
    $('#subs').innerHTML = (f.account ? `<p>只顯示 <b>${esc(f.account)}</b> 的提交 <a href="#/submissions">顯示全部</a></p>` : '') +
      (d.submissions.length ? subTable(d.submissions) : '<p class="muted">沒有資料</p>') +
      (pages > 1 ? `<div class="pager">${Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i + 1 === page ? 'primary' : ''}" data-pg="${i + 1}">${i + 1}</button>`).join('')}</div>` : '');
    $$('[data-pg]').forEach(b => b.onclick = () => { page = +b.dataset.pg; load(); });
  }
  if (isTeacher()) $('#fcls').onchange = e => { f.cls = e.target.value; store.set('cj-cls', f.cls); page = 1; load(); };
  $('#fprob').onchange = e => { f.problem = e.target.value; page = 1; load(); };
  $('#fv').onchange = e => { f.verdict = e.target.value; page = 1; load(); };
  await load();
  if (isTeacher()) pageTimers.push(setInterval(() => { if ($('#auto') && $('#auto').checked && page === 1) load(); }, 20000));
}

// ============ 單筆提交（程式碼 + 留言） ============
async function viewSubmission(id) {
  const d = await api('GET', `/api/submissions/${id}`);
  const s = d.submission;
  refreshNotif();
  let selLine = null;
  app().innerHTML = `
  <div class="card">
    <div class="row"><h2 style="margin:0">提交 #${s.id}</h2>${vBadge(s.verdict)}<b class="vtext ${s.verdict}">${VERDICT[s.verdict]}</b><span class="spacer"></span>
      <a class="btn" href="#/problem/${esc(s.problemId)}">回到題目</a>
      <button class="btn" id="loadEd">在編輯器中開啟這份程式</button>
      ${isTeacher() ? '<button class="btn" id="rejudge">重新評測</button>' : ''}</div>
    <table class="list" style="margin-top:12px"><tr><th>使用者</th><th>題目</th><th>分數</th><th>耗時</th><th>送出時間</th></tr>
      <tr><td>${userLabel(s)} <span class="muted small">${esc(s.account)}</span>${isTeacher() ? ` · <a href="#/submissions?account=${esc(s.account)}">他的所有提交</a>` : ''}</td>
      <td><a href="#/problem/${esc(s.problemId)}">${esc(s.problemId)} ${esc(s.problemTitle)}</a></td>
      <td>${s.score} / ${s.maxScore}</td><td>${s.verdict === 'CE' ? '-' : s.timeMs + ' ms'}</td><td>${fmtTime(s.createdAt)}</td></tr></table>
  </div>
  <div class="problem-layout">
    <div class="card">
      <h3 style="margin-top:0">程式碼 ${isTeacher() ? '<span class="muted small">（點行號可以針對那一行留言）</span>' : ''}</h3>
      <div id="code" class="readonly ${isTeacher() ? 'teacher' : ''}"></div>
      <h3>評測結果</h3>
      <div id="resbox">${renderResult(s)}</div>
    </div>
    <div class="card comments">
      <h3 style="margin-top:0">💬 ${isTeacher() ? '給學生的回饋' : '老師的回饋'}</h3>
      <div id="clist"></div>
      <div style="margin-top:10px">
        <div class="row small" id="lineSel" style="margin-bottom:4px"></div>
        <textarea id="ctext" rows="4" placeholder="${isTeacher() ? '寫下錯誤說明或建議，學生會收到通知…' : '有問題可以在這裡回覆老師…'}" style="font-family:inherit"></textarea>
        <div class="row" style="margin-top:6px"><span class="spacer"></span><button class="btn primary" id="csend">送出留言</button></div>
      </div>
    </div>
  </div>`;
  const cm = createEditor($('#code'), s.code, { readOnly: true });
  setTimeout(() => cm.refresh(), 0);
  markErrors(cm, s.error);
  const markComments = () => d.comments.forEach(c => c.line && c.line <= cm.lineCount() && cm.addLineClass(c.line - 1, 'background', 'cm-comment-line'));
  markComments();
  const showLineSel = () => {
    $('#lineSel').innerHTML = selLine ? `針對 <span class="linechip">第 ${selLine} 行</span> 留言 <a href="javascript:void 0" id="clrLine">取消</a>` : '';
    if (selLine) $('#clrLine').onclick = () => { selLine = null; showLineSel(); };
  };
  if (isTeacher()) cm.on('gutterClick', (cm, line) => { selLine = line + 1; showLineSel(); $('#ctext').focus(); });
  const renderComments = () => {
    $('#clist').innerHTML = d.comments.length ? d.comments.map(c => `<div class="c ${c.role}">
      <div class="meta">${c.role === 'teacher' ? '👩‍🏫 ' : ''}<b>${esc(c.authorName)}</b> · ${fmtTime(c.createdAt)} ${c.line ? `· <span class="linechip" data-line="${c.line}">第 ${c.line} 行</span>` : ''}</div>
      <div class="txt">${esc(c.text)}</div></div>`).join('') : '<p class="muted">目前沒有留言。</p>';
    $$('[data-line]').forEach(el => el.onclick = () => { const l = +el.dataset.line - 1; cm.setCursor(l, 0); cm.scrollIntoView({ line: l, ch: 0 }, 80); });
  };
  renderComments();
  $('#csend').onclick = async () => {
    const text = $('#ctext').value.trim(); if (!text) return;
    try {
      const { comment } = await api('POST', `/api/submissions/${s.id}/comments`, { text, line: selLine });
      d.comments.push(comment); $('#ctext').value = ''; selLine = null; showLineSel(); renderComments(); markComments();
      toast(isTeacher() ? '已送出，學生會在通知看到' : '已送出');
    } catch (e) { toast(e.message); }
  };
  $('#loadEd').onclick = () => { sessionStorage.setItem('cj-load-code', s.code); location.hash = '#/problem/' + s.problemId; };
  if (isTeacher()) $('#rejudge').onclick = async () => {
    const btn = $('#rejudge'); btn.disabled = true; btn.textContent = '評測中…';
    try {
      const { problem } = await api('GET', `/api/problems/${encodeURIComponent(s.problemId)}`);
      const payload = await Judge.judgeAll(s.code, problem);
      const r = await api('POST', `/api/submissions/${s.id}/rejudge`, payload);
      $('#resbox').innerHTML = renderResult(r.submission); toast('重新評測完成：' + r.submission.verdict);
    } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = '重新評測';
  };
}

// ============ 成績總表（老師） ============
async function viewScoreboard() {
  let cls = store.get('cj-cls') || '';
  app().innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">成績總表</h2><span class="spacer"></span>
    班級：<select id="sbcls"></select>
    <label class="small"><input type="checkbox" id="auto" checked> 每 20 秒自動更新</label>
    <button class="btn" id="csv">⬇ 匯出 CSV（Excel）</button>
    <button class="btn" id="toSheet">寫入 Google Sheet</button></div>
    <p class="muted small" style="margin:8px 0 0">綠色＝通過、橘色＝部分得分、紅色＝0 分；格子內為最高分與送出次數，點格子看最後一次的程式碼。<span class="online"></span>＝2 分鐘內有活動</p></div>
    <div class="card" id="sb"><div class="loading">載入中…</div></div>`;
  let last = null;
  $('#csv').onclick = () => {
    if (!last) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['班級', '座號', '姓名', '帳號', ...last.problems.map(p => `${p.id} ${p.title}`), '通過題數', '總分'].map(q).join(',')];
    for (const r of last.rows) lines.push([r.cls, r.seat, r.name, r.account, ...r.cells.map(c => c ? c.best : ''), r.acCount, r.total].map(q).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `成績_${cls || '全部'}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#toSheet').onclick = async () => {
    const b = $('#toSheet'); b.disabled = true;
    try { toast((await api('POST', '/api/scoreboard/sheet', { cls })).msg, 4000); } catch (e) { toast(e.message); }
    b.disabled = false;
  };
  async function load() {
    const d = await api('GET', '/api/scoreboard?cls=' + encodeURIComponent(cls));
    last = d;
    const sel = $('#sbcls'); if (!sel) return;
    if (!sel.options.length) { sel.innerHTML = '<option value="">全部班級</option>' + d.classes.map(c => `<option>${esc(c)}</option>`).join(''); sel.value = cls; }
    const online = t => t && Date.now() - t < 120000;
    $('#sb').innerHTML = `<div class="table-wrap"><table class="list sb"><thead><tr><th class="name">班級座號</th><th class="name">姓名</th>
      ${d.problems.map(p => `<th class="p" title="${esc(p.title)}"><a href="#/problem/${esc(p.id)}">${esc(p.id)}</a></th>`).join('')}<th>通過</th><th>總分</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td class="name">${esc(r.cls)}-${String(r.seat).padStart(2, '0')}</td>
        <td class="name"><span class="${online(r.lastSeen) ? 'online' : 'offline'}"></span><a href="#/submissions?account=${esc(r.account)}">${esc(r.name)}</a></td>
        ${r.cells.map((c, i) => `<td>${c ? `<a class="cell ${c.ac ? 'ac' : c.best > 0 ? 'part' : 'zero'}" href="#/submission/${c.lastId}" title="${esc(d.problems[i].title)}｜送出 ${c.tries} 次${c.ac ? '｜首次通過 ' + fmtTime(c.firstAC) : ''}">${c.best}<small>${c.tries} 次</small></a>` : ''}</td>`).join('')}
        <td>${r.acCount}</td><td><b>${r.total}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><th class="name" colspan="2">通過人數</th>${d.problems.map((p, i) => `<th>${d.rows.filter(r => r.cells[i] && r.cells[i].ac).length}</th>`).join('')}<th></th><th>滿分 ${d.maxTotal}</th></tr></tfoot></table></div>`;
  }
  $('#sbcls').onchange = e => { cls = e.target.value; store.set('cj-cls', cls); load(); };
  await load();
  pageTimers.push(setInterval(() => { if ($('#auto') && $('#auto').checked) load(); }, 20000));
}

// ============ 管理（老師） ============
async function viewAdmin() {
  app().innerHTML = `<div class="card"><div class="tabs" id="atabs"><button data-t="problems" class="on">題目管理</button><button data-t="users">帳號管理</button></div><div id="atab"></div></div>`;
  let tab = 'problems';
  $$('#atabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('#atabs button').forEach(x => x.classList.toggle('on', x === b)); render(); });
  async function render() {
    const el = $('#atab');
    if (tab === 'problems') {
      const { problems } = await api('GET', '/api/problems');
      el.innerHTML = `<div class="row" style="margin-bottom:10px"><a class="btn primary" href="#/edit/">＋ 新增題目</a><span class="muted small">題目存在 Google Sheet 的「題目」工作表。</span></div>
        <table class="list"><thead><tr><th>題號</th><th>題目</th><th>章節</th><th>滿分</th><th>公開</th><th>通過/嘗試</th><th></th></tr></thead><tbody>
        ${problems.map(p => `<tr><td>${esc(p.id)}</td><td><a href="#/problem/${esc(p.id)}">${esc(p.title)}</a></td><td class="small">${esc(p.chapter)}</td><td>${p.points}</td>
          <td>${p.visible ? '✔' : '<span class="muted">隱藏</span>'}</td><td>${p.stats.ac}/${p.stats.tried}</td>
          <td><a class="btn sm" href="#/edit/${esc(p.id)}">編輯</a> <button class="btn sm danger" data-del="${esc(p.id)}">刪除</button></td></tr>`).join('')}</tbody></table>`;
      $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm(`確定要刪除題目 ${b.dataset.del}？（學生的提交紀錄會保留）`)) return;
        await api('DELETE', '/api/problems/' + encodeURIComponent(b.dataset.del)); toast('已刪除'); render();
      });
    } else {
      const cls = store.get('cj-cls') || '';
      const d = await api('GET', '/api/users?cls=' + encodeURIComponent(cls));
      el.innerHTML = `<div class="row" style="margin-bottom:10px">班級：<select id="ucls"><option value="">全部</option>${d.classes.map(c => `<option ${c === cls ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <span class="spacer"></span><a class="btn" href="${esc(d.sheetUrl)}" target="_blank" rel="noopener">開啟 Google Sheet 修改名單 ↗</a></div>
        <p class="muted small">學生用學校 Google 帳號登入，系統依 Email 對照「學生名單」工作表判斷班級座號；老師名單在「老師」工作表。名單改完立即生效（已登入的人重新登入後更新）。</p>
        <table class="list"><thead><tr><th>身分</th><th>班級</th><th>座號</th><th>姓名</th><th>Email</th><th>最近活動</th></tr></thead><tbody>
        ${d.users.map(u => `<tr><td>${u.role === 'teacher' ? '老師' : '學生'}</td><td>${esc(u.cls)}</td><td>${u.seat || ''}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
          <td class="small">${u.lastSeen ? `<span class="${Date.now() - u.lastSeen < 120000 ? 'online' : 'offline'}"></span>${fmtTime(u.lastSeen, true)}` : ''}</td></tr>`).join('')}</tbody></table>`;
      $('#ucls').onchange = e => { store.set('cj-cls', e.target.value); render(); };
    }
  }
  render();
}

async function viewEditProblem(id) {
  let p = { id: '', title: '', chapter: 'CH2 基本的 Python 程式設計', tags: [], difficulty: 1, content: '', inputDesc: '', outputDesc: '', samples: [{ input: '', output: '' }], hint: '', timeLimitMs: 2000, tests: [{ input: '', output: '', score: 100, public: true }], solution: '', visible: true };
  if (id) p = (await api('GET', '/api/problems/' + encodeURIComponent(id))).problem;
  const field = (k, label, type = 'text') => `<label>${label}</label>${type === 'area' ? `<textarea id="f_${k}" rows="4" style="font-family:inherit">${esc(p[k])}</textarea>` : `<input type="text" id="f_${k}" value="${esc(p[k])}">`}`;
  app().innerHTML = `<div class="card"><h2>${id ? '編輯題目 ' + esc(id) : '新增題目'}</h2>
    <div class="form-grid">
      ${field('id', '題號')}${field('title', '題目名稱')}${field('chapter', '章節')}
      <label>分類標籤</label><input type="text" id="f_tags" value="${esc((p.tags || []).join(', '))}" placeholder="用逗號分隔，例如 input, 變數">
      <label>難度 / 時限</label><div class="row"><select id="f_difficulty">${[1, 2, 3].map(n => `<option value="${n}" ${n === p.difficulty ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>
        時間限制 <input type="number" id="f_timeLimitMs" value="${p.timeLimitMs}" style="width:90px"> ms
        <label class="small"><input type="checkbox" id="f_visible" ${p.visible ? 'checked' : ''}> 公開給學生</label></div>
      ${field('content', '題目內容', 'area')}${field('inputDesc', '輸入說明', 'area')}${field('outputDesc', '輸出說明', 'area')}${field('hint', '提示', 'area')}
      <label>參考解答<br><span class="muted small">學生看不到</span></label><div><div id="solEd"></div>
        <div class="row" style="margin-top:6px"><button class="btn" id="gen">▶ 用參考解答產生全部測資的輸出</button><span class="muted small" id="genMsg"></span></div></div>
    </div>
    <h3>測資（第 1 組與勾選「公開」的測資，答錯時會顯示正確答案給學生看）</h3>
    <div id="tests"></div>
    <div class="row"><button class="btn" id="addT">＋ 新增一組測資</button><span class="spacer"></span><span id="sum" class="muted"></span></div>
    <h3>範例（顯示在題目頁）</h3>
    <label class="small"><input type="checkbox" id="autoSample" checked> 自動使用第 1 組測資當作範例</label>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><a class="btn" href="${id ? '#/problem/' + esc(id) : '#/admin'}">取消</a><button class="btn primary" id="save">儲存題目</button></div>
  </div>`;
  const sol = createEditor($('#solEd'), p.solution || '');
  sol.setSize(null, 180); setTimeout(() => sol.refresh(), 0);
  const renderTests = () => {
    $('#tests').innerHTML = p.tests.map((t, i) => `<div class="testcase">
      <b>#${i + 1}</b>
      <div><div class="small muted">輸入</div><textarea data-k="input" data-i="${i}">${esc(t.input)}</textarea></div>
      <div><div class="small muted">正確輸出</div><textarea data-k="output" data-i="${i}">${esc(t.output)}</textarea></div>
      <div><div class="small muted">分數</div><input type="number" data-k="score" data-i="${i}" value="${t.score}" style="width:80px">
        <label class="small"><input type="checkbox" data-k="public" data-i="${i}" ${t.public ? 'checked' : ''}> 公開</label><br>
        <button class="btn sm danger" data-rm="${i}">刪除</button></div></div>`).join('');
    $('#sum').textContent = `總分：${p.tests.reduce((a, t) => a + (+t.score || 0), 0)}`;
    $$('#tests [data-k]').forEach(el => el.oninput = el.onchange = () => {
      const t = p.tests[+el.dataset.i]; t[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
      $('#sum').textContent = `總分：${p.tests.reduce((a, t) => a + (+t.score || 0), 0)}`;
    });
    $$('[data-rm]').forEach(b => b.onclick = () => { p.tests.splice(+b.dataset.rm, 1); renderTests(); });
  };
  renderTests();
  $('#addT').onclick = () => { p.tests.push({ input: '', output: '', score: 0, public: false }); renderTests(); };
  $('#gen').onclick = async () => {
    const msg = $('#genMsg'); msg.textContent = '執行中…';
    try {
      for (let i = 0; i < p.tests.length; i++) {
        const r = await Judge.run(sol.getValue(), p.tests[i].input, 5000);
        if (r.status !== 'OK') { msg.textContent = `第 ${i + 1} 組失敗：${r.status} ${r.error ? friendly(r.error) : ''}`; renderTests(); return; }
        p.tests[i].output = r.stdout.replace(/\s+$/, '');
      }
      renderTests(); msg.textContent = '✔ 已產生 ' + p.tests.length + ' 組輸出';
    } catch (e) { msg.textContent = e.message; }
  };
  $('#save').onclick = async () => {
    const g = k => $('#f_' + k).value;
    const np = {
      id: g('id').trim(), title: g('title'), chapter: g('chapter'), tags: g('tags').split(/[,，]/).map(s => s.trim()).filter(Boolean),
      difficulty: +g('difficulty'), timeLimitMs: +g('timeLimitMs'), visible: $('#f_visible').checked,
      content: g('content'), inputDesc: g('inputDesc'), outputDesc: g('outputDesc'), hint: g('hint'),
      solution: sol.getValue(), tests: p.tests,
      samples: $('#autoSample').checked && p.tests[0] ? [{ input: p.tests[0].input, output: p.tests[0].output }] : p.samples,
    };
    try {
      await api('POST', '/api/problems', { problem: np, originalId: id || undefined });
      toast('已儲存'); location.hash = '#/problem/' + np.id;
    } catch (e) { toast(e.message, 4000); }
  };
}

router();
