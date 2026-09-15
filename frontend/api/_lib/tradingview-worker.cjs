// Isolated process: proxy overrides must never affect other QuantEdge requests.
process.on('message', async ({ symbol, timeframe }) => {
  let client;
  let done = false;
  const progress = { dependencies: false, symbol: false, chart: false, rsi: false, macd: false };
  const finish = payload => {
    if (done) return;
    done = true;
    try { client?.end(); } catch { /* shutdown only */ }
    if (process.connected) process.send(payload, () => process.exit(0));
    else process.exit(0);
  };
  const fail = () => finish({ error: 'upstream_unavailable', progress });
  if (timeframe !== '1D') return finish({ error: 'invalid_query' });
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  setTimeout(() => finish({ error: 'upstream_timeout', progress }), 25000).unref();
  try {
    if (process.env.TV_PROXY) {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      const agent = new HttpsProxyAgent(process.env.TV_PROXY);
      const axios = require('axios');
      axios.defaults.httpsAgent = agent;
      axios.defaults.proxy = false;
      const wsPath = require.resolve('ws');
      const WS = require(wsPath);
      require.cache[wsPath].exports = class extends WS {
        constructor(url, options) { super(url, { ...options, agent }); }
      };
    }
    const TV = require('@mathieuc/tradingview');
    progress.dependencies = true;
    client = new TV.Client({ token: process.env.TV_SESSION, signature: process.env.TV_SIGNATURE });
    client.onError(fail);
    const chart = new client.Session.Chart();
    const studies = {};
    const numeric = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e50 ? value : null;
    const publish = () => {
      if (!chart.periods.length || !chart.infos.full_name || !studies.RSI?.length || !studies.MACD?.length) return;
      const bars = chart.periods.slice(0, 100).map(row => ({
        time: row.time, open: numeric(row.open), high: numeric(row.max), low: numeric(row.min), close: numeric(row.close), volume: numeric(row.volume),
      })).filter(row => Number.isFinite(row.time) && row.close !== null);
      if (!bars.length) return;
      // Match study timestamps to the candle: never attach a different bar's values.
      const rsi = studies.RSI.find(row => row.$time === bars[0].time);
      const macd = studies.MACD.find(row => row.$time === bars[0].time);
      if (!rsi || !macd) return;
      const info = chart.infos;
      finish({ data: {
        requested_symbol: symbol, resolved_symbol: info.full_name, timeframe,
        source: 'TradingView (unofficial)', exchange: info.exchange || null,
        currency: info.currency_id || null, timezone: info.timezone || null,
        delay_seconds: Number.isFinite(info.delay) ? info.delay : null,
        received_at: new Date().toISOString(), bars,
        indicators: { time: bars[0].time, rsi: numeric(rsi.RSI), macd: numeric(macd.MACD), signal: numeric(macd.Signal_line), histogram: numeric(macd.Histogram) },
        methodology: 'TradingView built-in RSI / MACD, default inputs; current candle may change',
      } });
    };
    chart.onError(fail);
    chart.onSymbolLoaded(() => { progress.symbol = true; publish(); });
    chart.onUpdate(() => { progress.chart = true; publish(); });
    chart.setMarket(symbol, { timeframe, range: 100 });
    await Promise.all(['RSI', 'MACD'].map(async name => {
      const definition = await TV.getIndicator(`STD;${name}`, 'last', process.env.TV_SESSION, process.env.TV_SIGNATURE);
      if (done) return;
      const study = new chart.Study(definition);
      study.onError(fail);
      study.onUpdate(() => { progress[name.toLowerCase()] = true; studies[name] = study.periods; publish(); });
    }));
  } catch { fail(); }
});
