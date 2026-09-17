import { dailySummary, dailySymbol } from './dailyWatchlist.js';
import { DAILY_INACTIVE } from './dailyInstrumentStatus.js';

// Display adapter ONLY. Never feed this overlay into scoreUniverse or persist it
// as financial/scoring inputs. Those inputs retain their own dated provenance.
export function dailyScoringStock(stock, snapshots, now = Date.now()) {
  if (DAILY_INACTIVE[stock.ticker]) return { ...stock, price: null, change: null, rsi: null,
    dailyQuote: { status: 'inactive', ...DAILY_INACTIVE[stock.ticker] } };
  let snapshot;
  try {
    const value = snapshots[stock.ticker];
    snapshot = dailySummary({ ...value, bars: [value?.bar] });
    if (snapshot.resolved_symbol.replace('_DLY:', ':') !== dailySymbol(stock.ticker)) throw Error('symbol');
    if (snapshot.bar.close <= 0 || snapshot.bar.time * 1000 > now + 86400000) throw Error('price');
  } catch {
    return { ...stock, dailyQuote: { status: 'unavailable' } };
  }
  const ageHours = (now - Date.parse(snapshot.received_at)) / 3600000;
  return { ...stock, price: snapshot.bar.close, currency: snapshot.currency || stock.currency,
    change: snapshot.previous_close ? (snapshot.bar.close / snapshot.previous_close - 1) * 100 : null,
    rsi: snapshot.indicators.rsi, macd: snapshot.indicators.macd,
    dailyQuote: { status: ageHours > 36 ? 'stale' : 'available', ...snapshot,
      // A bar without a recent date may be suspended or on holiday; do not infer suspension.
      oldBar: (now / 1000 - snapshot.bar.time) / 86400 > 7,
      date: new Date(snapshot.bar.time * 1000).toLocaleDateString('en-CA', { timeZone: snapshot.timezone || 'UTC' }) } };
}
