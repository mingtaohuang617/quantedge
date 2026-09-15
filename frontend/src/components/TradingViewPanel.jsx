import React, { useState } from 'react';
import { useLang } from '../i18n.jsx';

const fieldStyle = { background: 'var(--bg-1)', color: 'var(--fg-0)', borderColor: 'var(--line-2)' };
const number = value => value == null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const stamp = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '—';

export default function TradingViewPanel({ request }) {
  const { t } = useLang();
  const [symbol, setSymbol] = useState('NASDAQ:AAPL');
  const timeframe = '1D';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const query = async event => {
    event.preventDefault();
    setLoading(true); setError(''); setData(null);
    try { setData(await request(`/private/market-data/tradingview?${new URLSearchParams({ symbol, timeframe })}`, { noRetry: true })); }
    catch (reason) { setError(reason.message || t('查询失败')); }
    finally { setLoading(false); }
  };
  const bar = data?.bars?.[0];
  return <section className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--line)', background: 'var(--bg-2)', color: 'var(--fg-0)' }} aria-labelledby="tv-title">
    <div><h2 id="tv-title" className="text-base font-semibold">{t('行情与技术指标')}</h2><p className="text-xs mt-1" style={{ color: 'var(--fg-1)' }}>{t('TradingView · 私有按需快照，不替换回测数据源')}</p></div>
    <form onSubmit={query} className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-40 text-xs">{t('交易所与代码')}<input className="block border rounded-lg px-3 min-h-11 w-full mt-1" style={fieldStyle} value={symbol} onChange={e => { setSymbol(e.target.value.toUpperCase()); setData(null); }} aria-label={t('TradingView 标的')} disabled={loading} required /></label>
      <label className="text-xs">{t('K 线周期')}<input className="block border rounded-lg px-3 min-h-11 mt-1 w-24" style={fieldStyle} value={t('日线')} readOnly /></label>
      <button className="mobile-primary-button min-h-11" disabled={loading} type="submit">{loading ? t('正在获取…') : t('查询快照')}</button>
    </form>
    <p className="text-xs" style={{ color: 'var(--fg-1)' }}>{t('示例代码')}：NASDAQ:NVDA · HKEX:700 · SSE:600519 · BINANCE:BTCUSDT</p>
    {loading && <p role="status" className="text-sm">{t('正在获取 K 线及 RSI / MACD，通常需要数秒，最长约 28 秒。')}</p>}
    {error && <p role="alert" className="text-sm" style={{ color: 'var(--sem-down)' }}>{error}</p>}
    {bar && <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-mono">{data.resolved_symbol} · {data.currency || t('币种未知')}</span><span>{data.delay_seconds == null ? t('延迟状态未知') : data.delay_seconds > 0 ? `${t('延迟')} ${data.delay_seconds / 60} ${t('分钟')}` : t('源端未标注延迟（非实时保证）')}{data.cached ? ` · ${t('缓存快照')}` : ''}</span></div>
      <dl className="grid grid-cols-2 md:grid-cols-5 gap-3">{[['K 线最新收盘价',bar.close],['RSI',data.indicators.rsi],['MACD',data.indicators.macd],['Signal',data.indicators.signal],['Histogram',data.indicators.histogram]].map(([label,value]) => <div className="rounded-xl p-3" style={{ background: 'var(--bg-1)' }} key={label}><dt className="text-xs" style={{ color: 'var(--fg-1)' }}>{t(label)}</dt><dd className="font-mono text-lg mt-2">{number(value)}</dd></div>)}</dl>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--fg-1)' }}>{t('K 线起点')}：{stamp(bar.time * 1000)} · {t('获取时间')}：{stamp(data.received_at)}（{t('香港时间')}）<br/>{t('当前 K 线及指标可能变化；休市时显示上一交易时段数据。RSI / MACD 使用 TradingView 默认参数。美股可能映射至 Cboe，与主交易所报价不同。')}</p>
    </div>}
  </section>;
}
