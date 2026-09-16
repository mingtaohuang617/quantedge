import React, { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { DAILY_SNAPSHOT_KEY, buildDailyQueue, loadDailyFavorites, loadDailySnapshots, loadPublishedDaily, runDailyQueue } from '../lib/dailyWatchlist.js';
const number = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
export default function DailyWatchlistPanel({ request, stocks = [] }) {
  const { t } = useLang();
  const [favorites, setFavorites] = useState({ tickers: [], source: 'local' });
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState('');
  const [publishedAt, setPublishedAt] = useState(null);
  const controller = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all([loadDailyFavorites(request, localStorage), loadPublishedDaily(request, localStorage)]).then(([value, initial]) => { if (active) {
      setFavorites(value); setReady(true);
      const { snapshots, published } = initial;
      setPublishedAt(published?.generated_at || null);
      const publishedRows = published?.rows || [];
      const states = new Map(publishedRows.map(row => [row.ticker, row]));
      setRows(buildDailyQueue(value.tickers, publishedRows, true).map(row => ({ ...row,
        status: row.inactive ? 'inactive' : snapshots[row.ticker] ? 'saved' : ['failed','unsupported'].includes(states.get(row.ticker)?.status) ? states.get(row.ticker).status : 'pending',
        snapshot: row.inactive ? undefined : snapshots[row.ticker], code: row.inactive || snapshots[row.ticker] ? undefined : states.get(row.ticker)?.error })));
    } });
    return () => { active = false; controller.current?.abort(); };
  }, [request]);
  const start = async expand => {
    setRunning(true); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const current = await loadDailyFavorites(request, localStorage);
      if (abort.signal.aborted) return;
      setFavorites(current);
      if (!current.tickers.length) { setNotice('未读取到星标名单，未开始更新'); return; }
      const queue = buildDailyQueue(current.tickers, stocks, expand);
      const snapshots = loadDailySnapshots(localStorage);
      setRows(queue.map(row => ({ ...row, status: 'pending' })));
      const result = await runDailyQueue(queue, { request, signal: abort.signal, onResult: row => {
        if (abort.signal.aborted) return;
        setRows(currentRows => currentRows.map(item => item.ticker === row.ticker ? row : item));
        if (row.status === 'success') {
          snapshots[row.ticker] = row.snapshot;
          try { localStorage.setItem(DAILY_SNAPSHOT_KEY, JSON.stringify(snapshots)); } catch { setNotice('浏览器存储不足，本轮结果仅保留在页面'); }
        }
      } });
      if (result.stopped) setNotice('更新已停止，待更新项未被标记为成功');
    } finally { setRunning(false); }
  };
  const labels = { pending: '待更新', saved: '历史快照', success: '本轮已获取', failed: '获取失败', unsupported: '暂不支持此代码', inactive: '已停止交易' };
  return <section aria-labelledby="daily-watchlist-title" className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--line)', background: 'var(--bg-2)', color: 'var(--fg-0)' }}>
    <div><h2 id="daily-watchlist-title" className="text-base font-semibold">{t('星标优先 · 日线更新')}</h2><p className="text-xs mt-2" style={{ color:'var(--fg-1)' }}>{t('星标')} {favorites.tickers.length} · {t(favorites.source === 'server' ? '名单来自服务端' : '名单来自本机浏览器')} · {t('当前股票池')} {stocks.length}</p></div>
    <div className="flex flex-wrap gap-2">
      <button className="mobile-primary-button min-h-11" disabled={!ready || running} onClick={()=>start(false)}>{t('更新全部星标日线')}</button>
      <button className="mobile-secondary-button min-h-11" disabled={!ready || running} onClick={()=>start(true)}>{t('先星标，再扩展当前股票池')}</button>
      {running && <button className="mobile-secondary-button min-h-11" onClick={()=>controller.current?.abort()}>{t('停止更新')}</button>}
    </div>
    <p className="text-xs leading-relaxed" style={{ color:'var(--fg-1)' }}>{t('仅日线价格及 RSI/MACD；美股默认 Cboe 来源。逐只限速更新，失败不会覆盖旧快照，不改写财报或综合评分。')}</p>
    {publishedAt && <p className="text-xs" style={{color:'var(--fg-1)'}}>{t('已加载服务端日线快照')} · {new Date(publishedAt).toLocaleString()} · {t('历史快照')} {rows.filter(row=>row.status==='saved').length}</p>}
    {notice && <p role="status" className="text-sm">{t(notice)}</p>}
    {rows.filter(row=>row.inactive).map(row=><p key={row.ticker} className="text-xs"><a className="underline" href={row.inactive.source} target="_blank" rel="noopener noreferrer">{row.ticker} · {t('已停止交易')} · {row.inactive.effective_at}</a></p>)}
    {rows.length > 0 && <><p role="status" className="text-xs">{t('本轮已获取')} {rows.filter(x=>x.status==='success').length} / {rows.length} · {t('获取失败')} {rows.filter(x=>x.status==='failed').length}</p>
      <div tabIndex={0} role="region" aria-label={t('星标优先 · 日线更新')} className="max-h-96 overflow-auto rounded-xl border" style={{borderColor:'var(--line)'}}><table className="w-full text-xs text-left"><thead><tr>{['标的代码','状态','日线收盘价','RSI','MACD','数据日期','实际来源'].map(label=><th key={label} className="p-3 whitespace-nowrap">{t(label)}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.ticker} className="border-t" style={{borderColor:'var(--line)'}}><td className="p-3 whitespace-nowrap">{row.favorite?'★ ':''}{row.ticker}</td><td className="p-3 whitespace-nowrap">{t(labels[row.status])}{row.code ? ` (${row.code})` : ''}</td><td className="p-3">{number(row.snapshot?.bar.close)}</td><td className="p-3">{number(row.snapshot?.indicators.rsi)}</td><td className="p-3">{number(row.snapshot?.indicators.macd)}</td><td className="p-3 whitespace-nowrap">{row.snapshot ? new Date(row.snapshot.bar.time*1000).toLocaleDateString('en-CA',{timeZone:row.snapshot.timezone || 'UTC'}) : '—'}</td><td className="p-3 whitespace-nowrap">{row.snapshot?.resolved_symbol || row.symbol || '—'}</td></tr>)}</tbody></table></div></>}
  </section>;
}
