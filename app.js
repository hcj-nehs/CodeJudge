/* NEHS CodeJudge（Python 版）前端
 * 題目資料下載一次就存在瀏覽器裡（題目版本號沒變就不再下載），學生看題目、切換頁面都不需要連到 Google；
 * 只有「登入」「送出評測」「按 🔄 / 看老師留言」才會呼叫後端。 */
'use strict';

// ============ 共用工具 ============
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => $('#app');
const CFG = window.CJ_CONFIG || {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
};
let pageTimers = [];
const clearPageTimers = () => { pageTimers.forEach(clearInterval); pageTimers = []; };
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function fmtTime(ts, short) {
  if (!ts) return '';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  if (short && today) return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const VERDICT = { AC: '通過', WA: '答案錯誤', TLE: '執行超時', RE: '執行錯誤', CE: '編譯錯誤', OLE: '輸出過多' };
const vBadge = v => `<span class="v ${esc(v)}" title="${esc(VERDICT[v] || v)}">${esc(v)}</span>`;
const stars = n => `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 3 - n))}</span>`;
const rankBadge = r => `<span class="rank r${Math.min(r, 4)}" title="本班第 ${r} 位完成">${r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : ''}第 ${r} 名</span>`;
const seat2 = n => String(n || '').padStart(2, '0');
const normalize = s => String(s || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');

// ============ 題目資料（存在瀏覽器，版本號改變時才重新下載） ============
// 分類（A系列・基礎／B系列・進階）就是「單元」：題目列表依分類分頁，老師可以為每個分類設定目標題數
const DEFAULT_SERIES = 'A系列・基礎';
const SERIES_DESC = { 'A系列・基礎': 'print、input、運算、if、for、while', 'B系列・進階': '仿 APCS 實作題：字串、串列、模擬' };
const seriesOrder = k => SERIES_DESC[k] ? 0 : 1;
let PROBS = [], PMAP = {}, SERIES_KEYS = [];
function applyProblems(list) {
  PROBS = (list || []).map(p => Object.assign({}, p, { series: p.chapter || '其他', topic: p.chapter || '其他', tags: p.tags || [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  PMAP = Object.fromEntries(PROBS.map(p => [p.id, p]));
  SERIES_KEYS = [...new Set(PROBS.map(p => p.series))].sort((a, b) => seriesOrder(a) - seriesOrder(b) || a.localeCompare(b));
}
applyProblems((store.json('cj-probs', {}) || {}).list);
const probsPv = () => (store.json('cj-probs', {}) || {}).pv || '';
function saveProblems(pv, list) { store.set('cj-probs', JSON.stringify({ pv, list })); applyProblems(list); }

// ============ 登入狀態（存在瀏覽器，重新整理不用再登入） ============
// 沒有登入時用「訪客」狀態：可以看題目、在瀏覽器執行測試，送出評測時才需要登入
const ANON = () => ({ anon: true, user: { role: 'anon', email: 'guest', account: 'guest', name: '訪客' }, subs: [], mine: {}, cls: {}, ranks: {}, classes: [], hidden: [] });
let S = store.json('cj-state', null);
if (!S) {
  // 第 1 版網頁留下的登入資料（cj-token）：保留登入狀態，啟動時同步一次換成新的通行證
  const old = store.get('cj-token');
  S = old ? { token: old, legacy: true, user: null, subs: [] } : ANON();
}
if (!store.get('cj-tcid') && store.get('cj-cls')) store.set('cj-tcid', store.get('cj-cls'));
const loggedIn = () => !!S && !S.anon && !!S.user;
const isTeacher = () => loggedIn() && S.user.role === 'teacher';
const saveState = () => { if (loggedIn()) { trimSubs(); store.set('cj-state', JSON.stringify(S)); } };
// 只保留最近 300 筆提交的程式碼，避免瀏覽器空間不夠
function trimSubs() { (S.subs || []).forEach((s, i) => { if (i >= 300) delete s.code; }); }
const toMine = c => Object.assign({}, c, { ac: !!c.firstAC });
// 套用伺服器回傳的同步資料。資料沒有變動時伺服器只回 same:true，瀏覽器沿用已存的資料。
function applySync(d) {
  S.user = d.user; S.syncedAt = Date.now(); S.schema = 2; delete S.legacy;
  if (d.token) S.token = d.token;
  if (d.problems) saveProblems(d.pv, d.problems);
  if (d.subs) {   // 伺服器上的提交紀錄（換電腦也看得到），保留本機已經下載過的程式碼
    const local = Object.fromEntries((S.subs || []).map(s => [s.id, s]));
    S.subs = d.subs.map(s => Object.assign({}, local[s.id] || {}, s));
    S.subsLoaded = true;
  }
  if (d.user.role === 'teacher') {
    S.classes = d.classes || []; S.notifs = d.notifs || []; S.hidden = [];
    if (d.mine) { S.mine = Object.fromEntries(Object.entries(d.mine).map(([k, c]) => [k, toMine(c)])); S.mineLoaded = true; }
  } else {
    S.cid = d.cid; S.v = d.v;
    if (!d.same) {
      S.klass = d.cls; S.seat = d.seat; S.hidden = d.cls.hidden || [];
      S.mine = Object.fromEntries(Object.entries(d.mine || {}).map(([k, c]) => [k, toMine(c)]));
      S.cls = {}; S.ranks = {};
      for (const [pid, s] of Object.entries(d.sum || {})) { S.cls[pid] = { tried: s.t, ac: s.a, n: s.n }; S.ranks[pid] = s.r; }
      S.classmates = d.mates || {}; S.comments = d.comments || [];
    }
  }
  store.del('cj-token');
  saveState();
}
const hiddenSet = () => new Set(S && S.hidden || []);
const isHidden = p => { const h = hiddenSet(); return h.has(p.id) || h.has(p.series); };
const visibleProbs = () => isTeacher() ? PROBS : PROBS.filter(p => p.visible !== false && !isHidden(p));

// ============ 後端 ============
// Google 偶爾會把 POST 轉址成 GET，後端只會回「API 運作中」而沒有處理請求——這種情況一定可以安全地重送。
// 其他非 JSON 的錯誤網頁：讀取類的請求才重試；「送出評測」「留言」不自動重試，避免重複送出。
const NO_RETRY = /^\/api\/(submit|submissions\/\d+\/comments|submissions\/\d+\/rejudge|problems|class\/snapshot)$/;
async function api(path, body, opt = {}) {
  let data = null, lastErr = '';
  for (let i = 0; i < 4 && !data; i++) {
    if (i) await new Promise(r => setTimeout(r, 700 * i));
    let text;
    try {
      const r = await fetch(CFG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ method: opt.method || 'POST', path, query: opt.query || {}, body: body || null, token: S && S.token }),
      });
      text = await r.text();
    } catch (e) { lastErr = '無法連線到後端，請檢查網路後再試一次'; if (NO_RETRY.test(path)) break; continue; }
    try { data = JSON.parse(text); }
    catch {
      console.warn('後端回應不是 JSON：', path, text.slice(0, 500));
      if (/API 運作中/.test(text)) { lastErr = 'Google 伺服器暫時忙碌，請稍等幾秒再試一次'; continue; }   // 請求沒被處理，重送
      if (NO_RETRY.test(path)) i = 99;
      lastErr = path === '/api/submit'
        ? 'Google 伺服器暫時沒有正確回應。你的程式可能已經送出，請到「我的紀錄」或按右上角 🔄 確認，沒有的話再送一次。'
        : 'Google 伺服器暫時忙碌，請稍等幾秒再試一次';
    }
  }
  if (!data) throw new Error(lastErr);
  if (data.status === 401 && path !== '/api/login') {
    S = ANON(); store.del('cj-state'); store.del('cj-token'); location.hash = '#/login';
    throw new Error(data.error || '登入已過期，請重新登入');
  }
  if (data.error) { const e = new Error(data.error); e.status = data.status; throw e; }
  return data.data;
}
const apiGet = (path, query) => api(path, null, { method: 'GET', query });

// 背景同步：網頁打開時，距離上次同步超過 10 分鐘才做；不會擋住畫面
let syncing = null;
function backgroundSync(force) {
  if (!S || S.anon || syncing) return syncing;
  if (!force && Date.now() - (S.syncedAt || 0) < 10 * 60000) return null;
  const teacher = S.user && S.user.role === 'teacher';
  syncing = api('/api/sync', { cid: S.cid, v: S.v, pv: probsPv(), withMine: teacher && !S.mineLoaded, withSubs: !teacher && (force || !S.subsLoaded) }).then(d => {
    const before = probsPv();
    applySync(d); renderNav();
    const page = location.hash.split('?')[0].split('/')[1] || '';
    if ((!d.same || d.problems) && !isTeacher() && ['problems', 'submissions'].includes(page)) router();
    else if (d.problems && before !== d.pv && page === 'problems') router();
  }).catch(e => { if (force) toast(e.message); }).finally(() => { syncing = null; });
  return syncing;
}
// 沒有登入：題目資料從公開的 API 取得
async function ensureProblems(force) {
  if (loggedIn() && PROBS.length && !force) return false;
  if (PROBS.length && !force && Date.now() - (+store.get('cj-probs-at') || 0) < 10 * 60000) return false;
  const d = await api('/api/problems/public', { pv: probsPv() });
  store.set('cj-probs-at', String(Date.now()));
  if (d.same) return false;
  saveProblems(d.pv, d.problems);
  return true;
}

// ============ 友善的錯誤說明（中文） ============
const FULLWIDTH = { '（': '(', '）': ')', '，': ',', '：': ':', '＝': '=', '＂': '"', '＇': "'", '“': '"', '”': '"', '‘': "'", '’': "'", '＋': '+', '－': '-', '＊': '*', '／': '/', '；': ';', '［': '[', '］': ']', '｛': '{', '｝': '}', '＜': '<', '＞': '>', '。': '.', '．': '.', '　': '半形空白', '＃': '#', '％': '%' };
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
    else s += '請檢查拼字、大小寫，或是不是還沒有先設定這個變數。';
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
  worker: null, status: 'idle', readyPromise: null, seq: 0, pending: new Map(), listeners: new Set(),
  onStatus(fn) { this.listeners.add(fn); fn(this.status); return () => this.listeners.delete(fn); },
  emit(s) { this.status = s; this.listeners.forEach(f => f(s)); },
  start() {
    if (this.readyPromise) return this.readyPromise;
    this.emit('loading');
    this.readyPromise = (async () => {
      this.worker = new Worker('judge-worker.js');
      this.worker.onmessage = e => {
        const p = this.pending.get(e.data.id); if (!p) return;
        this.pending.delete(e.data.id);
        e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
      };
      await this.call({ type: 'init', url: CFG.PYODIDE_URL || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
      this.emit('ready');
    })().catch(e => { this.readyPromise = null; this.emit('error'); throw e; });
    return this.readyPromise;
  },
  call(msg) {
    return new Promise((resolve, reject) => { const id = ++this.seq; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); });
  },
  restart() {
    if (this.worker) this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('terminated'));
    this.pending.clear(); this.worker = null; this.readyPromise = null;
    return this.start();
  },
  busy: false,
  async check(code) {
    if (this.busy || this.status !== 'ready') return undefined;
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
      if (r === 'TLE') { this.restart().catch(() => { }); return { status: 'TLE', stdout: '', timeMs: timeLimitMs }; }
      if (r.status === 'OK' && r.timeMs > timeLimitMs) r.status = 'TLE';
      if (r.error) r.error.friendly = friendly(r.error);
      return r;
    } finally { this.busy = false; }
  },
  // 依題目全部測資評測，回傳要送到伺服器的資料
  async judgeAll(code, p, onProgress) {
    const tests = p.tests || [];
    const first = await this.run(code, tests[0] ? tests[0].input : '', p.timeLimitMs);
    if (first.status === 'CE') return { payload: { compileError: first.error }, error: first.error };
    const runs = [];
    for (let i = 0; i < tests.length; i++) {
      onProgress && onProgress(i + 1, tests.length);
      const r = i === 0 ? first : await this.run(code, tests[i].input, p.timeLimitMs);
      runs.push({ status: r.status === 'OK' ? 'OK' : r.status, stdout: r.stdout || '', timeMs: r.timeMs || 0, error: r.error || null });
    }
    return { payload: { runs }, error: (runs.find(r => r.error) || {}).error || null };
  },
};
function pyStatusText(s) {
  if (s === 'ready') return { cls: 'ready', text: '● Python 已就緒' };
  if (s === 'error') return { cls: 'bad', text: '✘ Python 載入失敗，請重新整理網頁' };
  return { cls: '', text: 'Python 環境載入中…（第一次使用需要下載約 10 MB）' };
}

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
  const cur = cm.getCursor(), line = cm.getLine(cur.line);
  let start = cur.ch; while (start > 0 && /\w/.test(line[start - 1])) start--;
  const word = line.slice(start, cur.ch);
  if (!word) return null;
  const lw = word.toLowerCase();
  const seen = new Set(PY_WORDS.map(w => w[0]));
  const vars = [];
  const text = cm.getValue().replace(/(['"]).*?\1|#.*$/gm, '');
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\b/g)) if (!seen.has(m[1]) && m[1] !== word) { seen.add(m[1]); vars.push([m[1], '變數', 'var']); }
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
    matchBrackets: true, autoCloseBrackets: !readOnly, styleActiveLine: !readOnly, readOnly: !!readOnly,
    gutters: ['err-gutter', 'CodeMirror-linenumbers'],
    extraKeys: {
      Tab: cm => cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    '),
      'Shift-Tab': cm => cm.indentSelection('subtract'),
      'Ctrl-Space': cm => cm.showHint({ hint: pythonHint, completeSingle: false }),
    },
  });
  if (!readOnly) {
    cm.on('inputRead', (cm, change) => {
      if (cm.state.completionActive || !/^[A-Za-z_]$/.test(change.text[0])) return;
      const tok = cm.getTokenAt(cm.getCursor());
      if (/string|comment/.test(tok.type || '')) return;
      cm.showHint({ hint: pythonHint, completeSingle: false });
    });
    if (onChange) cm.on('change', () => onChange(cm));
  }
  return cm;
}
// 程式碼文字放大／縮小（講解時用）：只改程式碼區的字，不影響整個網頁的版面
const ZOOM_MIN = 12, ZOOM_MAX = 40;
const codeFont = () => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +store.get('cj-fs') || 16));
const zoomButtons = () => `<span class="zoom" title="程式碼文字大小"><button class="btn sm" data-zoom="-2">A−</button><span class="zoom-val">${codeFont()}</span><button class="btn sm" data-zoom="2">A+</button></span>`;
function bindZoom(targets) {
  const apply = () => {
    const fs = codeFont();
    for (const t of targets()) {
      if (!t) continue;
      if (t.getWrapperElement) { t.getWrapperElement().style.fontSize = fs + 'px'; t.refresh(); }
      else t.style.fontSize = Math.round(fs * 0.9) + 'px';
    }
    $$('.zoom-val').forEach(el => el.textContent = fs);
  };
  $$('[data-zoom]').forEach(b => b.onclick = () => { store.set('cj-fs', codeFont() + +b.dataset.zoom); apply(); });
  apply();
}
// 投影模式：整個畫面只顯示程式碼（可以繼續編輯），方便上課講解；按 Esc 或「結束投影」離開
const presentButton = () => '<button class="btn sm" data-present title="全螢幕只顯示程式碼（按 Esc 結束）">⛶ 投影</button>';
function bindPresent(getCm) { $$('[data-present]').forEach(b => b.onclick = () => present(getCm())); }
function present(cm) {
  if (!cm || document.body.classList.contains('presenting')) return;
  const w = cm.getWrapperElement(), oldFs = w.style.fontSize;
  let fs = Math.min(72, Math.max(14, +store.get('cj-pfs') || 30));
  w.classList.add('cm-present'); document.body.classList.add('presenting');
  const bar = document.createElement('div'); bar.className = 'present-bar';
  bar.innerHTML = '<button data-pz="-4" title="縮小">A−</button><span></span><button data-pz="4" title="放大">A+</button><button data-pexit>✕ 結束投影（Esc）</button>';
  document.body.appendChild(bar);
  const apply = () => { w.style.fontSize = fs + 'px'; bar.querySelector('span').textContent = fs; cm.refresh(); };
  bar.querySelectorAll('[data-pz]').forEach(b => b.onclick = () => { fs = Math.min(72, Math.max(14, fs + +b.dataset.pz)); store.set('cj-pfs', fs); apply(); cm.focus(); });
  let done = false;
  const exit = () => {
    if (done) return; done = true;
    w.classList.remove('cm-present'); document.body.classList.remove('presenting'); bar.remove();
    w.style.fontSize = oldFs; cm.refresh();
    document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fsc);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  };
  const key = e => { if (e.key === 'Escape') exit(); };
  const fsc = () => { if (!document.fullscreenElement) exit(); };
  document.addEventListener('keydown', key);
  bar.querySelector('[data-pexit]').onclick = exit;
  try { document.documentElement.requestFullscreen().then(() => document.addEventListener('fullscreenchange', fsc)).catch(() => { }); } catch { }
  apply(); cm.focus();
}
// 標示錯誤行與全形符號
function markErrors(cm, err) {
  cm.clearGutter('err-gutter');
  (cm._lines || []).forEach(l => cm.removeLineClass(l, 'background', 'cm-error-line'));
  (cm._fw || []).forEach(m => m.clear());
  cm._lines = []; cm._fw = [];
  cm.eachLine(lh => {
    const ln = cm.getLineNumber(lh);
    for (const tok of cm.getLineTokens(ln)) {
      if (/string|comment/.test(tok.type || '')) continue;
      for (let i = 0; i < tok.string.length; i++) {
        const f = FULLWIDTH[tok.string[i]];
        if (f) cm._fw.push(cm.markText({ line: ln, ch: tok.start + i }, { line: ln, ch: tok.start + i + 1 }, { className: 'cm-fullwidth', title: `全形符號，請改成半形「${f}」` }));
      }
    }
  });
  if (err && err.line) {
    const l = Math.min(err.line - 1, cm.lineCount() - 1);
    cm._lines.push(cm.addLineClass(l, 'background', 'cm-error-line'));
    const mk = document.createElement('span'); mk.className = 'err-marker error'; mk.textContent = '●'; mk.title = err.friendly || friendly(err);
    cm.setGutterMarker(l, 'err-gutter', mk);
  }
}

