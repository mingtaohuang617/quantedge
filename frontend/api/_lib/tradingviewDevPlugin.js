// Local dev/preview parity with the private production route; same auth guard.
import tradingviewApi from './tradingviewApi.js';
export default function tradingviewDevPlugin() {
  const configure = server => {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/api/private/market-data/tradingview') return next();
      req.query = Object.fromEntries(url.searchParams);
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
      tradingviewApi(req, res).catch(() => { if (!res.writableEnded) { res.statusCode = 500; res.end('{"error":{"message":"Internal error"}}'); } });
    });
  };
  return { name: 'quantedge-private-tradingview', configureServer: configure, configurePreviewServer: configure };
}
