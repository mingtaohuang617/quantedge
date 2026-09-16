"""Rebuild only scoring fields from the read-only local daily-bar database.

No network, price refresh, database schema change, or inferred financial dates.
Usage: python backend/rebuild_score_snapshot.py
"""
import json
import sqlite3
from pathlib import Path

from scoring import score_universe, number

ROOT = Path(__file__).resolve().parents[1]


def rebuild():
    path = ROOT / "frontend/src/data.js"
    text = path.read_text(encoding="utf-8")
    stocks = json.loads(text.split("export const STOCKS =", 1)[1].split("export const ALERTS", 1)[0].strip().rstrip(";"))
    alerts = text.split("export const ALERTS", 1)[1]
    database = ROOT / "backend/data/quantedge.db"
    bars = {}
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        for stock in stocks:
            bars[stock["ticker"]] = [dict(row) for row in conn.execute(
                "SELECT trade_date, close FROM daily_bars WHERE ticker=? ORDER BY trade_date", (stock["ticker"],))]
            for key in ("marketCap", "revenue", "aum"):
                stock[key] = number(stock.get(key))
            # Unversioned snapshots often contain fallback zero premiums. No matching NAV timestamp = unknown.
            if not stock.get("premiumDiscountAsOf"):
                stock["premiumDiscount"] = None
    score_universe(stocks, bars)
    path.write_text("// Scoring v3 rebuilt from local dated bars; prices and financial dates are not refreshed.\n\nexport const STOCKS = "
                    + json.dumps(stocks, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                    + ";\n\nexport const ALERTS" + alerts, encoding="utf-8")
    print(json.dumps({"total": len(stocks), "rated": sum(s["score"] is not None for s in stocks),
                      "pending": sum(s["score"] is None for s in stocks),
                      "dates": sorted(set(s["scoring"]["priceAsOf"] for s in stocks if s["scoring"]["priceAsOf"]))}, ensure_ascii=False))


if __name__ == "__main__":
    rebuild()
