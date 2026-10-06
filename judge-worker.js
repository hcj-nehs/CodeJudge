// 在瀏覽器背景執行 Python（Pyodide）。逾時由主程式直接終止這個 Worker。
let pyodide = null;

const RUNNER = `
import sys, io, builtins, traceback

class _LimitedOut(io.StringIO):
    LIMIT = 200000
    def write(self, s):
        if self.tell() + len(s) > self.LIMIT:
            raise OverflowError('__OLE__')
        return super().write(s)

def __cj_check(src):
    try:
        compile(src, '<程式碼>', 'exec')
        return None
    except SyntaxError as e:
        return {'type': type(e).__name__, 'msg': str(e.msg), 'line': e.lineno or 0, 'col': e.offset or 0,
                'text': (e.text or '').rstrip('\\n')}

def __cj_run(src, stdin_text):
    err = __cj_check(src)
    if err:
        return {'status': 'CE', 'stdout': '', 'error': err}
    out = _LimitedOut()
    sin = io.StringIO(stdin_text)
    def _input(prompt=''):
        line = sin.readline()
        if line == '':
            raise EOFError('EOF when reading a line')
        return line.rstrip('\\r\\n')
    old_out, old_in, old_input = sys.stdout, sys.stdin, builtins.input
    sys.stdout, sys.stdin, builtins.input = out, sin, _input
    status, error = 'OK', None
    try:
        exec(compile(src, '<程式碼>', 'exec'), {'__name__': '__main__', '__builtins__': builtins})
    except SystemExit:
        pass
    except OverflowError as e:
        if str(e) == '__OLE__':
            status = 'OLE'
        else:
            status, error = 'RE', e
    except BaseException as e:
        status, error = 'RE', e
    finally:
        sys.stdout, sys.stdin, builtins.input = old_out, old_in, old_input
    res = {'status': status, 'stdout': out.getvalue(), 'error': None}
    if error is not None:
        line = 0
        for fr in traceback.extract_tb(error.__traceback__):
            if fr.filename == '<程式碼>':
                line = fr.lineno
        msg = str(error)
        if isinstance(error, SyntaxError):
            msg = str(error.msg); line = error.lineno or line
        res['error'] = {'type': type(error).__name__, 'msg': msg, 'line': line}
    return res
`;

async function init(url) {
  importScripts(url + 'pyodide.js');
  pyodide = await loadPyodide({ indexURL: url });
  pyodide.runPython(RUNNER);
}

self.onmessage = async (ev) => {
  const { id, type, url, code, input } = ev.data;
  try {
    if (type === 'init') {
      await init(url);
      self.postMessage({ id, ok: true });
    } else if (type === 'check') {
      const f = pyodide.globals.get('__cj_check');
      const r = f(code); f.destroy();
      const out = r ? r.toJs({ dict_converter: Object.fromEntries }) : null;
      if (r) r.destroy();
      self.postMessage({ id, ok: true, result: out });
    } else if (type === 'run') {
      const f = pyodide.globals.get('__cj_run');
      const t0 = performance.now();
      const r = f(code, input || '');
      const timeMs = performance.now() - t0;
      f.destroy();
      const out = r.toJs({ dict_converter: Object.fromEntries }); r.destroy();
      out.timeMs = Math.round(timeMs);
      self.postMessage({ id, ok: true, result: out });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