// ============ 版面 ============
function renderNav() {
  const r = location.hash.split('?')[0].split('/')[1] || '';
  const links = !loggedIn() ? [['problems', '題目']] : [
    ['problems', '題目'], ['submissions', isTeacher() ? '解題動態' : '我的紀錄'],
    ...(isTeacher() ? [['live', '課堂看板'], ['scoreboard', '成績總表'], ['classes', '班級管理']] : []),
  ];
  $('#nav').innerHTML = links.map(([k, t]) => `<a href="#/${k}" class="${r === k || (r === 'problem' && k === 'problems') || (r === 'submission' && k === 'submissions') || (r === 'class' && k === 'classes') ? 'on' : ''}">${t}</a>`).join('');
  if (!loggedIn()) {
    $('#userbox').innerHTML = r === 'login' ? '' : '<a class="btn sm login-btn" href="#/login" id="toLogin">登入</a>';
    if ($('#toLogin')) $('#toLogin').onclick = () => store.set('cj-after-login', location.hash);
    return;
  }
  const n = notifList().length;
  $('#userbox').innerHTML = `
    <button class="bell" id="bell" title="${isTeacher() ? '學生的回覆' : '老師的回饋'}">🔔<span class="dot" ${n ? '' : 'style="display:none"'}>${n}</span></button>
    ${isTeacher() ? '' : '<button class="bell" id="syncBtn" title="重新整理成績與留言">🔄</button>'}
    <a href="#/me" class="who">${isTeacher() ? '👩‍🏫 ' : ''}${S.user.cls ? esc(S.user.cls) + ' ' : ''}${esc(S.user.name)}</a>
    <button class="btn sm" id="logout">登出</button>`;
  $('#logout').onclick = logout;
  $('#bell').onclick = toggleNotif;
  if ($('#syncBtn')) $('#syncBtn').onclick = async () => {
    const b = $('#syncBtn'); b.classList.add('spin');
    await backgroundSync(true); toast('已更新成績與留言');
  };
}
function notifList() {
  if (!loggedIn()) return [];
  if (isTeacher()) return S.notifs || [];
  return (S.comments || []).filter(c => c.role === 'teacher' && !c.read);
}
function toggleNotif() {
  const old = $('.notif-pop'); if (old) { old.remove(); return; }
  const list = notifList();
  const pid = id => { const s = (S.subs || []).find(x => x.id === id); return s ? s.pid : ''; };
  const pop = document.createElement('div'); pop.className = 'notif-pop';
  pop.innerHTML = list.length ? list.map(n => `<a href="#/submission/${n.submissionId}">
      <b>${esc(n.authorName)}</b> 在提交 #${n.submissionId} ${esc(pid(n.submissionId))} 留言${n.line ? `（第 ${n.line} 行）` : ''}：<br><span class="muted small">${esc(String(n.text).slice(0, 80))}</span></a>`).join('')
    : `<div style="padding:14px" class="muted">目前沒有新的回饋${isTeacher() ? '' : '<br><span class="small">按 🔄 可以檢查老師有沒有新的留言</span>'}</div>`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function h(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', h); } }), 0);
}
async function logout() {
  S = ANON(); store.del('cj-state'); store.del('cj-token');
  if (PROBS.some(p => p.visible === false)) { store.del('cj-probs'); applyProblems([]); }   // 老師看得到的不公開題目，不要留給下一位使用者
  try { google.accounts.id.disableAutoSelect(); } catch { }
  location.hash = '#/problems'; renderNav(); router();
}

// ============ 路由 ============
async function router() {
  clearPageTimers();
  $('.notif-pop')?.remove();
  const [, page = '', arg = ''] = location.hash.split('?')[0].split('/');
  if (!CFG.API_URL || /請貼上/.test(CFG.API_URL)) {
    app().innerHTML = '<div class="card"><h2>尚未設定</h2><p>請編輯 <code>config.js</code>，填入 Apps Script 網址（API_URL）與 Google 用戶端 ID（GOOGLE_CLIENT_ID）。</p></div>';
    return;
  }
  // 沒有登入：只能看題目（題目列表、解題頁），其他頁面先登入
  if (!loggedIn() && !['login', 'problems', 'problem'].includes(page)) { store.set('cj-after-login', location.hash); location.hash = '#/login'; return; }
  renderNav();
  const views = { login: viewLogin, problems: viewProblems, problem: viewProblem, submissions: viewSubmissions, submission: viewSubmission, scoreboard: viewScoreboard, classes: viewClasses, class: viewClass, me: viewMe, tests: viewTests, edit: viewEdit, live: viewLive };
  const v = views[page];
  if (!v) { location.hash = '#/problems'; return; }
  if (['scoreboard', 'classes', 'class', 'live', 'edit', 'tests'].includes(page) && !isTeacher()) { location.hash = '#/problems'; return; }
  try {
    if (!PROBS.length && page !== 'login') {   // 第一次打開網頁：先下載題目
      app().innerHTML = '<div class="loading">題目載入中…</div>';
      if (loggedIn()) await backgroundSync(true); else await ensureProblems(true);
      if (!PROBS.length) throw new Error('題目載入失敗，請重新整理網頁');
    }
    await v(decodeURIComponent(arg));
  } catch (e) {
    app().innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div><button class="btn primary" id="retryPage" style="margin-top:10px">↻ 重新載入</button></div>`;
    $('#retryPage').onclick = router;
    console.error(e);
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

// ============ 登入 ============
function viewLogin() {
  if (loggedIn()) { location.hash = '#/problems'; return; }
  app().innerHTML = `<div class="login-wrap"><div class="card" style="text-align:center">
    <h1>NEHS CodeJudge</h1><div class="muted">國中三年級資訊科技 · Python 線上解題系統</div>
    <div class="series-intro">${SERIES_KEYS.map(k => `<div><b>${esc(k)}</b><span>${PROBS.filter(p => p.series === k).length} 題</span></div>`).join('')}</div>
    <p style="margin:20px 0 12px">請使用<b>學校的 Google 帳號</b>登入${CFG.DOMAIN ? `<br><span class="muted small">（@${esc(CFG.DOMAIN)}）</span>` : ''}</p>
    <div id="gbtn" style="display:flex;justify-content:center;min-height:44px"><span class="muted">Google 登入按鈕載入中…</span></div>
    ${CFG.DEV_LOGIN ? '<div class="row" style="justify-content:center;margin-top:12px"><input type="text" id="devMail" placeholder="測試用 Email" style="width:220px"><button class="btn" id="devGo">測試登入</button></div>' : ''}
    <div class="err" id="lerr"></div>
    <p class="muted small">不登入也可以看題目、按「執行測試」練習；送出評測、記錄成績才需要登入。</p>
  </div></div>`;
  // 先叫醒後端（Apps Script 第一次呼叫比較慢），等學生按完 Google 登入時就已經準備好了
  fetch(CFG.API_URL, { mode: 'no-cors' }).catch(() => { });
  const finish = async credential => {
    $('#lerr').textContent = ''; $('#gbtn').innerHTML = '<span class="muted">登入中…</span>';
    try {
      const d = await api('/api/login', { credential, pv: probsPv() });
      S = { token: d.token, subs: [] };
      applySync(d);
      const back = store.get('cj-after-login'); store.del('cj-after-login');
      location.hash = back && !/login/.test(back) ? back : '#/problems';
      Judge.start().catch(() => { });
    } catch (err) { $('#lerr').textContent = err.message; renderBtn(); }
  };
  const renderBtn = () => {
    if (!window.google || !google.accounts || !$('#gbtn')) return;
    $('#gbtn').innerHTML = '';
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'zh-TW', width: 280 });
  };
  const init = (n = 0) => {
    if (!$('#gbtn')) return;
    if (!window.google || !google.accounts) { if (n < 50) setTimeout(() => init(n + 1), 200); else $('#gbtn').innerHTML = '<span class="err">Google 登入元件載入失敗，請重新整理</span>'; return; }
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: r => finish(r.credential), hd: CFG.DOMAIN || undefined, auto_select: true, ux_mode: 'popup' });
    renderBtn();
    google.accounts.id.prompt();
  };
  init();
  if (CFG.DEV_LOGIN) $('#devGo').onclick = () => finish('dev:' + $('#devMail').value.trim());
}

function viewMe() {
  const used = (() => { try { return Math.round(JSON.stringify(localStorage).length / 1024); } catch { return 0; } })();
  app().innerHTML = `<div class="login-wrap" style="max-width:560px"><div class="card">
    <h2>帳號資訊</h2>
    <p>${esc(S.user.name)}<br><span class="muted">${esc(S.user.email)}</span><br>${isTeacher() ? '老師' : `${esc(S.user.cls || '')} 班 ${S.user.seat || ''} 號`}</p>
    <p class="muted small">使用學校 Google 帳號登入，不需要另外設定密碼。登入狀態會保留 14 天；在公用電腦上使用完畢請記得按「登出」。<br>
      上次與伺服器同步：${S.syncedAt ? fmtTime(S.syncedAt) : '—'}</p>
    <h3>Python 執行環境</h3>
    <p id="pyInfo" class="small"></p>
    <p class="muted small">Python 執行環境（約 10 MB）第一次使用時下載，之後存在這台電腦的瀏覽器裡。這個瀏覽器目前為本網站存了約 ${used} KB 的資料（題目、草稿、提交紀錄）。</p>
  </div></div>`;
  const off = Judge.onStatus(s => { const el = $('#pyInfo'); if (!el) { off(); return; } el.textContent = s === 'idle' ? '尚未載入' : pyStatusText(s).text; });
}

// ============ 題目列表 ============
function myStat(p) { return (S.mine || {})[p.id] || null; }
// 學生的答題狀態：✔ 已完成／✘ 未通過／○ 尚未作答
const stateOf = p => { const m = myStat(p); return !m ? 'none' : m.ac ? 'ac' : 'wa'; };
function statusCell(p) {
  const m = myStat(p);
  if (!m) return '<span class="st st-none">○ 尚未作答</span>';
  if (m.ac) { const rk = rankOf(p.id); return `<span class="st st-ac">✔ 已完成</span>${rk ? ' ' + rankBadge(rk) : ''}`; }
  return `<span class="st st-wa">✘ 未通過</span> <span class="muted small">最高 ${m.best} 分・送出 ${m.tries} 次</span>`;
}
// ============ 作業期限 ============
// 截止時間可以設在題號或分類上：題目的截止時間 = 題號的設定，沒有就看所屬分類
const dueMap = () => (!isTeacher() && S.klass && S.klass.due) || {};
const dueOfPid = (pid, due) => { const p = PMAP[pid]; return (due || dueMap())[pid] || (p && (due || dueMap())[p.topic]) || 0; };
const isLate = p => { const m = myStat(p), d = dueOfPid(p.id); return !!(m && m.ac && d && m.firstAC > d); };
const pad2 = n => String(n).padStart(2, '0');
function dueText(ts, done) {
  if (!ts) return '';
  const d = new Date(ts), ms = ts - Date.now(), s = `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (done) return `<span class="due">⏰ 截止 ${s}</span>`;
  if (ms < 0) return `<span class="due over">⏰ 已截止（${s}）</span>`;
  const left = ms >= 86400000 ? `還有 ${Math.floor(ms / 86400000)} 天` : ms >= 3600000 ? `剩 ${Math.floor(ms / 3600000)} 小時` : '剩不到 1 小時';
  return `<span class="due ${ms < 86400000 ? 'soon' : ''}">⏰ 截止 ${s}（${left}）</span>`;
}
const toLocalInput = ts => { if (!ts) return ''; const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
// 成績只算截止前完成：把截止後才通過的格子當作「沒通過」，再重新排名次
function applyDue(students, due) {
  if (!due || !Object.keys(due).length) return students;
  const out = students.map(r => Object.assign({}, r, { cells: Object.fromEntries(Object.entries(r.cells).map(([pid, x]) => {
    const d = dueOfPid(pid, due);
    return [pid, d && x[2] > d ? [x[0], x[1], 0, x[3], 0, x[5]] : x.slice()];
  })) }));
  const pids = new Set(out.flatMap(r => Object.keys(r.cells)));
  pids.forEach(pid => out.filter(r => r.cells[pid] && r.cells[pid][2]).sort((a, b) => a.cells[pid][2] - b.cells[pid][2]).forEach((r, i) => r.cells[pid][4] = i + 1));
  return out;
}
// 題目列表最後一欄：只顯示有沒有完成
function doneCell(p) {
  const s = stateOf(p);
  return s === 'ac' ? `<span class="st st-ac">✔ 已完成${isLate(p) ? '（逾期）' : ''}</span>` : s === 'wa' ? '<span class="st st-wa">✘ 未完成</span>' : '<span class="st st-none">○ 未作答</span>';
}
// 通過人數／嘗試人數／送出次數：學生看本班；老師看目前選的班級（從成績總表資料計算，沒有變動時伺服器只回「沒變」）
let TSTATS = null;   // { cid, v, stats: { pid: { ac, tried, n } } }
const tClass = () => (S.classes || []).find(c => c.id === teacherCid());
const tClassName = () => (tClass() || {}).name || '';
const tHidden = p => { const h = new Set((tClass() || {}).hidden || []); return h.has(p.id) || h.has(p.series); };
function statOf(p) {
  if (!isTeacher()) return (S.cls || {})[p.id] || null;
  return TSTATS && TSTATS.cid === teacherCid() ? TSTATS.stats[p.id] || { ac: 0, tried: 0, n: 0 } : null;
}
async function loadTeacherStats() {
  const cid = teacherCid(); if (!cid) return false;
  const d = await apiGet('/api/scoreboard', { cid, v: TSTATS && TSTATS.cid === cid ? TSTATS.v : '' });
  if (d.same) return false;
  const stats = {};
  for (const r of d.students) for (const [pid, x] of Object.entries(r.cells)) {
    const s = stats[pid] || (stats[pid] = { ac: 0, tried: 0, n: 0 });
    s.tried++; s.n += x[1]; if (x[2]) s.ac++;
  }
  TSTATS = { cid, v: d.v, stats };
  return true;
}
// 老師設定的「各分類要完成的題數」與「指定必做題」
const unitGoals = () => (!isTeacher() && S.klass && S.klass.goals) || {};
const requiredSet = () => new Set((!isTeacher() && S.klass && S.klass.required) || []);
const isRequired = p => requiredSet().has(p.id);
// 目標：指定必做題都要完成，而且完成題數達到目標（目標比必做題少時，以必做題數為準）
function goalRule(topic, goals, required, probs) {
  const all = probs.filter(p => p.topic === topic);
  const req = all.filter(p => required.has(p.id)).map(p => p.id);
  const goal = Math.min(Math.max(+goals[topic] || 0, req.length), all.length);
  return { all, req, goal };
}
// timeOf(pid) → 首次通過時間（沒通過 = 0）
function goalStatus(rule, timeOf) {
  const times = rule.all.map(p => timeOf(p.id)).filter(Boolean).sort((a, b) => a - b);
  const done = times.length, reqTimes = rule.req.map(timeOf), reqDone = reqTimes.filter(Boolean).length;
  const met = rule.goal > 0 && reqDone === rule.req.length && done >= rule.goal;
  const progress = Math.min(rule.goal, reqDone + Math.min(done - reqDone, rule.goal - rule.req.length));
  return { done, goal: rule.goal, req: rule.req, reqDone, met, progress, extra: met ? done - rule.goal : 0,
    reach: met ? Math.max(times[rule.goal - 1], ...reqTimes) : 0 };
}
function unitProgress(topic, probs) {
  const rule = goalRule(topic, unitGoals(), requiredSet(), probs);
  return Object.assign({ all: rule.all }, goalStatus(rule, pid => { const m = (S.mine || {})[pid]; return m && m.ac ? m.firstAC || 1 : 0; }));
}
function rankOf(pid) {
  const list = (S.ranks || {})[pid] || [];
  const i = list.findIndex(r => r[0] === S.user.seat);
  return i >= 0 ? i + 1 : null;
}
function viewProblems() {
  const probs = visibleProbs();
  const series = SERIES_KEYS.filter(k => probs.some(p => p.series === k));
  let cur = store.get('cj-series');
  if (!series.includes(cur)) cur = series[0];
  const onlyTodo = store.get('cj-todo') === '1';
  const acCount = list => list.filter(p => myStat(p) && myStat(p).ac).length;
  const goalUnits = isTeacher() || !loggedIn() ? [] : series.map(t => Object.assign({ t }, unitProgress(t, probs))).filter(u => u.goal > 0);
  const metCount = goalUnits.filter(u => u.met).length;
  const reqList = probs.filter(isRequired), reqDone = reqList.filter(p => stateOf(p) === 'ac').length;
  const need = u => {   // 還差什麼
    const r = u.req.length - u.reqDone, more = Math.max(0, u.goal - u.done);
    return [r ? `必做題還差 ${r} 題` : '', more > r ? `總題數還差 ${more} 題` : ''].filter(Boolean).join('、');
  };
  app().innerHTML = `
    ${goalUnits.length || reqList.length ? `<div class="card goal-card"><div class="row"><h3 style="margin:0">📋 我的完成目標</h3>
        ${goalUnits.length ? `<span class="${metCount === goalUnits.length ? 'mine-ac' : 'muted'}">已達成 ${metCount} / ${goalUnits.length} 個目標</span>` : ''}
        <span class="muted small">完成老師指定的題數（⭐ 必做題一定要完成），就算達成目標。</span></div>
      ${reqList.length ? `<div class="req-box"><div class="row"><b>⭐ 老師指定必做題</b><span class="${reqDone === reqList.length ? 'mine-ac' : 'mine-tried'}">已完成 ${reqDone} / ${reqList.length} 題</span>
          ${reqDone < reqList.length ? '<span class="muted small">（灰色、紅色的還沒完成，點一下就可以去寫）</span>' : '<span class="mine-ac">🎉 全部完成！</span>'}</div>
        <div class="req-chips">${reqList.map(p => `<a class="req-chip ${stateOf(p)}" href="#/problem/${p.id}">${stateOf(p) === 'ac' ? '✔' : stateOf(p) === 'wa' ? '✘' : '○'} ${p.id} ${esc(p.title)}${isLate(p) ? ' <small>逾期</small>' : stateOf(p) !== 'ac' && dueOfPid(p.id) ? ' ' + dueText(dueOfPid(p.id)) : ''}</a>`).join('')}</div></div>` : ''}
      ${goalUnits.length ? `<div class="goal-list">${goalUnits.map(u => `<a href="javascript:void 0" class="goal ${u.met ? 'met' : ''}" data-unit="${esc(u.t)}">
        <b>${esc(u.t)}</b><span class="small muted">目標 ${u.goal} 題${u.req.length ? `（含 ⭐ 必做 ${u.req.length} 題）` : ''}</span>
        <span class="bar"><i style="width:${Math.min(100, u.progress / u.goal * 100)}%"></i></span>
        <span class="small">${u.met ? `✔ 已達成（完成 ${u.done} 題${u.extra ? `，多做 ${u.extra} 題` : ''}）` : `已完成 ${u.done} 題，<b class="mine-tried">${need(u)}</b>`}</span>
        ${dueMap()[u.t] ? `<span class="small">${u.met && u.reach > dueMap()[u.t] ? '<span class="due over">逾期達成</span>' : dueText(dueMap()[u.t], u.met)}</span>` : ''}</a>`).join('')}</div>` : ''}</div>` : ''}
    <div class="card">
      <div class="series-tabs">${series.map(k => {
        const list = probs.filter(p => p.series === k), ac = acCount(list);
        const gs = goalUnits.filter(u => u.t === k), gm = gs.filter(u => u.met).length;
        return `<button data-s="${esc(k)}" class="${k === cur ? 'on' : ''}"><b>${esc(k)}</b>
          <span class="small">${esc(SERIES_DESC[k] || '')}</span>
          ${loggedIn() ? `<span class="bar"><i style="width:${list.length ? ac / list.length * 100 : 0}%"></i></span><span class="small">${isTeacher() ? '我' : ''}已完成 ${ac} / ${list.length} 題${gs.length ? `　目標 ${gm ? '✔ 已達成' : '未達成'}` : ''}</span>` : `<span class="small">${list.length} 題</span>`}</button>`;
      }).join('')}</div>
      <div class="row" style="margin-top:12px">
        <input type="text" id="q" placeholder="搜尋題號、題目、標籤…" style="width:240px">
        ${isTeacher() || !loggedIn() ? '' : `<label class="small"><input type="checkbox" id="todo" ${onlyTodo ? 'checked' : ''}> 只顯示還沒完成的</label>
          ${reqList.length ? `<label class="small"><input type="checkbox" id="onlyReq" ${store.get('cj-onlyreq') === '1' ? 'checked' : ''}> 只顯示 ⭐ 必做題</label>` : ''}
          <span class="small legend"><span class="st st-ac">✔ 已完成</span><span class="st st-wa">✘ 未通過</span><span class="st st-none">○ 尚未作答</span></span>`}
        <span class="spacer"></span>
        ${isTeacher() && teacherClasses().length ? `<span class="small">統計班級 ${classSelect('tCls', teacherCid())}</span>` : ''}
        ${isTeacher() ? '<a class="btn primary" href="#/edit/">＋ 新增題目</a>' : ''}
        ${loggedIn() && !isTeacher() && S.syncedAt ? `<span class="muted small">本班資料更新於 ${fmtTime(S.syncedAt, true)}</span>` : ''}
      </div>
    </div>
    <div id="plist"></div>`;
  const render = () => {
    const q = ($('#q').value || '').trim().toLowerCase(), todo = $('#todo') && $('#todo').checked, onlyReq = $('#onlyReq') && $('#onlyReq').checked;
    const list = probs.filter(p => p.series === cur && (!q || (p.id + p.title + p.tags.join(' ')).toLowerCase().includes(q))
      && (!todo || !(myStat(p) && myStat(p).ac)) && (!onlyReq || isRequired(p)));
    const all = probs.filter(p => p.series === cur), u = unitProgress(cur, probs);
    const wa = all.filter(p => stateOf(p) === 'wa').length, none = all.filter(p => stateOf(p) === 'none').length;
    $('#plist').innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">${esc(cur)}</h3>
        ${!loggedIn() ? `<span class="small muted">共 ${all.length} 題</span>` : isTeacher() ? `<span class="small">我已完成 <b class="mine-ac">${u.done}</b> / ${all.length} 題${tHidden({ id: '', series: cur }) ? ` · <b class="mine-tried">${esc(tClassName())} 隱藏中</b>` : ''}</span>`
          : `${u.goal ? `<span class="unit-goal ${u.met ? 'met' : ''}">${u.met ? '✔ 已達成目標' : `目標 ${u.goal} 題${u.req.length ? `（⭐ 必做 ${u.req.length}）` : ''}・${need(u)}`}</span>` : ''}
             <span class="small">已完成 <b class="mine-ac">${u.done}</b> / ${all.length}${wa ? `・<span class="mine-tried">未通過 ${wa}</span>` : ''}${none ? `・<span class="muted">尚未作答 ${none}</span>` : ''}</span>`}</div>
      ${list.length ? `<div class="table-wrap"><table class="list plist"><thead><tr><th style="width:64px">題號</th><th>題目</th><th style="width:80px">難度</th>
        ${!loggedIn() ? '' : `<th style="width:150px" title="${isTeacher() ? esc(tClassName()) : '本班'}通過人數 / 嘗試人數（通過率）">通過 / 嘗試</th><th style="width:90px">送出次數</th><th style="width:120px">完成</th>`}</tr></thead><tbody>
      ${list.map(p => { const st = statOf(p); return `<tr data-go="${p.id}" class="row-${stateOf(p)}">
        <td class="pid">${p.id}</td>
        <td>${isRequired(p) ? '<span class="req-tag" title="老師指定一定要完成">⭐ 必做</span> ' : ''}<a href="#/problem/${p.id}"><b>${esc(p.title)}</b></a> ${p.tags.slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          ${isTeacher() && p.visible === false ? '<span class="tag hid" title="「題目」工作表的「公開」是 FALSE">不公開</span>' : ''}${isTeacher() && tHidden(p) ? '<span class="tag hid" title="這個班級看不到這一題">隱藏</span>' : ''}</td>
        <td>${stars(p.difficulty)}</td>
        ${!loggedIn() ? '' : `<td class="small">${st ? `${st.ac} / ${st.tried} 人 <span class="muted">${st.tried ? Math.round(st.ac / st.tried * 100) + '%' : ''}</span>` : '<span class="muted">—</span>'}</td>
        <td class="small">${st && st.n !== undefined ? st.n + ' 次' : '<span class="muted">—</span>'}</td>
        <td>${doneCell(p)}</td>`}
      </tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">沒有符合的題目。</p>'}</div>`;
    $$('tr[data-go]').forEach(tr => tr.onclick = e => { if (!e.target.closest('a')) location.hash = '#/problem/' + tr.dataset.go; });
  };
  $$('.series-tabs button').forEach(b => b.onclick = () => { cur = b.dataset.s; store.set('cj-series', cur); $$('.series-tabs button').forEach(x => x.classList.toggle('on', x === b)); render(); });
  $('#q').oninput = render;
  if ($('#todo')) $('#todo').onchange = () => { store.set('cj-todo', $('#todo').checked ? '1' : '0'); render(); };
  if ($('#onlyReq')) $('#onlyReq').onchange = () => { store.set('cj-onlyreq', $('#onlyReq').checked ? '1' : '0'); render(); };
  render();
  if (isTeacher()) {   // 老師：統計數字依目前選的班級，在背景載入
    if ($('#tCls')) $('#tCls').onchange = e => { store.set('cj-tcid', e.target.value); render(); loadTeacherStats().then(ch => ch && $('#plist') && render()).catch(() => { }); };
    loadTeacherStats().then(ch => ch && $('#plist') && render()).catch(() => { });
  }
  if (!loggedIn()) ensureProblems().then(ch => ch && location.hash.startsWith('#/problems') && viewProblems()).catch(() => { });
  // 點目標卡片：切換到那個分類
  $$('[data-unit]').forEach(a => a.onclick = () => { const b = $(`.series-tabs button[data-s="${a.dataset.unit}"]`); if (b) b.click(); });
}

// ============ 題目頁（解題） ============
let LESSON_CODES = [];
function renderLesson(text) {
  LESSON_CODES = [];
  const parts = String(text).split(/```(?:python|py)?\n?([\s\S]*?)```/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/\n$/, ''), idx = LESSON_CODES.push(code) - 1;
      return `<div class="lcode"><div class="lcode-bar"><span>Python</span><span class="spacer"></span>
        <button class="btn sm" data-lcopy="${idx}">📋 複製</button><button class="btn sm" data-lput="${idx}">↪ 放到編輯器</button></div>
        <pre class="cm-s-default">${highlightPy(code)}</pre></div>`;
    }
    const lines = part.replace(/^\n+|\n+$/g, '').split('\n');
    let html = '', buf = [], table = [];
    const flushP = () => { if (buf.length) html += `<p>${buf.map(esc).join('<br>')}</p>`; buf = []; };
    const flushT = () => {
      if (table.length) html += `<table class="ltable">${table.map((r, ri) => `<tr>${r.map(c => ri === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
      table = [];
    };
    for (const line of lines) {
      if (/^\s*\|/.test(line)) { flushP(); table.push(line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, '|'))); }
      else if (!line.trim()) { flushT(); flushP(); }
      else { flushT(); buf.push(line); }
    }
    flushT(); flushP();
    return html;
  }).join('');
}
function highlightPy(code) {
  if (!CodeMirror.runMode) return esc(code);
  let out = '';
  CodeMirror.runMode(code, 'python', (txt, style) => { out += style ? `<span class="cm-${style.split(' ').join(' cm-')}">${esc(txt)}</span>` : esc(txt); });
  return out;
}

async function viewProblem(id) {
  const list = visibleProbs();
  const p = PMAP[id];
  if (!p || !list.includes(p)) { app().innerHTML = `<div class="card"><h2>找不到題目 ${esc(id)}</h2><p>這一題可能還沒有開放。</p><a class="btn" href="#/problems">← 回題目列表</a></div>`; return; }
  Judge.start().catch(() => { });
  const idx = list.indexOf(p), prev = list[idx - 1], next = list[idx + 1];
  const draftKey = `cj-draft-${S.user.account}-${p.id}`;   // 和第 1 版相同的草稿名稱，舊的草稿會保留
  const pendingLoad = sessionStorage.getItem('cj-load-code');
  sessionStorage.removeItem('cj-load-code');
  // 訪客時寫的程式，登入後接著用
  const anonDraft = loggedIn() ? store.get(`cj-draft-guest-${p.id}`) : null;
  if (anonDraft !== null && !store.get(draftKey)) store.set(draftKey, anonDraft);
  if (loggedIn()) store.del(`cj-draft-guest-${p.id}`);
  const initial = pendingLoad ?? store.get(draftKey) ?? '';
  const sameSeries = list.filter(x => x.series === p.series);
  const navBar = where => `<div class="pnav ${where}">
      <a class="btn" href="#/problems">← 題目列表</a>
      ${prev ? `<a class="btn" href="#/problem/${prev.id}" title="${esc(prev.id + ' ' + prev.title)}">‹ 上一題</a>` : '<span class="btn" disabled>‹ 上一題</span>'}
      ${next ? `<a class="btn ${where === 'bottom' ? 'primary' : ''}" href="#/problem/${next.id}" title="${esc(next.id + ' ' + next.title)}">下一題 ›</a>` : '<span class="btn" disabled>下一題 ›</span>'}
      <span class="spacer"></span>
      ${where === 'top' ? `<span class="muted small pcount">${esc(p.series)} 第 ${sameSeries.indexOf(p) + 1} / ${sameSeries.length} 題</span>
        <select class="jump" title="跳到其他題目">${list.map(x => `<option value="${x.id}" ${x === p ? 'selected' : ''}>${x.id} ${esc(x.title)}${myStat(x) && myStat(x).ac ? ' ✔' : ''}</option>`).join('')}</select>`
        : next ? `<span class="muted small">下一題：${next.id} ${esc(next.title)}</span>` : ''}
    </div>`;

  app().innerHTML = `
  ${navBar('top')}
  <div class="problem-layout">
    <div>
      <div class="card">
        <div class="ptitle"><span class="pid">${p.id}</span><h2 style="margin:0">${esc(p.title)}</h2>${loggedIn() && !isTeacher() ? (isRequired(p) ? '<span class="req-tag">⭐ 老師指定必做</span> ' : '') + statusCell(p) : ''}${isLate(p) ? ' <span class="due over">逾期完成</span>' : dueOfPid(p.id) ? ' ' + dueText(dueOfPid(p.id), stateOf(p) === 'ac') : ''}
          ${isTeacher() && p.visible === false ? '<span class="tag hid">不公開</span>' : ''}<span class="spacer"></span>
          ${isTeacher() ? `<a class="btn sm" href="#/tests/${p.id}">🔍 測資與解答</a> <a class="btn sm" href="#/edit/${p.id}">✏ 編輯題目</a>` : ''}</div>
        <div class="muted small" style="margin:4px 0 10px">${esc(p.series)} · ${stars(p.difficulty)} · 時間限制 ${p.timeLimitMs / 1000} 秒 · 滿分 ${p.points} · ${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${p.lesson ? `<details class="lesson" ${store.get('cj-lesson-closed') === '1' ? '' : 'open'}><summary>📘 程式碼介紹</summary><div class="lesson-body">${renderLesson(p.lesson)}</div></details>` : ''}
        <h3>題目內容</h3><div class="pbody">${esc(p.content)}</div>
        <h3>輸入說明</h3><div class="pbody">${esc(p.inputDesc)}</div>
        <h3>輸出說明</h3><div class="pbody">${esc(p.outputDesc)}</div>
        ${(p.samples || []).map((s, i) => `<h3>範例 ${i + 1}</h3><div class="sample">
          <div class="box"><div class="h">範例輸入<span class="spacer"></span><a href="javascript:void 0" data-copy-in="${i}">放到測試輸入</a></div><pre>${esc(s.input) || '<span class="muted">（無）</span>'}</pre></div>
          <div class="box"><div class="h">範例輸出</div><pre>${esc(s.output)}</pre></div></div>`).join('')}
        ${p.hint ? `<h3>提示</h3><div class="hintbox">${esc(p.hint)}</div>` : ''}
        <div id="classHints">${hintsBoxHtml(p)}</div>
      </div>
      ${!loggedIn() ? `<div class="card login-hint"><b>想記錄成績、看本班排名嗎？</b> <a href="#/login" id="hintLogin">登入</a>後送出評測，系統會記錄你的完成狀態。</div>` : `<div class="card">
        <div class="tabs" id="ptabs"><button data-t="mine" class="on">${isTeacher() ? '我的測試' : '我的提交'}</button><button data-t="rank">🏆 ${isTeacher() ? '完成名次' : '本班完成名次'}</button>${isTeacher() ? '<button data-t="students">全班狀況</button><button data-t="analysis">📊 錯誤分析</button><button data-t="hints">💡 本班提示</button>' : ''}</div>
        <div id="ptab"></div>
      </div>`}
      ${navBar('bottom')}
    </div>
    <div>
      <div class="card editor-card">
        <div class="toolbar">
          <b>Python 程式碼</b><span class="cc-status" id="pyst"></span><span class="spacer"></span>
          ${zoomButtons()}${presentButton()}
          <button class="btn sm" id="btnReset" title="清除編輯器裡的程式">↺ 清除</button>
          <button class="btn" id="btnRun" title="Ctrl + Enter">▶ 執行測試</button>
          <button class="btn primary" id="btnSubmit">送出評測</button>
        </div>
        <div id="editor"></div>
        <div class="lint" id="lint"></div>
        <div class="io-grid">
          <div><label>測試輸入（每行對應一次 input( )）</label><textarea id="stdin" spellcheck="false">${esc(p.samples && p.samples[0] ? p.samples[0].input : '')}</textarea></div>
          <div><label>執行結果 <span id="cmpRes"></span></label><pre class="out" id="stdout"></pre></div>
        </div>
        <div class="muted small" style="margin-top:4px">💡 打字時會自動跳出 Python 關鍵字（也可按 Ctrl+空白鍵）；評測時 input( ) 的提示文字不會輸出。程式會自動存成草稿。「執行測試」不會記錄成績，「送出評測」才會。</div>
        <div id="result"></div>
      </div>
    </div>
  </div>`;

  $$('.jump').forEach(s => s.onchange = () => { location.hash = '#/problem/' + s.value; });
  const lessonEl = $('details.lesson');
  if (lessonEl) lessonEl.ontoggle = () => store.set('cj-lesson-closed', lessonEl.open ? '0' : '1');
  if ($('#hintLogin')) $('#hintLogin').onclick = () => store.set('cj-after-login', location.hash);

  const saveKey = loggedIn() ? draftKey : `cj-draft-guest-${p.id}`;
  const cm = createEditor($('#editor'), initial || (loggedIn() ? '' : store.get(saveKey) || ''), { onChange: cm => { store.set(saveKey, cm.getValue()); scheduleLint(); } });
  setTimeout(() => cm.refresh(), 0);

  // 停止打字 0.6 秒後檢查語法（Python 環境空閒時才做）
  let lintTimer;
  const lintBox = err => {
    const box = $('#lint'); if (!box) return;
    if (err === null) { box.className = 'lint'; box.textContent = ''; return; }
    if (err) { box.className = 'lint bad'; box.textContent = '⚠ ' + (err.friendly || friendly(err)); }
    else { box.className = 'lint good'; box.textContent = '✔ 語法檢查通過'; }
  };
  async function lint() {
    const code = cm.getValue();
    if (!code.trim()) { markErrors(cm, null); lintBox(null); return; }
    const err = await Judge.check(code).catch(() => undefined);
    if (err === undefined || cm.getValue() !== code) return;
    markErrors(cm, err); lintBox(err || false);
  }
  function scheduleLint() { clearTimeout(lintTimer); lintTimer = setTimeout(lint, 600); }

  const off = Judge.onStatus(s => {
    const el = $('#pyst'); if (!el) { off(); return; }
    const st = pyStatusText(s);
    el.className = 'cc-status ' + st.cls; el.textContent = st.text;
    if (s === 'ready') lint();
  });

  $$('[data-copy-in]').forEach(a => a.onclick = () => { $('#stdin').value = p.samples[+a.dataset.copyIn].input; });
  $$('[data-lcopy]').forEach(b => b.onclick = async () => {
    const code = LESSON_CODES[+b.dataset.lcopy];
    try { await navigator.clipboard.writeText(code); } catch { const t = document.createElement('textarea'); t.value = code; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast('已複製程式碼');
  });
  $$('[data-lput]').forEach(b => b.onclick = () => {
    const code = LESSON_CODES[+b.dataset.lput];
    if (cm.getValue().trim() && !confirm('要用範例程式碼取代編輯器裡目前的程式嗎？\n（按「取消」則插入到游標位置）')) cm.replaceSelection(code);
    else cm.setValue(code);
    cm.focus(); toast('已放到編輯器，可以按「執行測試」試試看');
  });
  bindZoom(() => [cm, $('#stdin'), $('#stdout')]);
  bindPresent(() => cm);
  $('#btnReset').onclick = () => { if (confirm('確定要清除編輯器裡的程式嗎？')) { cm.setValue(''); cm.focus(); } };

  const busy = on => { $('#btnRun').disabled = $('#btnSubmit').disabled = on; };
  async function run() {
    const out = $('#stdout'); busy(true);
    $('#cmpRes').innerHTML = '';
    out.innerHTML = `<span class="muted">${Judge.status === 'ready' ? '執行中…' : '等待 Python 環境載入…（第一次使用需要下載）'}</span>`;
    try {
      const input = $('#stdin').value;
      const r = await Judge.run(cm.getValue(), input, p.timeLimitMs);
      let html = esc(r.stdout || '');
      if (r.status === 'CE' || r.status === 'RE') {
        markErrors(cm, r.error); lintBox(r.error);
        html += `<span class="e">${html ? '\n' : ''}✘ ${r.status === 'CE' ? '語法錯誤' : '執行錯誤'}\n${esc(r.error.friendly)}\n(${esc(r.error.type)}: ${esc(r.error.msg)})</span>`;
      } else if (r.status === 'TLE') html += `<span class="e">\n✘ 執行超過 ${p.timeLimitMs / 1000} 秒。可能是無窮迴圈，或測試輸入的行數不夠（input( ) 讀不到資料）。</span>`;
      else if (r.status === 'OLE') html += '<span class="e">\n✘ 輸出資料過多（是不是無窮迴圈一直輸出？）</span>';
      else if (!r.stdout) html = '<span class="muted">（程式沒有輸出任何東西）</span>';
      out.innerHTML = html + (r.status !== 'TLE' && r.timeMs != null ? `\n<span class="muted">— 執行時間 ${r.timeMs} ms</span>` : '');
      const sample = (p.samples || []).find(s => normalize(s.input) === normalize(input));
      if (sample && r.status === 'OK') $('#cmpRes').innerHTML = normalize(r.stdout) === normalize(sample.output) ? '<span class="mine-ac">✔ 和範例輸出相同</span>' : '<span class="mine-tried">✘ 和範例輸出不同</span>';
    } catch (e) { out.innerHTML = `<span class="e">${esc(e.message)}</span>`; }
    finally { busy(false); }
  }
  $('#btnRun').onclick = run;
  cm.setOption('extraKeys', { ...cm.getOption('extraKeys'), 'Ctrl-Enter': run });

  $('#btnSubmit').onclick = async () => {
    const code = cm.getValue();
    if (!code.trim()) { toast('請先寫程式'); return; }
    if (!loggedIn()) {   // 訪客：程式已經自動存成草稿，登入後回到這一題就可以送出
      $('#result').innerHTML = `<div class="result-box"><b>送出評測需要先登入。</b>你的程式已經自動存在這台電腦，登入後回到這一題就能送出。<br>
        <a class="btn primary" style="margin-top:8px" href="#/login" id="goLogin">登入</a>　<span class="muted small">「▶ 執行測試」不用登入也可以使用。</span></div>`;
      $('#goLogin').onclick = () => store.set('cj-after-login', location.hash);
      return;
    }
    busy(true);
    const res = $('#result');
    res.innerHTML = '<div class="result-box">評測中…</div>';
    try {
      const j = await Judge.judgeAll(code, p, (i, n) => { res.innerHTML = `<div class="result-box">評測中… 第 ${i} / ${n} 組測資</div>`; });
      res.innerHTML = '<div class="result-box">上傳結果中…</div>';
      const d = await api('/api/submit', { problemId: p.id, code, pver: p.ver, cid: S.cid, ...j.payload });
      recordSubmission(p, d.submission, d);
      res.innerHTML = renderResult(d.submission, p, next);
      markErrors(cm, d.submission.error); lintBox(d.submission.verdict === 'CE' ? d.submission.error : null);
      res.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if ($('#classHints')) $('#classHints').innerHTML = hintsBoxHtml(p);   // 答錯次數增加，可能解鎖新的提示
      refreshTab();
    } catch (e) {
      res.innerHTML = `<div class="result-box err">${esc(e.message)}</div>`;
      if (e.status === 409) backgroundSync(true).then(() => toast('題目已更新，請重新送出')).catch(() => { });
    }
    finally { busy(false); }
  };

  // 下方分頁
  let tab = 'mine';
  $$('#ptabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('#ptabs button').forEach(x => x.classList.toggle('on', x === b)); refreshTab(); });
  let statusCache = null;
  async function refreshTab(fetch) {
    const el = $('#ptab'); if (!el) return;
    if (tab === 'mine') {
      const subs = (S.subs || []).filter(s => s.pid === p.id);
      const m = myStat(p), c = (S.cls || {})[p.id] || { ac: 0, tried: 0 }, rk = rankOf(p.id);
      el.innerHTML = (isTeacher() ? '' : `<div class="statgrid">
          <div class="stat"><b>${c.ac}</b><span>本班通過人數</span></div><div class="stat"><b>${c.tried}</b><span>本班嘗試人數</span></div>
          ${m ? `<div class="stat"><b class="${m.ac ? 'mine-ac' : 'mine-tried'}">${m.best}</b><span>我的最高分</span></div><div class="stat"><b>${m.tries}</b><span>我送出的次數</span></div>` : ''}
          ${m && m.ac ? `<div class="stat"><b style="font-size:14px">${fmtTime(m.firstAC)}</b><span>首次通過時間</span></div>` : ''}
          ${rk ? `<div class="stat"><b>${rk <= 3 ? ['🥇', '🥈', '🥉'][rk - 1] : ''}${rk}</b><span>我在本班的完成名次</span></div>` : ''}</div>`)
        + (subs.length ? subTable(subs, { hideUser: true, hideProblem: true }) : '<p class="muted">還沒有送出過這一題。</p>');
    } else if (tab === 'rank') {
      if (isTeacher()) { await teacherStatus(fetch !== false, true); return; }
      const list = (S.ranks || {})[p.id] || [];
      el.innerHTML = `<p class="muted small">依「第一次通過的時間」排序，只顯示你們班。${S.syncedAt ? `（資料時間 ${fmtTime(S.syncedAt, true)}，按右上角 🔄 可以更新）` : ''}</p>` +
        (list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>名次</th><th>座號</th><th>姓名</th><th>完成時間</th><th>送出幾次才通過</th></tr></thead><tbody>
          ${list.map((r, i) => `<tr class="${r[0] === S.user.seat ? 'me-row' : ''}"><td>${rankBadge(i + 1)}</td><td>${seat2(r[0])}</td><td>${esc((S.classmates || {})[r[0]] || '')}${r[0] === S.user.seat ? '（我）' : ''}</td>
            <td>${fmtTime(r[1])}</td><td>${r[2]} 次</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">還沒有人完成這一題，加油！</p>');
    } else if (tab === 'analysis') await teacherAnalysis();
    else if (tab === 'hints') teacherHints();
    else await teacherStatus(fetch !== false, false);
  }
  // 老師：錯誤分析（統計本班最近的提交）
  async function teacherAnalysis() {
    const el = $('#ptab'), cid = teacherCid();
    if (!cid) { el.innerHTML = '<p class="muted">名單裡還沒有班級。</p>'; return; }
    el.innerHTML = '<div class="loading">分析中…</div>';
    const a = await apiGet('/api/analysis/' + p.id, { cid });
    if (!$('#ptab') || tab !== 'analysis') return;
    el.innerHTML = renderAnalysis(a, p, classSelect('clsSel', cid));
    $('#clsSel').onchange = e => { store.set('cj-tcid', e.target.value); teacherAnalysis(); };
  }
  // 老師：本班提示（答錯幾次後才顯示）
  function teacherHints() {
    const el = $('#ptab'), cid = teacherCid();
    const cls = teacherClasses().find(c => c.id === cid);
    if (!cls) { el.innerHTML = '<p class="muted">名單裡還沒有班級。</p>'; return; }
    const all = JSON.parse(JSON.stringify(cls.hints || {}));
    let list = all[p.id] || [];
    const draw = () => {
      el.innerHTML = `<div class="row" style="margin-bottom:8px">班級：${classSelect('clsSel', cid)}<span class="muted small">學生答錯（送出沒有通過）達到指定次數後，題目頁會出現這個提示；設 0 次 = 一開始就顯示。</span></div>
        ${list.map((h, i) => `<div class="hint-edit"><b>提示 ${i + 1}</b><span class="small">送出 <input type="number" min="0" max="99" value="${h.after}" data-hafter="${i}" style="width:60px"> 次還沒通過後顯示</span>
          <button class="btn sm danger" data-hrm="${i}">刪除</button><textarea rows="2" data-htext="${i}" style="font-family:inherit">${esc(h.text)}</textarea></div>`).join('') || '<p class="muted">這一題還沒有本班提示。</p>'}
        <div class="row" style="margin-top:8px"><button class="btn" id="hAdd">＋ 新增提示</button><span class="spacer"></span><button class="btn primary" id="hSave">儲存提示</button></div>`;
      $('#clsSel').onchange = e => { store.set('cj-tcid', e.target.value); teacherHints(); };
      $$('[data-hafter]').forEach(x => x.oninput = () => list[+x.dataset.hafter].after = +x.value || 0);
      $$('[data-htext]').forEach(x => x.oninput = () => list[+x.dataset.htext].text = x.value);
      $$('[data-hrm]').forEach(b => b.onclick = () => { list.splice(+b.dataset.hrm, 1); draw(); });
      $('#hAdd').onclick = () => { list.push({ after: list.length ? Math.max(...list.map(h => h.after)) + 2 : 3, text: '' }); draw(); };
      $('#hSave').onclick = async () => {
        all[p.id] = list.filter(h => h.text.trim());
        try {
          const r = await api('/api/class/update', { cid, hints: all });
          const k = S.classes.findIndex(c => c.id === cid); if (k >= 0) S.classes[k] = r.cls; saveState();
          toast('已儲存，學生下次同步時會看到'); list = (r.cls.hints || {})[p.id] || []; draw();
        } catch (e) { toast(e.message); }
      };
    };
    draw();
  }
  // 老師：全班狀況（每 20 秒自動更新）
  async function teacherStatus(doFetch, rankMode) {
    const el = $('#ptab');
    const cid = teacherCid();
    if (!cid) { el.innerHTML = '<p class="muted">名單裡還沒有班級，請在 Google 試算表的「學生名單」貼上學生資料。</p>'; return; }
    if (!statusCache) el.innerHTML = '<div class="loading">載入中…</div>';
    if (doFetch || !statusCache) statusCache = await apiGet('/api/problem-status/' + p.id, { cid });
    if (!$('#ptab') || tab === 'mine') return;
    const d = statusCache;
    const sel = classSelect('clsSel', cid);
    if (rankMode) {
      const list = d.students.filter(s => s.p && s.p.ac).sort((a, b) => a.rank - b.rank);
      el.innerHTML = `<div class="row" style="margin-bottom:8px">班級：${sel}<span class="muted small">每 20 秒自動更新</span></div>` + (list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>名次</th><th>班級座號</th><th>姓名</th><th>完成時間</th><th>次數</th><th></th></tr></thead><tbody>
        ${list.map(s => `<tr><td>${rankBadge(s.rank)}</td><td>${esc(s.cls)}-${seat2(s.seat)}</td><td>${esc(s.name)}</td><td>${fmtTime(s.p.firstAC)}</td><td>${s.p.triesToAC}</td><td><a href="#/submission/${s.p.acId}">看程式碼</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">還沒有人完成。</p>');
    } else {
      const st = d.students, tried = st.filter(s => s.p).length, ac = st.filter(s => s.p && s.p.ac).length;
      el.innerHTML = `<div class="row" style="margin-bottom:8px">班級：${sel}<span class="muted small">點「看程式碼」可以檢視並留言 · 每 20 秒自動更新</span></div>
        <div class="statgrid"><div class="stat"><b>${ac}</b><span>通過人數</span></div><div class="stat"><b>${tried}</b><span>嘗試人數</span></div><div class="stat"><b>${st.length - tried}</b><span>還沒作答</span></div></div>
        <div class="table-wrap"><table class="list"><thead><tr><th>班級座號</th><th>姓名</th><th>狀態</th><th>最高分</th><th>送出次數</th><th>首次通過</th><th></th></tr></thead><tbody>
        ${st.map(s => `<tr><td>${esc(s.cls)}-${seat2(s.seat)}</td><td>${esc(s.name)}</td>
          <td>${!s.p ? '<span class="muted">未作答</span>' : s.p.ac ? vBadge('AC') : vBadge(s.p.lastVerdict)}</td>
          <td>${s.p ? s.p.best : ''}</td><td>${s.p ? s.p.tries : ''}</td><td>${s.p && s.p.ac ? fmtTime(s.p.firstAC) : ''}</td>
          <td>${s.p ? `<a href="#/submission/${s.p.lastId}">看程式碼</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
    $('#clsSel').onchange = e => { store.set('cj-tcid', e.target.value); statusCache = null; refreshTab(); };
  }
  if (loggedIn()) refreshTab(false);
  if (isTeacher()) pageTimers.push(setInterval(() => { if (['rank', 'students'].includes(tab) && !document.hidden) refreshTab(); }, 20000));
}

// ============ 錯誤分析（老師） ============
function analysisTips(a) {
  const tips = [], n = Math.max(1, a.students), st = a.status, lv = a.lastVerdicts;
  const lat = Object.values(lv).reduce((x, y) => x + y, 0);
  if (st.none > n / 2) tips.push(`還有 ${st.none} 位同學（${Math.round(st.none / n * 100)}%）沒有作答，可以先確認大家是否看懂題目、知道從哪裡開始。`);
  if (lat) {
    const ce = lv.CE || 0, tle = lv.TLE || 0, re = lv.RE || 0;
    if (ce / lat >= 0.3) tips.push(`${ce} 位同學最後一次是「語法錯誤」${a.ce[0] ? `，最常見的是「${a.ce[0][0]}」` : ''}。建議帶大家檢查括號、引號、冒號、縮排與全形符號。`);
    if (tle / lat >= 0.2) tips.push(`${tle} 位同學「執行超時」：可能是無窮迴圈（while 的條件一直沒有改變），或多寫了 input( )。`);
    if (re / lat >= 0.2) tips.push(`${re} 位同學「執行錯誤」${a.re[0] ? `，最常見的是「${a.re[0][0]}」` : ''}。`);
    const t0 = a.testFail[0], r0 = t0 && t0.total ? t0.fail / t0.total : 0;
    if (r0 >= 0.4) tips.push(`有 ${t0.fail} 位同學連第 1 組（範例）都沒通過：常見原因是輸出格式（多了或少了空白、標點符號、全形半形）或題意理解錯誤，建議一起對照範例輸出。`);
    a.testFail.forEach((t, i) => {
      if (i > 0 && t.total && t.fail / t.total >= 0.4 && r0 < 0.3)
        tips.push(`多數同學通過範例，但第 ${i + 1} 組測資失敗率 ${Math.round(t.fail / t.total * 100)}%：可能沒考慮特殊情況（例如 0、負數、相等的情況），可以請同學想想看還有哪些情況。`);
    });
  }
  if (!tips.length) tips.push(st.AC >= n * 0.8 ? '大部分同學都完成了，可以請完成的同學挑戰下一題，或擔任小老師協助同學。' : '目前沒有特別集中的錯誤類型。');
  return tips;
}
function renderAnalysis(a, p, sel) {
  const n = Math.max(1, a.students), st = a.status, pct = x => Math.round(x / n * 100);
  const lat = Object.values(a.lastVerdicts).reduce((x, y) => x + y, 0);
  return `<div class="row" style="margin-bottom:8px">班級：${sel}<span class="muted small">分析本班最近 ${a.total} 筆提交；測資與錯誤以每位同學「最後一次提交」計算。</span></div>
    <div class="ana-bar"><i class="ac" style="width:${pct(st.AC)}%"></i><i class="wa" style="width:${pct(st.tried)}%"></i><i class="no" style="width:${pct(st.none)}%"></i></div>
    <div class="small legend" style="margin:4px 0 10px"><span class="st st-ac">✔ 完成 ${st.AC} 人</span><span class="st st-wa">✘ 還沒通過 ${st.tried} 人</span><span class="st st-none">○ 沒作答 ${st.none} 人</span></div>
    <div class="tips-box"><b>💡 講解建議</b><ul>${analysisTips(a).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    ${lat ? `<h4>每位同學最後一次的結果</h4><div class="legend">${Object.entries(a.lastVerdicts).sort((x, y) => y[1] - x[1]).map(([v, c]) => `${vBadge(v)} ${c} 人`).join('　')}</div>
    <h4>各組測資的失敗率</h4><table class="list ana-tests"><thead><tr><th>測資</th><th>失敗率</th><th>失敗原因</th></tr></thead><tbody>
      ${a.testFail.map((t, i) => { const r = t.total ? Math.round(t.fail / t.total * 100) : 0; return `<tr><td>#${i + 1} ${i === 0 ? '<span class="tag">範例</span>' : '<span class="tag hid">隱藏</span>'}</td>
        <td><div class="ana-mini"><i style="width:${r}%"></i></div> ${r}%（${t.fail} / ${t.total} 人）</td><td>${Object.entries(t.kinds).map(([k, c]) => `${vBadge(k)} ${c}`).join(' ')}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">本班還沒有人送出這一題。</p>'}
    ${a.ce.length ? `<h4>常見的語法錯誤</h4><ol class="ana-list">${a.ce.map(([m, c]) => `<li>${esc(m)} <b>× ${c}</b></li>`).join('')}</ol>` : ''}
    ${a.re.length ? `<h4>常見的執行錯誤</h4><ol class="ana-list">${a.re.map(([m, c]) => `<li>${esc(m)} <b>× ${c}</b></li>`).join('')}</ol>` : ''}`;
}
// 學生：老師設定的本班提示（答錯幾次後才出現）
function hintsBoxHtml(p) {
  const list = (((S.klass && S.klass.hints) || {})[p.id]) || [];
  if (!list.length || isTeacher() || !loggedIn()) return '';
  const m = myStat(p), wrong = m ? (m.ac ? 999 : m.tries) : 0;
  return '<h3>💡 老師的提示</h3>' + list.map((h, i) => wrong >= h.after
    ? `<div class="hintbox"><span class="muted small">提示 ${i + 1}</span><br>${esc(h.text)}</div>`
    : `<div class="hint-locked">🔒 提示 ${i + 1}：再送出 ${h.after - wrong} 次還沒通過，就會出現（你已送出 ${wrong} 次）。先自己試試看！</div>`).join('');
}
// 把送出的結果記在瀏覽器裡；伺服器同時回傳這一題最新的本班統計，不需要另外下載
function recordSubmission(p, sub, d) {
  S.subs = S.subs || [];
  S.subs.unshift(Object.assign({}, sub, { pid: p.id }));
  if (d.mine) {
    S.mine = S.mine || {}; S.cls = S.cls || {}; S.ranks = S.ranks || {};
    S.mine[p.id] = toMine(d.mine);
    if (d.sum) { S.cls[p.id] = { tried: d.sum.t, ac: d.sum.a, n: d.sum.n }; S.ranks[p.id] = d.sum.r; }
    if (d.v) S.v = d.v;
  }
  saveState();
}
// 老師目前選的班級
function teacherClasses() { return S.classes || []; }
function teacherCid() {
  const list = teacherClasses(), saved = store.get('cj-tcid');
  return (list.find(c => c.id === saved) || list[0] || {}).id || '';
}
const classSelect = (id, cid, withAll) => `<select id="${id}">${withAll ? '<option value="">全部班級</option>' : ''}${teacherClasses().map(c => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)} 班</option>`).join('')}</select>`;

function renderResult(s, p, next) {
  p = p || PMAP[s.pid];
  const tests = s.tests || [], err = s.error;
  return `<div class="result-box">
    <div class="result-head">${vBadge(s.verdict)}<b class="vtext ${s.verdict}">${VERDICT[s.verdict] || s.verdict}</b>
      <span>分數 <b>${s.score}</b> / ${s.maxScore || (p && p.points) || 100}</span>${s.verdict !== 'CE' ? `<span class="muted">最長耗時 ${s.timeMs} ms</span>` : ''}
      <span class="spacer"></span>${s.id ? `<a href="#/submission/${s.id}">提交 #${s.id} →</a>` : ''}</div>
    ${err && (err.friendly || err.msg) ? `<div class="friendly"><b>${s.verdict === 'CE' ? '語法錯誤' : '錯誤說明'}：</b>${esc(err.friendly || friendly(err))}<div class="muted small">${esc(err.type || '')}${err.msg ? ': ' + esc(err.msg) : ''}</div></div>` : ''}
    ${tests.map((t, i) => `<div class="test-row"><span>#${i + 1}${i === 0 ? '<small class="muted">範例</small>' : ''}</span>${vBadge(t.status)}<span class="muted" style="min-width:60px">${t.timeMs} ms</span><span style="min-width:44px">${t.score} 分</span><span class="msg">${esc(t.message || '')}</span></div>`).join('')}
    ${s.verdict === 'AC' ? `<div class="ac-banner">🎉 恭喜通過全部測資！${next ? `<a class="btn green" href="#/problem/${next.id}">挑戰下一題：${next.id} ${esc(next.title)} ›</a>` : ''}</div>` : ''}
  </div>`;
}
function subTable(list, { hideUser, hideProblem } = {}) {
  return `<div class="table-wrap"><table class="list"><thead><tr><th>編號</th>${hideUser ? '' : '<th>學生</th>'}${hideProblem ? '' : '<th>題目</th>'}<th>結果</th><th>分數</th><th>耗時</th><th>送出時間</th>${hideUser ? '' : '<th>留言</th>'}</tr></thead><tbody>
    ${list.map(s => `<tr>
      <td><a href="#/submission/${s.id}">#${s.id}</a></td>
      ${hideUser ? '' : `<td>${s.cls ? `${esc(s.cls)}-${seat2(s.seat)} ` : ''}${esc(s.name)}</td>`}
      ${hideProblem ? '' : `<td><a href="#/problem/${esc(s.pid)}">${esc(s.pid)} ${esc((PMAP[s.pid] || {}).title || '')}</a></td>`}
      <td><a href="#/submission/${s.id}">${vBadge(s.verdict)}</a></td>
      <td>${s.score}</td><td>${s.verdict === 'CE' ? '-' : s.timeMs + ' ms'}</td>
      <td>${fmtTime(s.time, true)}</td>${hideUser ? '' : `<td>${s.comments ? `💬 ${s.comments}` : ''}</td>`}</tr>`).join('')}
  </tbody></table></div>`;
}

// ============ 我的紀錄 / 解題動態 ============
async function viewSubmissions() {
  if (!isTeacher()) {
    const subs = S.subs || [];
    const fp = new URLSearchParams(location.hash.split('?')[1] || '').get('problem') || '';
    const solved = Object.values(S.mine || {}).filter(m => m.ac).length;
    app().innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">我的提交紀錄</h2><span class="spacer"></span>
      <span>已通過 <b class="mine-ac">${solved}</b> 題 · 共送出 ${subs.length} 次</span>
      <select id="fprob"><option value="">全部題目</option>${[...new Set(subs.map(s => s.pid))].sort().map(id => `<option value="${id}" ${id === fp ? 'selected' : ''}>${id} ${esc((PMAP[id] || {}).title || '')}</option>`).join('')}</select></div></div>
      <div class="card" id="subs"></div>`;
    const render = () => {
      const f = $('#fprob').value, list = subs.filter(s => !f || s.pid === f);
      $('#subs').innerHTML = list.length ? subTable(list.slice(0, 300), { hideUser: true }) : '<p class="muted">還沒有提交紀錄。（換了電腦的話，按右上角 🔄 可以下載伺服器上的紀錄）</p>';
    };
    $('#fprob').onchange = render; render();
    return;
  }
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  app().innerHTML = `<div class="card">
    <div class="row"><h2 style="margin:0">解題動態</h2><span class="spacer"></span>
      ${classSelect('fcls', '', true)}
      <select id="fprob"><option value="">全部題目</option>${PROBS.map(p => `<option value="${p.id}">${p.id} ${esc(p.title)}</option>`).join('')}</select>
      <select id="fv"><option value="">全部結果</option>${Object.entries(VERDICT).map(([k, v]) => `<option value="${k}">${k} ${v}</option>`).join('')}</select>
      <label class="small"><input type="checkbox" id="auto" checked> 每 20 秒自動更新</label>
    </div></div>
    <div class="card" id="subs"><div class="loading">載入中…</div></div>`;
  let page = 1;
  const f = { cid: q.cid ?? store.get('cj-feedcid') ?? '', problem: q.problem || '', verdict: q.verdict || '', account: q.account || '' };
  if (f.cid && !teacherClasses().some(c => c.id === f.cid)) f.cid = '';
  $('#fcls').value = f.cid; $('#fprob').value = f.problem; $('#fv').value = f.verdict;
  async function load() {
    const d = await apiGet('/api/feed', { ...f, page });
    if (!$('#subs')) return;
    $('#subs').innerHTML = (f.account ? `<p>只顯示 <b>${esc(f.account)}</b> 的提交 <a href="#/submissions">顯示全部</a></p>` : '') +
      (d.submissions.length ? subTable(d.submissions) : '<p class="muted">沒有資料</p>') +
      `<div class="pager">${page > 1 ? '<button class="btn sm" id="pgPrev">‹ 較新</button>' : ''}<span class="muted small">第 ${page} 頁</span>${d.more ? '<button class="btn sm" id="pgNext">較舊 ›</button>' : ''}</div>`;
    if ($('#pgPrev')) $('#pgPrev').onclick = () => { page--; load(); };
    if ($('#pgNext')) $('#pgNext').onclick = () => { page++; load(); };
  }
  $('#fcls').onchange = e => { f.cid = e.target.value; store.set('cj-feedcid', f.cid); page = 1; load(); };
  $('#fprob').onchange = e => { f.problem = e.target.value; page = 1; load(); };
  $('#fv').onchange = e => { f.verdict = e.target.value; page = 1; load(); };
  await load();
  pageTimers.push(setInterval(() => { if ($('#auto') && $('#auto').checked && page === 1 && !document.hidden) load().catch(() => { }); }, 20000));
}

// ============ 單筆提交（程式碼 + 留言） ============
async function viewSubmission(id) {
  id = +id;
  let s = !isTeacher() && (S.subs || []).find(x => x.id === id);
  let comments = !isTeacher() ? (S.comments || []).filter(c => c.submissionId === id) : null;
  if (!s || !s.code) {
    app().innerHTML = '<div class="loading">載入中…</div>';
    const d = await apiGet('/api/submissions/' + id);
    s = Object.assign({}, s || {}, d.submission);
    comments = d.comments;
    if (!isTeacher()) {   // 存起來，下次不用再下載
      const i = (S.subs || []).findIndex(x => x.id === id);
      if (i >= 0) S.subs[i] = Object.assign(S.subs[i], { code: s.code, tests: s.tests, error: s.error });
      S.comments = S.comments || [];
      comments.forEach(c => { if (!S.comments.some(x => x.id === c.id)) S.comments.push(c); });
      S.comments.forEach(c => { if (c.submissionId === id && c.role === 'teacher') c.read = true; });
      saveState(); renderNav();
    }
  } else {
    const unread = comments.filter(c => c.role === 'teacher' && !c.read);
    if (unread.length) {
      unread.forEach(c => c.read = true); saveState(); renderNav();
      api('/api/comments/read', { ids: unread.map(c => c.id) }).catch(() => { });
    }
  }
  if (isTeacher()) { S.notifs = (S.notifs || []).filter(n => n.submissionId !== id); saveState(); renderNav(); }
  const p = PMAP[s.pid];
  let selLine = null;
  app().innerHTML = `
  <div class="card">
    <div class="row"><h2 style="margin:0">提交 #${s.id}</h2>${vBadge(s.verdict)}<b class="vtext ${s.verdict}">${VERDICT[s.verdict]}</b><span class="spacer"></span>
      <a class="btn" href="#/problem/${esc(s.pid)}">回到題目</a>
      <button class="btn" id="loadEd">在編輯器中開啟這份程式</button>
      ${isTeacher() ? '<button class="btn" id="rejudge">重新評測</button>' : ''}</div>
    <table class="list" style="margin-top:12px"><tr><th>學生</th><th>題目</th><th>分數</th><th>耗時</th><th>送出時間</th></tr>
      <tr><td>${s.name ? `${s.cls ? esc(s.cls) + '-' + seat2(s.seat) + ' ' : ''}${esc(s.name)} <span class="muted small">${esc(s.account || '')}</span>` : esc(S.user.name)}${isTeacher() && s.account ? ` · <a href="#/submissions?account=${esc(s.account)}">他的所有提交</a>` : ''}</td>
      <td><a href="#/problem/${esc(s.pid)}">${esc(s.pid)} ${esc(p ? p.title : '')}</a></td>
      <td>${s.score} / ${s.maxScore || (p && p.points) || 100}</td><td>${s.verdict === 'CE' ? '-' : s.timeMs + ' ms'}</td><td>${fmtTime(s.time)}</td></tr></table>
  </div>
  <div class="problem-layout">
    <div class="card">
      <div class="row"><h3 style="margin:0">程式碼 ${isTeacher() ? '<span class="muted small">（點行號可以針對那一行留言）</span>' : ''}</h3><span class="spacer"></span>${zoomButtons()}${presentButton()}</div>
      <div id="code" class="readonly ${isTeacher() ? 'teacher' : ''}"></div>
      <h3>評測結果</h3>
      <div id="resbox">${renderResult(s, p)}</div>
    </div>
    <div class="card comments">
      <h3 style="margin-top:0">💬 ${isTeacher() ? '給學生的回饋' : '老師的回饋'}</h3>
      <div id="clist"></div>
      <div style="margin-top:10px">
        <div class="row small" id="lineSel" style="margin-bottom:4px"></div>
        <textarea id="ctext" rows="4" placeholder="${isTeacher() ? '寫下錯誤說明或建議，學生會在 🔔 看到…' : '有問題可以在這裡回覆老師…'}" style="font-family:inherit"></textarea>
        <div class="row" style="margin-top:6px"><span class="spacer"></span><button class="btn primary" id="csend">送出留言</button></div>
      </div>
    </div>
  </div>`;
  const cm = createEditor($('#code'), s.code || '', { readOnly: true });
  bindZoom(() => [cm]);
  bindPresent(() => cm);
  setTimeout(() => cm.refresh(), 0);
  markErrors(cm, s.error);
  const markComments = () => comments.forEach(c => c.line && c.line <= cm.lineCount() && cm.addLineClass(c.line - 1, 'background', 'cm-comment-line'));
  markComments();
  const showLineSel = () => {
    $('#lineSel').innerHTML = selLine ? `針對 <span class="linechip">第 ${selLine} 行</span> 留言 <a href="javascript:void 0" id="clrLine">取消</a>` : '';
    if (selLine) $('#clrLine').onclick = () => { selLine = null; showLineSel(); };
  };
  if (isTeacher()) cm.on('gutterClick', (cm, line) => { selLine = line + 1; showLineSel(); $('#ctext').focus(); });
  const renderComments = () => {
    $('#clist').innerHTML = comments.length ? comments.map(c => `<div class="c ${c.role}">
      <div class="meta">${c.role === 'teacher' ? '👩‍🏫 ' : ''}<b>${esc(c.authorName)}</b> · ${fmtTime(c.time)} ${c.line ? `· <span class="linechip" data-line="${c.line}">第 ${c.line} 行</span>` : ''}</div>
      <div class="txt">${esc(c.text)}</div></div>`).join('') : '<p class="muted">目前沒有留言。</p>';
    $$('[data-line]').forEach(el => el.onclick = () => { const l = +el.dataset.line - 1; cm.setCursor(l, 0); cm.scrollIntoView({ line: l, ch: 0 }, 80); });
  };
  renderComments();
  $('#csend').onclick = async () => {
    const text = $('#ctext').value.trim(); if (!text) return;
    const b = $('#csend'); b.disabled = true;
    try {
      const { comment } = await api(`/api/submissions/${s.id}/comments`, { text, line: selLine });
      comment.read = true;
      comments.push(comment);
      if (!isTeacher()) { S.comments = S.comments || []; S.comments.push(comment); saveState(); }
      $('#ctext').value = ''; selLine = null; showLineSel(); renderComments(); markComments();
      toast(isTeacher() ? '已送出，學生會在 🔔 看到' : '已送出');
    } catch (e) { toast(e.message); }
    b.disabled = false;
  };
  $('#loadEd').onclick = () => { sessionStorage.setItem('cj-load-code', s.code); location.hash = '#/problem/' + s.pid; };
  if (isTeacher()) $('#rejudge').onclick = async () => {
    if (!p) { toast('題目已刪除'); return; }
    const btn = $('#rejudge'); btn.disabled = true; btn.textContent = '評測中…';
    try {
      const j = await Judge.judgeAll(s.code, p);
      const r = await api(`/api/submissions/${s.id}/rejudge`, { pver: p.ver, ...j.payload });
      Object.assign(s, r.submission);
      $('#resbox').innerHTML = renderResult(s, p); toast('重新評測完成：' + s.verdict);
    } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = '重新評測';
  };
}

// ============ 成績總表（老師，每 20 秒檢查一次；沒有變動時伺服器只回「沒變」） ============
const GRADE_DEFAULT = { cond: 'ac', base: 60, bonus: 40, mode: 'linear', step: 2, partial: 'ratio', extra: 5, cap: 100, onTime: false };
const gradeCfg = () => Object.assign({}, GRADE_DEFAULT, store.json('cj-grade', {}));
// 換算一格的成績：有做 → 基本分；通過的再依本班完成名次加分
// cell = [最高分, 送出次數, 首次通過時間, 最後提交編號, 名次, 通過的提交編號]；n = 這一題本班通過人數
function gradeOf(cell, n, cfg) {
  if (!cell) return 0;
  const done = cfg.cond === 'ac' ? !!cell[2] : cfg.cond === 'score' ? cell[0] > 0 : cell[1] > 0;
  if (!done) return 0;
  let bonus = 0;
  if (cell[2] && cell[4]) bonus = cfg.mode === 'linear' ? (n <= 1 ? cfg.bonus : cfg.bonus * (n - cell[4]) / (n - 1)) : Math.max(0, cfg.bonus - (cell[4] - 1) * cfg.step);
  return Math.round((+cfg.base + bonus) * 10) / 10;
}
// 分類成績：完成題數達到老師設定的目標 → 基本分；再依「本班達到目標的時間」名次加分
function unitScores(students, goals, cfg, required) {
  const req = new Set(required || []);
  const units = SERIES_KEYS.filter(t => goalRule(t, goals, req, PROBS).goal > 0);
  const res = students.map(() => ({}));
  for (const t of units) {
    const rule = goalRule(t, goals, req, PROBS);
    const info = students.map(r => Object.assign({ rank: 0 }, goalStatus(rule, pid => r.cells[pid] ? r.cells[pid][2] : 0)));
    const met = info.filter(x => x.met).sort((a, b) => a.reach - b.reach);
    met.forEach((x, i) => x.rank = i + 1);
    info.forEach((x, i) => {
      x.score = x.met ? Math.min(cfg.cap, Math.round((gradeOf([100, 1, 1, 0, x.rank], met.length, cfg) + x.extra * cfg.extra) * 10) / 10)
        : cfg.partial === 'zero' ? 0 : Math.round(cfg.base * x.progress / x.goal * 10) / 10;
      res[i][t] = x;
    });
  }
  const avg = i => units.length ? Math.round(units.reduce((a, t) => a + res[i][t].score, 0) / units.length * 10) / 10 : 0;
  return { units, res, avg };
}
function downloadCsv(rows, name) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = String(name).replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 學期成績報表：通過題數、必做題、分類成績、每題最高分（依成績總表的換算設定）
function buildReport(sb, cfg) {
  const cls = sb.cls, students = cfg.onTime ? applyDue(sb.students, cls.due) : sb.students;
  const u = unitScores(students, cls.goals || {}, cfg, cls.required);
  const req = (cls.required || []).filter(id => PMAP[id]);
  const pids = PROBS.map(p => p.id).filter(pid => students.some(r => r.cells[pid]));
  const head = ['班級', '座號', '姓名', 'Email', '通過題數', ...(req.length ? [`⭐ 必做完成（共 ${req.length} 題）`] : []),
    ...(u.units.length ? ['目標平均', ...u.units.map(t => `${t} 目標成績`)] : []), ...pids.map(pid => `${pid} ${PMAP[pid].title}`)];
  return [head, ...students.map((r, i) => [cls.name, r.seat, r.name, r.email, Object.values(r.cells).filter(x => x[2]).length,
    ...(req.length ? [req.filter(id => r.cells[id] && r.cells[id][2]).length] : []),
    ...(u.units.length ? [u.avg(i), ...u.units.map(t => u.res[i][t].score)] : []),
    ...pids.map(pid => r.cells[pid] ? r.cells[pid][0] : '')])];
}
async function viewScoreboard() {
  if (!teacherClasses().length) { app().innerHTML = '<div class="card"><h2>成績總表</h2><p>名單裡還沒有學生，請在 Google 試算表的「學生名單」工作表貼上：班級、座號、姓名、Email。</p></div>'; return; }
  let cid = teacherCid();
  let series = store.get('cj-sb-series') || '';
  if (series && !SERIES_KEYS.includes(series)) series = '';
  let mode = store.get('cj-sb-mode') || 'raw';
  const cfg = gradeCfg();
  app().innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">成績總表</h2><span class="spacer"></span>
    <label class="small"><input type="checkbox" id="auto" checked> 每 20 秒自動更新</label>
    <button class="btn" id="csv">⬇ 下載 CSV（Excel）</button>
    <button class="btn" id="toSheet">寫入 Google Sheet</button></div>
    <div class="tabs cls-tabs" id="clsTabs" style="margin:12px 0 0">${teacherClasses().map(c => `<button data-c="${esc(c.id)}" class="${c.id === cid ? 'on' : ''}">${esc(c.name)} 班</button>`).join('')}</div>
    <div class="row" style="margin-top:8px">分類：<select id="sbSeries"><option value="">全部題目</option>${SERIES_KEYS.map(k => `<option value="${esc(k)}" ${k === series ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      顯示：<select id="sbMode"><option value="raw" ${mode === 'raw' ? 'selected' : ''}>原始分數</option><option value="grade" ${mode === 'grade' ? 'selected' : ''}>每題換算成績</option><option value="unit" ${mode === 'unit' ? 'selected' : ''}>目標成績（依分類目標題數）</option></select>
      <span class="muted small">綠＝通過、橘＝部分得分、紅＝0 分；點格子看最後一次的程式碼。<span class="online"></span>＝2 分鐘內有活動</span></div>
    <details class="grade-box" ${mode !== 'raw' ? 'open' : ''}><summary>📊 成績換算設定（完成的給基本分，再依完成名次加分）</summary>
      <div class="grade-grid">
        <label>截止時間</label><label><input type="checkbox" id="gOnTime"> 只計算截止前完成的（截止後才通過的當作沒通過）</label>
        <label>目標成績：額外題目</label><div>超過目標的題目，每多完成 1 題加 <input type="number" id="gExtra" min="0" max="100" step="0.5" style="width:70px"> 分；每個分類最高 <input type="number" id="gCap" min="0" max="1000" style="width:80px"> 分</div>
        <label>目標成績：沒達到目標</label><select id="gPartial"><option value="ratio">依完成比例給基本分（例：目標 5 題做了 3 題 → 基本分 × 3/5）</option><option value="zero">0 分</option></select>
        <label>每題換算：怎樣算「有做」</label><select id="gCond"><option value="ac">通過（AC）</option><option value="score">有得分（部分正確也算）</option><option value="tried">有送出就算</option></select>
        <label>有做的基本分</label><input type="number" id="gBase" min="0" max="100" style="width:90px">
        <label>名次加分最多</label><input type="number" id="gBonus" min="0" max="100" style="width:90px">
        <label>名次加分方式</label><div><select id="gMode"><option value="linear">依名次比例：第 1 名加滿分，最後一位通過的加 0 分</option><option value="step">每差一名少幾分</option></select>
          <span id="gStepBox">　每名少 <input type="number" id="gStep" min="0" max="100" step="0.5" style="width:70px"> 分（最少 0 分）</span></div>
      </div>
      <p class="muted small" id="gExample"></p>
      <p class="muted small">每題換算：名次依「本班第一次通過這一題的時間」排序，只有通過的同學有名次加分，「平均」是目前選擇範圍內所有題目的平均。<br>
        目標成績：只計算有設定「目標題數」的分類（在 <a href="#/class/${esc(cid)}">班級管理</a> 設定）。完成題數達到目標 → 基本分；名次依「本班達到目標的時間」排序加分；超過目標的題目每題再加分（不超過最高分）。每題換算最高 <b id="gMax"></b> 分。</p>
    </details></div>
    <div id="sb"><div class="card loading">載入中…</div></div>`;
  $('#gCond').value = cfg.cond; $('#gBase').value = cfg.base; $('#gBonus').value = cfg.bonus; $('#gMode').value = cfg.mode; $('#gStep').value = cfg.step; $('#gPartial').value = cfg.partial || 'ratio';
  $('#gExtra').value = cfg.extra ?? 5; $('#gCap').value = cfg.cap ?? 100; $('#gOnTime').checked = !!cfg.onTime;
  const readCfg = () => {
    const c = { cond: $('#gCond').value, base: +$('#gBase').value || 0, bonus: +$('#gBonus').value || 0, mode: $('#gMode').value, step: +$('#gStep').value || 0, partial: $('#gPartial').value,
      extra: +$('#gExtra').value || 0, cap: $('#gCap').value === '' ? 100 : +$('#gCap').value, onTime: $('#gOnTime').checked };
    store.set('cj-grade', JSON.stringify(c));
    $('#gStepBox').style.display = c.mode === 'step' ? '' : 'none';
    $('#gMax').textContent = c.base + c.bonus;
    const ex = n => Array.from({ length: Math.min(n, 5) }, (_, i) => gradeOf([100, 1, 1, 0, i + 1], n, c));
    $('#gExample').textContent = `例：某題全班有 10 人通過 → 第 1～5 名分別得 ${ex(10).join('、')} 分…；沒通過但${c.cond === 'ac' ? '（不算有做）得 0 分' : '有做得 ' + c.base + ' 分'}；沒做 0 分。`;
    return c;
  };
  readCfg();
  let last = null;
  const probsNow = () => PROBS.filter(p => !series || p.series === series);
  const studs = () => readCfg().onTime ? applyDue(last.students, last.cls.due) : last.students;
  const acCountOf = pid => studs().filter(r => r.cells[pid] && r.cells[pid][2]).length;
  // 表格資料（下載與寫入 Google Sheet 共用）
  const tableRows = () => {
    const ps = probsNow(), c = readCfg(), cls = last.cls.name;
    if (mode === 'unit') {
      const u = unitScores(studs(), last.cls.goals || {}, c, last.cls.required);
      const head = ['班級', '座號', '姓名', 'Email', ...u.units.flatMap(t => [`${t} 完成題數（目標 ${u.res[0] ? u.res[0][t].goal : ''}）`, `${t} 成績`]), '達到目標數', `目標平均（每項 ${c.base + c.bonus} 分）`];
      return [head, ...studs().map((r, i) => [cls, r.seat, r.name, r.email, ...u.units.flatMap(t => [u.res[i][t].done, u.res[i][t].score]), u.units.filter(t => u.res[i][t].met).length, u.avg(i)])];
    }
    const n = Object.fromEntries(ps.map(p => [p.id, acCountOf(p.id)]));
    const head = ['班級', '座號', '姓名', 'Email', ...ps.map(p => `${p.id} ${p.title}`), '通過題數', '原始總分', `換算平均（每題 ${c.base + c.bonus} 分）`, '換算總分'];
    const rows = studs().map(r => {
      const raw = ps.map(p => r.cells[p.id] ? r.cells[p.id][0] : ''), g = ps.map(p => gradeOf(r.cells[p.id], n[p.id], c));
      const gsum = g.reduce((a, b) => a + b, 0);
      return [cls, r.seat, r.name, r.email, ...(mode === 'grade' ? g : raw), ps.filter(p => r.cells[p.id] && r.cells[p.id][2]).length,
        raw.reduce((a, b) => a + (+b || 0), 0), ps.length ? Math.round(gsum / ps.length * 10) / 10 : 0, Math.round(gsum * 10) / 10];
    });
    return [head, ...rows];
  };
  $('#csv').onclick = () => { if (last) downloadCsv(tableRows(), `成績_${last.cls.name}_${series || '全部題目'}_${{ grade: '每題換算', unit: '目標成績', raw: '原始分數' }[mode]}.csv`); };
  $('#toSheet').onclick = async () => {
    if (!last) return;
    const b = $('#toSheet'); b.disabled = true;
    try { toast((await api('/api/scoreboard/sheet', { cid, rows: tableRows() })).msg, 4000); } catch (e) { toast(e.message); }
    b.disabled = false;
  };
  const online = t => t && Date.now() - t < 120000;
  const renderUnit = () => {
    const rows = studs(), c = readCfg(), u = unitScores(rows, last.cls.goals || {}, c, last.cls.required);
    if (!u.units.length) { $('#sb').innerHTML = `<div class="card"><div class="friendly"><b>${esc(last.cls.name)} 班還沒有設定目標題數。</b>請到 <a href="#/class/${esc(cid)}">班級管理</a> 填寫 A 系列、B 系列各要完成幾題。</div></div>`; return; }
    $('#sb').innerHTML = !rows.length ? '<div class="card">這個班級還沒有學生。</div>' : `<div class="card"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">${esc(last.cls.name)} 班　目標成績</h2>
      <span class="muted">${rows.length} 人 · ${u.units.length} 個目標 · 全部達標 ${rows.filter((r, i) => u.units.every(t => u.res[i][t].met)).length} 人</span></div>
    <div class="table-wrap"><table class="list sb unit-sb"><thead><tr><th class="name">座號</th><th class="name">姓名</th><th>達標</th><th>目標平均</th>
      ${u.units.map(t => `<th class="u">${esc(t)}<br><span class="muted small">目標 ${u.res[0][t].goal} 題</span></th>`).join('')}</tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td class="name">${seat2(r.seat)}</td><td class="name"><span class="${online(r.lastSeen) ? 'online' : 'offline'}"></span>${esc(r.name)}</td>
        <td><b>${u.units.filter(t => u.res[i][t].met).length}</b> / ${u.units.length}</td><td><b>${u.avg(i)}</b></td>
        ${u.units.map(t => { const x = u.res[i][t]; return `<td><span class="cell ${x.met ? 'ac' : x.done ? 'part' : 'zero'}" title="${esc(t)}｜完成 ${x.done} / 目標 ${x.goal} 題${x.req.length ? '｜⭐ 必做完成 ' + x.reqDone + ' / ' + x.req.length : ''}${x.extra ? '（多做 ' + x.extra + ' 題）' : ''}${x.met ? '｜達標時間 ' + fmtTime(x.reach) + '｜本班第 ' + x.rank + ' 位達標' : ''}">${x.score}<small>${x.done}/${x.goal}${x.extra ? ' +' + x.extra : ''}${x.met ? ' · #' + x.rank : ''}</small></span></td>`; }).join('')}</tr>`).join('')}
      </tbody><tfoot><tr><th class="name" colspan="4">達標人數</th>${u.units.map(t => `<th>${rows.filter((r, i) => u.res[i][t].met).length}</th>`).join('')}</tr></tfoot></table></div></div>`;
  };
  const render = () => {
    if (!last || !$('#sb')) return;
    if (mode === 'unit') return renderUnit();
    const ps = probsNow(), rows = studs(), c = readCfg();
    const n = Object.fromEntries(ps.map(p => [p.id, acCountOf(p.id)]));
    const acs = r => ps.filter(p => r.cells[p.id] && r.cells[p.id][2]).length;
    const sum = r => mode === 'grade' ? Math.round(ps.reduce((a, p) => a + gradeOf(r.cells[p.id], n[p.id], c), 0) / Math.max(1, ps.length) * 10) / 10
      : ps.reduce((a, p) => a + (r.cells[p.id] ? r.cells[p.id][0] : 0), 0);
    $('#sb').innerHTML = !rows.length ? `<div class="card"><p>這個班級還沒有學生。</p></div>` :
      `<div class="card"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">${esc(last.cls.name)} 班</h2>
      <span class="muted">${rows.length} 人 · 平均通過 ${(rows.reduce((a, r) => a + acs(r), 0) / rows.length).toFixed(1)} 題</span></div>
    <div class="table-wrap"><table class="list sb"><thead><tr><th class="name">座號</th><th class="name">姓名</th><th>通過</th><th>${mode === 'grade' ? '換算平均' : '總分'}</th>
      ${ps.map(p => `<th class="p" title="${esc(p.title)}"><a href="#/problem/${p.id}">${p.id}</a></th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name">${seat2(r.seat)}</td>
        <td class="name"><span class="${online(r.lastSeen) ? 'online' : 'offline'}"></span><a href="#/submissions?account=${esc(r.account)}&cid=${esc(cid)}">${esc(r.name)}</a></td>
        <td><b>${acs(r)}</b></td><td>${sum(r)}</td>
        ${ps.map(p => {
          const x = r.cells[p.id]; if (!x) return '<td></td>';
          const g = gradeOf(x, n[p.id], c);
          return `<td><a class="cell ${x[2] ? 'ac' : x[0] > 0 ? 'part' : 'zero'}" href="#/submission/${x[3]}" title="${esc(p.id + ' ' + p.title)}｜最高 ${x[0]} 分｜送出 ${x[1]} 次${x[2] ? '｜首次通過 ' + fmtTime(x[2]) + '｜本班第 ' + x[4] + ' 名' : ''}｜換算 ${g} 分">${mode === 'grade' ? g : x[2] ? '✔' : x[0]}</a></td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody><tfoot><tr><th class="name" colspan="4">通過人數</th>${ps.map(p => `<th>${n[p.id]}</th>`).join('')}</tr></tfoot></table></div></div>`;
  };
  async function load(full) {
    const d = await apiGet('/api/scoreboard', { cid, v: full || !last ? '' : last.v });
    if (d.same) {   // 沒有變動：只更新上線狀態
      const seen = Object.fromEntries(d.seen);
      last.students.forEach(r => r.lastSeen = seen[r.seat] || r.lastSeen);
      $$('#sb td.name span.online, #sb td.name span.offline').forEach((el, i) => { const r = last.students[i]; if (r) el.className = online(r.lastSeen) ? 'online' : 'offline'; });
      return;
    }
    last = d; render();
  }
  $$('#clsTabs button').forEach(b => b.onclick = () => { cid = b.dataset.c; store.set('cj-tcid', cid); $$('#clsTabs button').forEach(x => x.classList.toggle('on', x === b)); last = null; $('#sb').innerHTML = '<div class="card loading">載入中…</div>'; load(true); });
  $('#sbSeries').onchange = e => { series = e.target.value; store.set('cj-sb-series', series); render(); };
  $('#sbMode').onchange = e => { mode = e.target.value; store.set('cj-sb-mode', mode); if (mode !== 'raw') $('.grade-box').open = true; render(); };
  ['gCond', 'gBase', 'gBonus', 'gMode', 'gStep', 'gPartial', 'gExtra', 'gCap', 'gOnTime'].forEach(id => $('#' + id).oninput = $('#' + id).onchange = render);
  await load(true);
  pageTimers.push(setInterval(() => { if ($('#auto') && $('#auto').checked && !document.hidden) load().catch(() => { }); }, 20000));
}

// ============ 即時課堂看板（老師投影用，每 15 秒更新；資料沒變時伺服器只回「沒變」） ============
async function viewLive() {
  if (!teacherClasses().length) { app().innerHTML = '<div class="card"><h2>課堂看板</h2><p>名單裡還沒有學生。</p></div>'; return; }
  let cid = teacherCid();
  let set = store.get('cj-live-set') || 'required';
  const unitOpts = SERIES_KEYS.map(k => `<option value="unit:${esc(k)}">分類：${esc(k)}</option>`).join('');
  app().innerHTML = `<div class="card live-ctl"><div class="row"><h2 style="margin:0">📺 課堂看板</h2>
      班級 ${classSelect('lvCls', cid)}
      題目 <select id="lvSet"><option value="required">⭐ 本班必做題</option><option value="active">最近有人做的題目</option><option value="ids">自己輸入題號</option>${unitOpts}</select>
      <input type="text" id="lvIds" placeholder="例如 a001, a003, a017" style="width:200px;display:none" value="${esc(store.get('cj-live-ids') || '')}">
      卡住＝錯 <input type="number" id="lvStuck" min="1" max="20" value="${+store.get('cj-live-stuck') || 3}" style="width:52px"> 次以上
      <span class="spacer"></span><span class="muted small" id="lvTime"></span><button class="btn primary" id="lvFull">⛶ 全螢幕投影</button></div></div>
    <div id="live"><div class="card loading">載入中…</div></div>`;
  $('#lvSet').value = set; if (!$('#lvSet').value) { set = 'required'; $('#lvSet').value = set; }
  $('#lvIds').style.display = set === 'ids' ? '' : 'none';
  let sb = null, feed = [];
  const stuckN = () => Math.max(1, +$('#lvStuck').value || 3);
  const pidsNow = () => {
    if (set === 'required') return ((sb && sb.cls.required) || []).filter(id => PMAP[id]);
    if (set === 'ids') return $('#lvIds').value.split(/[,，\s]+/).map(s => s.trim()).filter(id => PMAP[id]);
    if (set.startsWith('unit:')) return PROBS.filter(p => p.series === set.slice(5)).map(p => p.id);
    return [...new Set(feed.map(s => s.pid))].filter(id => PMAP[id]).slice(0, 12).sort();   // 最近有人做的
  };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分鐘前` : fmtTime(t, true); };
  const render = () => {
    if (!sb || !$('#live')) return;
    const pids = pidsNow(), rows = sb.students, n = rows.length, k = stuckN();
    if (!pids.length) { $('#live').innerHTML = `<div class="card"><p>${set === 'required' ? '本班還沒有指定必做題，請改選分類或自己輸入題號（也可以到班級管理設定必做題）。' : set === 'active' ? '最近還沒有人送出。' : '請輸入題號。'}</p></div>`; return; }
    const stuck = [];
    rows.forEach(r => pids.forEach(pid => { const x = r.cells[pid]; if (x && !x[2] && x[1] >= k) stuck.push([r, pid, x[1]]); }));
    stuck.sort((a, b) => b[2] - a[2]);
    $('#live').innerHTML = `<div class="live-wrap"><div class="live-main card">
      <div class="live-sum">${pids.map(pid => { const done = rows.filter(r => r.cells[pid] && r.cells[pid][2]).length; return `<div><b>${pid}</b> <span>${esc(PMAP[pid].title)}</span>
        <span class="bar"><i style="width:${n ? done / n * 100 : 0}%"></i></span><span class="big">${done}<small> / ${n} 人完成</small></span></div>`; }).join('')}</div>
      <div class="table-wrap"><table class="live-grid"><thead><tr><th class="name">座號</th><th class="name">姓名</th><th>完成</th>${pids.map(pid => `<th title="${esc(PMAP[pid].title)}">${pid}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => { const done = pids.filter(pid => r.cells[pid] && r.cells[pid][2]).length; return `<tr class="${done === pids.length ? 'all-done' : ''}"><td class="name">${seat2(r.seat)}</td>
        <td class="name"><span class="${r.lastSeen && Date.now() - r.lastSeen < 120000 ? 'online' : 'offline'}"></span>${esc(r.name)}</td><td><b>${done}</b>/${pids.length}</td>
        ${pids.map(pid => { const x = r.cells[pid]; if (!x) return '<td><span class="lc none"></span></td>';
          if (x[2]) return `<td><span class="lc ac">✔${x[4] && x[4] <= 3 ? `<small>${['🥇', '🥈', '🥉'][x[4] - 1]}</small>` : ''}</span></td>`;
          return `<td><span class="lc ${x[1] >= k ? 'stuck' : 'wa'}">${x[1] >= k ? '⚠' : '✘'}<small>${x[1]}</small></span></td>`; }).join('')}</tr>`; }).join('')}
      </tbody></table></div>
      <div class="live-legend"><span class="lc ac">✔</span>完成　<span class="lc wa">✘</span>還沒通過（數字＝送出次數）　<span class="lc stuck">⚠</span>卡住（錯 ${k} 次以上）　<span class="lc none"></span>還沒作答</div></div>
      <div class="live-side">
        <div class="card"><h3 style="margin-top:0">🆘 需要協助（${stuck.length}）</h3>${stuck.length ? stuck.slice(0, 12).map(([r, pid, t]) => `<div class="help-row"><b>${seat2(r.seat)} ${esc(r.name)}</b><span>${pid} 錯 ${t} 次</span>${r.cells[pid][3] ? `<a href="#/submission/${r.cells[pid][3]}">看程式</a>` : ''}</div>`).join('') : '<p class="muted">目前沒有人卡住 👍</p>'}</div>
        <div class="card"><h3 style="margin-top:0">🕒 最新動態</h3>${feed.slice(0, 12).map(s => `<div class="feed-row">${vBadge(s.verdict)}<b>${esc(s.name)}</b><span>${esc(s.pid)}</span><span class="muted small">${ago(s.time)}</span></div>`).join('') || '<p class="muted">還沒有人送出。</p>'}</div>
      </div></div>`;
    $('#lvTime').textContent = '更新於 ' + fmtTime(Date.now(), true);
  };
  async function load(full) {
    const [d, f] = await Promise.all([apiGet('/api/scoreboard', { cid, v: full || !sb ? '' : sb.v }), apiGet('/api/feed', { cid })]);
    feed = f.submissions || [];
    if (d.same) { const seen = Object.fromEntries(d.seen); sb.students.forEach(r => r.lastSeen = seen[r.seat] || r.lastSeen); }
    else sb = d;
    render();
  }
  $('#lvCls').onchange = e => { cid = e.target.value; store.set('cj-tcid', cid); sb = null; $('#live').innerHTML = '<div class="card loading">載入中…</div>'; load(true).catch(e => toast(e.message)); };
  $('#lvSet').onchange = e => { set = e.target.value; store.set('cj-live-set', set); $('#lvIds').style.display = set === 'ids' ? '' : 'none'; render(); };
  $('#lvIds').oninput = () => { store.set('cj-live-ids', $('#lvIds').value); render(); };
  $('#lvStuck').oninput = () => { store.set('cj-live-stuck', $('#lvStuck').value); render(); };
  $('#lvFull').onclick = () => {
    document.body.classList.toggle('live-full');
    if (document.body.classList.contains('live-full')) { try { document.documentElement.requestFullscreen().catch(() => { }); } catch { } $('#lvFull').textContent = '✕ 結束投影'; }
    else { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); $('#lvFull').textContent = '⛶ 全螢幕投影'; }
  };
  const leave = () => { document.body.classList.remove('live-full'); window.removeEventListener('hashchange', leave); };
  window.addEventListener('hashchange', leave);
  await load(true);
  pageTimers.push(setInterval(() => { if (!document.hidden) load().catch(() => { }); }, 15000));
}

// ============ 班級管理（老師） ============
function viewClasses() {
  const list = S.classes || [];
  app().innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">班級管理</h2><span class="spacer"></span>
      <button class="btn" id="reSync">↻ 重新讀取名單</button></div>
    <p class="muted small">班級與學生來自 Google 試算表的「學生名單」工作表（班級、座號、姓名、Email）。修改名單後按「重新讀取名單」（最慢 10 分鐘也會自動更新）。</p></div>
    <div class="card">${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>班級</th><th>人數</th><th>⭐ 必做題</th><th>目標題數</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr><td><a href="#/class/${esc(c.id)}"><b>${esc(c.name)} 班</b></a></td><td>${c.count}</td><td>${(c.required || []).length} 題</td>
        <td class="small">${Object.entries(c.goals || {}).map(([k, v]) => `${esc(k)} ${v} 題`).join('、') || '<span class="muted">未設定</span>'}</td>
        <td><a class="btn sm" href="#/class/${esc(c.id)}">設定</a> <a class="btn sm" href="#/scoreboard" data-sb="${esc(c.id)}">成績</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">名單裡還沒有學生，請在 Google 試算表的「學生名單」工作表貼上學生資料。</p>'}</div>`;
  $$('[data-sb]').forEach(a => a.onclick = () => store.set('cj-tcid', a.dataset.sb));
  $('#reSync').onclick = async () => { await backgroundSync(true); toast('已重新讀取'); viewClasses(); };
}
async function viewClass(cid) {
  app().innerHTML = '<div class="loading">載入中…</div>';
  const d = await apiGet('/api/class/members', { cid });
  const c = d.cls;
  const i = (S.classes || []).findIndex(x => x.id === c.id);
  if (i >= 0) { S.classes[i] = c; saveState(); }
  const h = new Set(c.hidden || []);
  app().innerHTML = `
  <div class="pnav"><a class="btn" href="#/classes">← 班級列表</a><a class="btn" href="#/scoreboard" id="toSb">成績總表</a></div>
  <div class="card"><div class="row"><h2 style="margin:0">${esc(c.name)} 班</h2><span class="muted">${d.members.length} 人</span><span class="spacer"></span>
    <a class="btn sm" href="${esc(d.sheetUrl)}" target="_blank" rel="noopener">開啟 Google 試算表修改名單 ↗</a></div></div>
  <div class="problem-layout">
    <div class="card"><h3 style="margin-top:0">學生名單</h3>
      ${d.members.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>座號</th><th>姓名</th><th>Email</th><th>最近活動</th></tr></thead><tbody>
        ${d.members.map(m => `<tr><td>${seat2(m.seat)}</td><td>${esc(m.name)}</td><td class="small">${esc(m.email)}</td>
          <td class="small">${m.lastSeen ? `<span class="${Date.now() - m.lastSeen < 120000 ? 'online' : 'offline'}"></span>${fmtTime(m.lastSeen, true)}` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">還沒有學生。</p>'}
    </div>
    <div>
      <div class="card"><h3 style="margin-top:0">⭐ 指定必做題（<span id="reqN">0</span> 題）</h3>
        <p class="muted small">學生的題目頁最上方會列出這些題目和完成狀態（✔／✘／○），題目列表也會標「⭐ 必做」。目標成績要求必做題全部完成才算達標。</p>
        <div id="reqChips" class="req-chips"></div>
        <div class="row" style="margin-top:8px">從分類挑選：<select id="reqUnit">${SERIES_KEYS.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select></div>
        <div id="reqPick" class="req-pick"></div>
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn primary" id="saveReq">儲存必做題</button></div></div>
      <div class="card"><h3 style="margin-top:0">本班開放的題目與目標題數</h3>
        <p class="muted small">取消勾選的分類，這個班的學生就看不到、也不能送出。<br>
          「目標題數」：這個分類要完成幾題（0 或空白 = 不要求）。學生的題目頁會顯示「還差幾題」，成績總表的「目標成績」以是否達到目標計分。</p>
        ${SERIES_KEYS.map(k => { const n = PROBS.filter(p => p.series === k).length; return `<div class="open-series"><label><input type="checkbox" data-h="${esc(k)}" ${h.has(k) ? '' : 'checked'}> <b>${esc(k)}</b>（${n} 題）</label>
          <span class="small muted" style="margin-left:16px">目標 <input type="number" data-goal="${esc(k)}" min="0" max="${n}" value="${(c.goals || {})[k] || ''}" placeholder="0" style="width:56px"> / ${n} 題</span></div>`; }).join('')}
        <label style="display:block;margin-top:8px" class="small">另外要隱藏的題號（逗號分隔）：</label>
        <input type="text" id="hideIds" style="width:100%" value="${esc([...h].filter(x => PMAP[x]).join(', '))}">
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn primary" id="saveOpen">儲存開放設定與目標題數</button></div></div>
      <div class="card"><h3 style="margin-top:0">⏰ 作業截止時間</h3>
        <p class="muted small">可以替「⭐ 必做題」和「有設定目標的分類」設定截止時間。學生會看到倒數與逾期提醒；成績總表可以選「只計算截止前完成的」。（先設定好必做題或目標題數並儲存，這裡才會出現）</p>
        <div id="dueList"></div>
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn primary" id="saveDue">儲存截止時間</button></div></div>
      <div class="card"><h3 style="margin-top:0">📦 成績報表</h3>
        <p class="muted small">產生一份成績報表保存在 Google 試算表裡（含每題成績、必做題、目標成績，依成績總表的換算設定），之後隨時可以在下面下載。</p>
        <div class="row"><input type="text" id="snapName" placeholder="報表名稱（可不填），例如 115 上學期期中" style="flex:1;min-width:200px">
          <button class="btn" id="snapGo">📄 產生成績報表</button></div>
        <h4>歷史紀錄</h4><div id="snapList" class="small muted">載入中…</div></div>
    </div>
  </div>`;
  const update = async (body, msg) => {
    try { const r = await api('/api/class/update', Object.assign({ cid }, body)); const k = (S.classes || []).findIndex(x => x.id === cid); if (k >= 0) S.classes[k] = r.cls; saveState(); toast(msg); viewClass(cid); }
    catch (e) { toast(e.message); }
  };
  $('#toSb').onclick = () => store.set('cj-tcid', cid);
  // 指定必做題
  const req = new Set((c.required || []).filter(id => PMAP[id]));
  const renderReq = () => {
    $('#reqN').textContent = req.size;
    $('#reqChips').innerHTML = req.size ? [...req].sort().map(id => `<span class="req-chip">${id} ${esc(PMAP[id].title)} <a href="javascript:void 0" data-unreq="${id}" title="移除">✕</a></span>`).join('') : '<span class="muted small">還沒有指定必做題。</span>';
    $$('[data-unreq]').forEach(a => a.onclick = () => { req.delete(a.dataset.unreq); renderReq(); });
    const t = $('#reqUnit').value;
    $('#reqPick').innerHTML = PROBS.filter(p => p.series === t).map(p => `<label><input type="checkbox" data-req="${p.id}" ${req.has(p.id) ? 'checked' : ''}> ${p.id} ${esc(p.title)} ${stars(p.difficulty)}</label>`).join('');
    $$('[data-req]').forEach(x => x.onchange = () => { x.checked ? req.add(x.dataset.req) : req.delete(x.dataset.req); renderReq(); });
  };
  $('#reqUnit').onchange = renderReq;
  renderReq();
  $('#saveReq').onclick = () => update({ required: [...req] }, `已儲存 ${req.size} 題必做題，學生下次同步時會看到`);
  // 作業截止時間：必做題與有目標的分類
  const due = Object.assign({}, c.due || {});
  const dueKeys = [...(c.required || []).filter(id => PMAP[id]).map(id => [id, `⭐ ${id} ${PMAP[id].title}`]),
    ...Object.keys(c.goals || {}).filter(t => SERIES_KEYS.includes(t)).map(t => [t, `📚 ${t}（目標 ${c.goals[t]} 題）`])];
  $('#dueList').innerHTML = dueKeys.length ? `<table class="list"><tbody>${dueKeys.map(([k, label]) => `<tr><td>${esc(label)}</td>
    <td style="width:260px"><input type="datetime-local" data-due="${esc(k)}" value="${toLocalInput(due[k])}"> <a href="javascript:void 0" data-dueclr="${esc(k)}" class="small">清除</a></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">還沒有必做題或目標題數。</p>';
  $$('[data-dueclr]').forEach(a => a.onclick = () => { $(`[data-due="${a.dataset.dueclr}"]`).value = ''; });
  $('#saveDue').onclick = () => update({ due: Object.fromEntries($$('[data-due]').filter(x => x.value).map(x => [x.dataset.due, new Date(x.value).getTime()])) }, '已儲存截止時間');
  // 成績報表
  const loadSnaps = async () => {
    try {
      const r = await apiGet('/api/class/snapshots', { cid });
      if (!$('#snapList')) return;
      $('#snapList').innerHTML = r.list.length ? `<table class="list"><tbody>${r.list.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${fmtTime(s.time)}</td><td><button class="btn sm" data-snap="${s.id}">⬇ 下載 CSV</button></td></tr>`).join('')}</tbody></table>` : '還沒有產生過報表。';
      $$('[data-snap]').forEach(b => b.onclick = async () => {
        try { const d = await apiGet('/api/class/snapshot/' + b.dataset.snap); downloadCsv(d.rows, `${d.name}.csv`); } catch (e) { toast(e.message); }
      });
    } catch (e) { if ($('#snapList')) $('#snapList').textContent = e.message; }
  };
  loadSnaps();
  $('#snapGo').onclick = async () => {
    $('#snapGo').disabled = true;
    try {
      const sb = await apiGet('/api/scoreboard', { cid });
      const rows = buildReport(sb, gradeCfg());
      const name = $('#snapName').value.trim() || `${c.name} 班成績報表 ${fmtTime(Date.now())}`;
      await api('/api/class/snapshot', { cid, rows, name });
      downloadCsv(rows, name + '.csv');
      toast('已產生報表（同時下載一份 CSV）'); loadSnaps();
    } catch (e) { toast(e.message, 4000); }
    if ($('#snapGo')) $('#snapGo').disabled = false;
  };
  $('#saveOpen').onclick = () => update({
    hidden: $$('[data-h]').filter(x => !x.checked).map(x => x.dataset.h).concat($('#hideIds').value.split(/[,，\s]+/).map(s => s.trim()).filter(x => PMAP[x])),
    goals: Object.fromEntries($$('[data-goal]').map(x => [x.dataset.goal, Math.max(0, Math.min(+x.max, +x.value || 0))]).filter(([, v]) => v > 0)),
  }, '已儲存，學生下次同步時生效');
}

// ============ 測資與解答（老師） ============
const clip = (s, n = 3000) => s.length > n ? s.slice(0, n) + `\n…（共 ${s.length} 字）` : s;
async function viewTests(id) {
  const p0 = PMAP[id];
  if (!p0) { app().innerHTML = '<div class="card">找不到題目</div>'; return; }
  app().innerHTML = '<div class="loading">載入中…</div>';
  const p = (await apiGet('/api/problem-admin/' + id)).problem;
  app().innerHTML = `
  <div class="pnav"><a class="btn" href="#/problem/${id}">← 回到題目</a><a class="btn" href="#/edit/${id}">✏ 編輯題目</a><span class="spacer"></span>${zoomButtons()}${presentButton()}</div>
  <div class="card"><div class="ptitle"><span class="pid">${id}</span><h2 style="margin:0">${esc(p.title)}：測資與解答</h2></div>
    <p class="muted small">共 ${p.tests.length} 組測資。第 1 組與勾選「公開」的測資，學生答錯時會看到正確答案；其他是隱藏測資。</p>
    <h3>參考解答</h3><div id="sol" class="readonly"></div>
    <div class="row" style="margin-top:6px"><button class="btn" id="cpSol">📋 複製參考解答</button></div></div>
  ${p.tests.map((t, i) => `<div class="card test-card"><div class="row"><h3 style="margin:0">#${i + 1}</h3>
      ${t.public || i === 0 ? '<span class="tag">公開</span>' : '<span class="tag hid">隱藏</span>'}<span class="muted small">${t.score} 分</span></div>
    <div class="sample"><div class="box"><div class="h">輸入</div><pre>${esc(clip(t.input)) || '<span class="muted">（無）</span>'}</pre></div>
      <div class="box"><div class="h">正確輸出</div><pre>${esc(clip(t.output))}</pre></div></div></div>`).join('')}`;
  const cm = createEditor($('#sol'), p.solution || '（沒有參考解答）', { readOnly: true });
  bindZoom(() => [cm, ...$$('.test-card pre')]);
  bindPresent(() => cm);
  $('#cpSol').onclick = async () => { try { await navigator.clipboard.writeText(p.solution || ''); toast('已複製'); } catch { toast('複製失敗'); } };
}

// ============ 新增／編輯題目（老師） ============
async function viewEdit(id) {
  let p = { id: '', title: '', chapter: DEFAULT_SERIES, tags: [], difficulty: 1, content: '', inputDesc: '', outputDesc: '', samples: [], hint: '', lesson: '', timeLimitMs: 2000, tests: [{ input: '', output: '', score: 100, public: true }], solution: '', visible: true };
  if (id) {
    app().innerHTML = '<div class="loading">載入中…</div>';
    p = (await apiGet('/api/problem-admin/' + id)).problem;
  } else {
    let n = 1; while (PMAP['a' + String(n).padStart(3, '0')]) n++;
    p.id = 'a' + String(n).padStart(3, '0');
  }
  Judge.start().catch(() => { });
  const field = (k, label, type) => `<label>${label}</label>${type === 'area' ? `<textarea id="f_${k}" rows="4" style="font-family:inherit">${esc(p[k])}</textarea>` : `<input type="text" id="f_${k}" value="${esc(p[k])}">`}`;
  app().innerHTML = `
  <div class="pnav"><a class="btn" href="${id ? '#/problem/' + esc(id) : '#/problems'}">← ${id ? '回到題目' : '題目列表'}</a><span class="spacer"></span>
    ${id ? '<button class="btn danger" id="delP">🗑 刪除這一題</button>' : ''}</div>
  <div class="card"><h2>${id ? '編輯題目 ' + esc(id) : '新增題目'}</h2>
    <div class="form-grid">
      ${field('id', '題號')}${field('title', '題目名稱')}
      <label>分類</label><div class="row"><input type="text" id="f_chapter" value="${esc(p.chapter)}" list="chapterList" style="width:200px">
        <datalist id="chapterList">${[...new Set([...Object.keys(SERIES_DESC), ...SERIES_KEYS])].map(k => `<option value="${esc(k)}">`).join('')}</datalist> <span class="muted small">選 A 系列或 B 系列，也可以自己輸入新的分類</span></div>
      <label>分類標籤</label><input type="text" id="f_tags" value="${esc((p.tags || []).join(', '))}" placeholder="用逗號分隔，例如 input, 變數">
      <label>難度 / 時限</label><div class="row"><select id="f_difficulty">${[1, 2, 3].map(n => `<option value="${n}" ${n === p.difficulty ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>
        時間限制 <input type="number" id="f_timeLimitMs" value="${p.timeLimitMs}" style="width:90px"> ms
        <label class="small"><input type="checkbox" id="f_visible" ${p.visible !== false ? 'checked' : ''}> 公開給學生</label></div>
      ${field('content', '題目內容', 'area')}${field('inputDesc', '輸入說明', 'area')}${field('outputDesc', '輸出說明', 'area')}${field('hint', '提示', 'area')}
      <label>程式碼介紹<br><span class="muted small">顯示在題目最上方</span></label><div><textarea id="f_lesson" rows="10" style="font-family:var(--mono)">${esc(p.lesson || '')}</textarea>
        <div class="muted small">程式碼請用 <code>\`\`\`python</code> 開頭、<code>\`\`\`</code> 結尾包起來，學生可以一鍵複製或放到編輯器；以 | 開頭的行會顯示成表格。</div></div>
      <label>參考解答<br><span class="muted small">學生看不到</span></label><div><div id="solEd"></div>
        <div class="row" style="margin-top:6px"><button class="btn" id="gen">▶ 用參考解答產生全部測資的輸出</button><span class="muted small" id="genMsg"></span></div></div>
    </div></div>
  <div class="card"><div class="row"><h3 style="margin:0">測資</h3><span class="muted small">第 1 組與勾選「公開」的測資，學生答錯時會看到正確答案。</span><span class="spacer"></span><button class="btn" id="addT">＋ 新增一組</button></div>
    <div id="tests"></div>
    <div class="row" style="margin-top:8px"><label class="small"><input type="checkbox" id="autoSample" checked> 用第 1 組測資當作題目頁的範例</label><span class="spacer"></span><span id="sum" class="muted"></span></div>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn green" id="save">💾 儲存題目</button></div></div>`;
  const sol = createEditor($('#solEd'), p.solution || '');
  sol.setSize(null, 220); setTimeout(() => sol.refresh(), 0);
  const tests = p.tests.map(t => Object.assign({}, t));
  const total = () => tests.reduce((a, t) => a + (+t.score || 0), 0);
  const renderTests = () => {
    $('#tests').innerHTML = tests.map((t, i) => `<div class="testcase2"><b>#${i + 1}</b>
      <div><div class="small muted">輸入</div><textarea data-k="input" data-i="${i}" rows="3">${esc(t.input)}</textarea></div>
      <div><div class="small muted">正確輸出　分數 <input type="number" data-k="score" data-i="${i}" value="${t.score}" style="width:70px">
        <label><input type="checkbox" data-k="public" data-i="${i}" ${t.public ? 'checked' : ''}> 公開</label></div><textarea data-k="output" data-i="${i}" rows="3">${esc(t.output)}</textarea></div>
      <button class="btn sm danger" data-rm="${i}" title="刪除這組">✕</button></div>`).join('');
    $('#sum').textContent = `總分：${total()}`;
    $$('#tests [data-k]').forEach(el => el.oninput = el.onchange = () => {
      const t = tests[+el.dataset.i]; t[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
      $('#sum').textContent = `總分：${total()}`;
    });
    $$('[data-rm]').forEach(b => b.onclick = () => { if (tests.length > 1) { tests.splice(+b.dataset.rm, 1); renderTests(); } });
  };
  renderTests();
  $('#addT').onclick = () => { tests.push({ input: '', output: '', score: 0, public: false }); renderTests(); };
  $('#gen').onclick = async () => {
    const msg = $('#genMsg'); msg.textContent = '執行中…';
    try {
      for (let i = 0; i < tests.length; i++) {
        msg.textContent = `執行中 ${i + 1} / ${tests.length}`;
        const r = await Judge.run(sol.getValue(), tests[i].input, 5000);
        if (r.status !== 'OK') { msg.innerHTML = `<span class="mine-tried">第 ${i + 1} 組失敗：${esc(r.status)} ${esc(r.error ? r.error.friendly : '')}</span>`; renderTests(); return; }
        tests[i].output = r.stdout.replace(/\s+$/, '');
      }
      renderTests(); msg.innerHTML = `<span class="mine-ac">✔ 已產生 ${tests.length} 組輸出，請檢查後儲存</span>`;
    } catch (e) { msg.textContent = e.message; }
  };
  $('#save').onclick = async () => {
    const g = k => $('#f_' + k).value;
    const np = {
      id: g('id').trim(), title: g('title'), chapter: g('chapter').trim() || DEFAULT_SERIES, tags: g('tags').split(/[,，]/).map(s => s.trim()).filter(Boolean),
      difficulty: +g('difficulty'), timeLimitMs: +g('timeLimitMs'), visible: $('#f_visible').checked,
      content: g('content'), inputDesc: g('inputDesc'), outputDesc: g('outputDesc'), hint: g('hint'), lesson: g('lesson'),
      solution: sol.getValue(), tests,
      samples: $('#autoSample').checked && tests[0] ? [{ input: tests[0].input, output: tests[0].output }] : p.samples,
    };
    if (!id && PMAP[np.id]) { toast('題號已經存在'); return; }
    const b = $('#save'); b.disabled = true;
    try {
      await api('/api/problems', { problem: np, originalId: id || undefined });
      await backgroundSync(true);   // 下載新的題目資料
      toast('已儲存，學生下次同步時就會看到'); location.hash = '#/problem/' + np.id;
    } catch (e) { toast(e.message, 4000); b.disabled = false; }
  };
  if ($('#delP')) $('#delP').onclick = async () => {
    if (!confirm(`確定要刪除題目 ${id} 嗎？（學生的提交紀錄會保留）`)) return;
    try { await api('/api/problems/delete', { id }); await backgroundSync(true); toast('已刪除'); location.hash = '#/problems'; } catch (e) { toast(e.message); }
  };
}

// ============ 啟動 ============
(async () => {
  if (S.legacy) {   // 第 1 版網頁留下的登入資料：同步一次換成新的通行證（登入狀態保留）
    app().innerHTML = '<div class="loading">登入中…</div>';
    await backgroundSync(true);
    if (S.legacy) S = ANON();   // 網路暫時連不上：這次先用訪客狀態（舊的通行證保留，下次打開再試；過期的話 api() 已經清掉）
  }
  if (loggedIn()) {
    Judge.start().catch(() => { });   // 已登入：一打開網頁就在背景準備 Python 環境
    backgroundSync(S.schema !== 2);
    if (isTeacher()) setInterval(() => backgroundSync(true), 60000);   // 老師：每分鐘檢查新留言
  }
  router();
})();
