import React, { lazy, Suspense, useEffect, useState } from 'react';

const QuantPlatform = lazy(() => import('./quant-platform.jsx'));

const COPY = {
  'zh-CN': {
    subtitle: '综合量化投资平台', title: '输入邀请码', hint: '本平台为内测阶段，需凭邀请码访问',
    placeholder: '请输入邀请码', submit: '进入平台', loading: '验证中...', invalid: '邀请码无效，请检查后重试',
    limited: '尝试次数过多，请稍后再试', session: '正在建立安全会话',
  },
  'zh-TW': {
    subtitle: '綜合量化投資平台', title: '輸入邀請碼', hint: '本平台為內測階段，需憑邀請碼訪問',
    placeholder: '請輸入邀請碼', submit: '進入平台', loading: '驗證中...', invalid: '邀請碼無效，請檢查後重試',
    limited: '嘗試次數過多，請稍後再試', session: '正在建立安全會話',
  },
  en: {
    subtitle: 'Quantitative investment platform', title: 'Enter invite code', hint: 'Private beta access requires an invite code',
    placeholder: 'Enter invite code', submit: 'Enter platform', loading: 'Verifying...', invalid: 'Invalid invite code. Please try again.',
    limited: 'Too many attempts. Please try again later.', session: 'Establishing secure session',
  },
};

function readLanguage() {
  try {
    const saved = localStorage.getItem('quantedge_lang');
    if (saved === 'en' || saved === 'zh-TW') return saved;
  } catch {}
  return 'zh-CN';
}

async function authRequest(path, options = {}) {
  const response = await fetch(`/api/auth/${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Authentication failed with HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code || 'authentication_failed';
    throw error;
  }
  return payload?.data ?? payload;
}

function LoadingShell({ label }) {
  return (
    <div className="qe-boot" role="status" aria-live="polite">
      <div className="qe-boot__card">
        <div className="qe-boot__mark">QE</div>
        <h1>QuantEdge</h1>
        <p>{label}</p>
        <div className="qe-boot__line" />
      </div>
    </div>
  );
}

export default function AuthBootstrap() {
  const [lang, setLang] = useState(readLanguage);
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[lang];

  useEffect(() => {
    let cancelled = false;
    authRequest('session')
      .then(data => { if (!cancelled) setSession(data); })
      .catch(() => null)
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('quantedge_lang', lang); } catch {}
  }, [lang]);

  if (session) {
    window.__QUANTEDGE_BOOTSTRAP_SESSION__ = session;
    return <Suspense fallback={<LoadingShell label={copy.session} />}><QuantPlatform /></Suspense>;
  }
  if (checking) return <LoadingShell label={copy.session} />;

  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim()) { setError(copy.placeholder); return; }
    setSubmitting(true);
    setError('');
    try {
      setSession(await authRequest('invite', { method: 'POST', body: JSON.stringify({ code: code.trim() }) }));
    } catch (requestError) {
      setError(requestError.status === 429 ? copy.limited : copy.invalid);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-4 bg-[#0b0b15] text-white">
      <section className="w-full max-w-sm text-center" aria-labelledby="auth-title">
        <div className="qe-boot__mark">QE</div>
        <h1 className="text-2xl font-bold tracking-tight">QuantEdge</h1>
        <p className="mt-1 text-sm text-[#a0aec0]">{copy.subtitle}</p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-indigo-950/30 backdrop-blur-xl">
          <h2 id="auth-title" className="text-sm font-semibold">{copy.title}</h2>
          <p className="mt-1 text-[11px] text-[#85899b]">{copy.hint}</p>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <input
              value={code}
              onChange={event => { setCode(event.target.value); setError(''); }}
              placeholder={copy.placeholder}
              autoFocus autoCorrect="off" autoCapitalize="none" spellCheck={false}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-center font-mono text-sm tracking-wider text-white outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
            />
            {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-left text-xs text-red-300">{error}</p>}
            <button type="submit" disabled={submitting} className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 py-2.5 text-sm font-semibold transition hover:from-indigo-400 hover:to-violet-400 disabled:opacity-60">
              {submitting ? copy.loading : copy.submit}
            </button>
          </form>
        </div>
        <div className="mt-5 flex justify-center gap-1" aria-label="Language">
          {[['zh-CN', '简'], ['zh-TW', '繁'], ['en', 'EN']].map(([value, label]) => (
            <button key={value} onClick={() => setLang(value)} className={`rounded px-2 py-1 text-[10px] ${lang === value ? 'bg-indigo-500 text-white' : 'text-[#8f93a8] hover:text-white'}`}>{label}</button>
          ))}
        </div>
      </section>
    </main>
  );
}
