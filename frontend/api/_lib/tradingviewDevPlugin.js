// Local dev/preview parity with the private production route; same auth guard.
import tradingviewApi from './tradingviewApi.js';
import dailySnapshots from './dailySnapshots.js';
export default function tradingviewDevPlugin() {
  const configure = server => {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      const handler = url.pathname === '/api/private/market-data/tradingview' ? tradingviewApi
        : url.pathname === '/api/private/market-data/daily-snapshots' ? dailySnapshots : null;
      if (!handler) return next();
      req.query = Object.fromEntries(url.searchParams);
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
      handler(req, res).catch(() => { if (!res.writableEnded) { res.statusCode = 500; res.end('{"error":{"message":"Internal error"}}'); } });
    });
  };
  return { name: 'quantedge-private-tradingview', configureServer: configure, configurePreviewServer: configure };
}
