import React from 'react';
import { useLang } from '../i18n.jsx';
export default function DailyQuoteProvenance({ stock, refresh, loading }) {
  const { t } = useLang();
  const quote = stock?.dailyQuote;
  if (!quote) return null;
  return <section data-testid="daily-quote-provenance" className="rounded-xl border p-3 my-3 text-xs leading-relaxed" style={{ borderColor: 'var(--line)', color: 'var(--fg-1)' }}>
    {quote.status === 'inactive' ? <a href={quote.source} target="_blank" rel="noopener noreferrer">{t('已停止交易')} · {quote.effective_at}</a>
      : quote.status === 'unavailable' ? <p>{t('日线快照不可用，当前显示旧行情，日期与来源未统一')}</p>
      : <><p>{t('日线收盘价')} {quote.bar.close.toLocaleString(undefined, { maximumFractionDigits: 4 })} · {quote.date} · {quote.resolved_symbol} · {stock.currency || quote.currency}</p>
        <p>RSI {quote.indicators.rsi.toFixed(2)} · MACD {quote.indicators.macd.toFixed(4)} · Signal {quote.indicators.signal.toFixed(4)} · Histogram {quote.indicators.histogram.toFixed(4)}</p>
        <p>{t('获取时间')} · {new Date(quote.received_at).toLocaleString()} · {t('日线当日未收盘时仍会变化；美股为 Cboe，其他市场可能延迟')}</p>
        {(quote.status === 'stale' || quote.oldBar) && <p role="status" style={{ color: 'var(--warn)' }}>{t('日线数据已过期或交易日较旧，请核对休市、停牌及更新状态')}</p>}</>}
    <p>{t('评分仍使用原有输入，尚未按这份日线重算；历史图表另用 Yahoo 日线')}</p>
    {refresh && <button type="button" disabled={loading} onClick={refresh} className="mt-2 min-h-11 px-3 rounded border" style={{ borderColor: 'var(--line)' }}>{t('刷新日线快照')}</button>}
  </section>;
}
