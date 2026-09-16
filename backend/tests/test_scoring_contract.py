"""Regression and cross-runtime tests for scoring v3. No live market requests."""
import copy
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scoring import score_universe, prepare_inputs, number, MODEL_VERSION, record_score_history, asset_metadata

ROOT = Path(__file__).resolve().parents[2]


def universe():
    stocks, bars = [], {}
    for kind in ("stock", "index", "single", "inverse", "crypto"):
        for i in range(9):
            t = f"{kind}{i}"
            stock = {"ticker": t, "market": "US", "currency": "USD", "financialCurrency": "USD", "marketCapCurrency": "USD",
                     "gicsSector": "Technology", "pe": 10 + i * 4, "pb": 2, "roe": i * 3, "profitMargin": i * 2,
                     "revenueGrowth": i * 5, "marketCap": "10B", "revenue": "800M"}
            if kind in ("index", "single", "inverse"):
                stock.update(isETF=True, leverage="-2x" if kind == "inverse" else "2x" if kind == "single" else None,
                             underlyingType="stock" if kind == "single" else "index", expenseRatio=.5, aum="2B", concentrationTop3=40)
            if kind == "crypto": stock.update(assetType="crypto", cryptoCategory="network")
            stocks.append(stock)
            bars[t] = [{"date": (date(2025, 1, 1) + timedelta(days=j)).isoformat(), "close": 100 + j * (i + 1) * .04 + (j % 7) * .3} for j in range(250)]
    # Missing, cross-currency, zero values, unsupported and malformed histories.
    stocks.extend([
        {"ticker": "TQQQ", "market": "US"},
        {"ticker": "EWY", "market": "US"},
        {"ticker": "RKLX", "market": "US", "issuer": "GraniteShares"},
        {"ticker": "RKLB", "market": "US", "pe": 20, "pb": 2, "roe": 20, "profitMargin": 10, "revenueGrowth": 20},
        {"ticker": "MISSING", "market": "US"},
        {**stocks[0], "ticker": "FX", "financialCurrency": "CNY"},
        {"ticker": "UNKNOWN", "market": "US", "isETF": True, "etfType": "2倍杠杆ETF"},
        {**stocks[1], "ticker": "BAD"},
    ])
    bars["FX"] = bars["stock0"]
    bars["BAD"] = [{"close": 10}, {"close": -1}] * 150
    return stocks, bars


def test_browser_python_contract_and_daily_inputs():
    stocks, bars = universe()
    expected = copy.deepcopy(stocks)
    score_universe(expected, bars)
    script = """
      import { scoreUniverse, prepareInputs } from './frontend/src/lib/scoring.js';
      let input = ''; for await (const chunk of process.stdin) input += chunk;
      const { stocks, bars } = JSON.parse(input);
      for (const s of stocks) s.scoringInputs = prepareInputs(s, bars[s.ticker] || []);
      console.log(JSON.stringify(scoreUniverse(stocks)));
    """
    run = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps({"stocks": stocks, "bars": bars}),
                         text=True, capture_output=True, encoding="utf-8", cwd=ROOT, check=True)
    actual = {s["ticker"]: s for s in json.loads(run.stdout)}
    for s in expected:
        other = actual[s["ticker"]]
        for key in ("score", "qualityScore", "timingScore", "subScores", "scoring", "assetType", "direction", "rank", "assetAssessment"):
            assert other.get(key) == s.get(key), (s["ticker"], key, s.get(key), other.get(key))


def test_missing_is_not_neutral_and_unknown_leverage_is_not_plain_etf():
    s, b = universe()
    score_universe(s, b)
    by = {x["ticker"]: x for x in s}
    assert by["MISSING"]["score"] is None
    assert by["MISSING"]["qualityScore"] is None
    assert by["UNKNOWN"]["assetType"] == "unclassified_etf"
    assert by["UNKNOWN"]["score"] is None
    assert by["crypto0"]["qualityScore"] is None
    assert by["crypto0"]["timingScore"] is not None
    assert by["crypto0"]["score"] is None
    assert by["BAD"]["timingScore"] is None


def test_units_currency_and_actual_peer_counts():
    assert number("1.25T") == 1.25e12
    assert number("800M") == 800e6
    assert number("N/A") is None
    assert number(True) is None
    s, b = universe()
    score_universe(s, b)
    by = {x["ticker"]: x for x in s}
    assert by["stock0"]["scoring"]["factorPeerCounts"]["sy"] == 10
    assert by["FX"]["scoring"]["factorPeerCounts"]["sy"] == 0


def test_missing_premium_is_not_zero_and_total_has_no_universe_zscore():
    s, b = universe()
    score_universe(s, b)
    by = {x["ticker"]: x for x in s}
    assert by["index0"]["subScores"]["cost"] is None
    assert by["index0"]["assetAssessment"]["product"]["coverage"] == 0
    base = by["stock0"]["score"]
    stock = by["stock0"]
    assert base == round(.6 * stock["qualityScore"] + .4 * stock["timingScore"], 1)
    s.extend([{"ticker": f"different{i}", "market": "OTHER"} for i in range(30)])
    score_universe(s)
    assert next(x for x in s if x["ticker"] == "stock0")["score"] == base


def test_legacy_cache_and_duplicate_dates_do_not_supply_timing():
    s = {"ticker": "LEGACY", "market": "US", "qualityScore": 99, "timingScore": 99, "score": 99,
         "scoringInputs": {"version": "2", "trend": 99, "rsi": 99, "momentum": .9}}
    score_universe([s])
    assert s["score"] is None
    assert s["scoring"]["version"] == MODEL_VERSION
    inp = prepare_inputs(s, [{"date": "2026-01-01", "close": 10}] * 250)
    assert inp["observations"] == 0
    assert inp["trend"] is None


def test_versioned_history_does_not_merge_legacy_observations(tmp_path):
    legacy = tmp_path / "score_history.json"
    legacy.write_text('{"stock0":[{"date":"2025-09-06","score":99}]}')
    stocks, bars = universe()
    score_universe(stocks, bars)
    path = tmp_path / f"score_history.v{MODEL_VERSION}.json"
    record_score_history(stocks, path)
    s = next(s for s in stocks if s["ticker"] == "stock0")
    assert s["scoreSmoothed"] == s["score"]
    assert s["scoreDelta5d"] is None
    assert s["scoreHistoryVersion"] == MODEL_VERSION
    assert len(json.loads(path.read_text())["stock0"]) == 1
    assert json.loads(legacy.read_text())["stock0"][0]["score"] == 99


def test_verified_product_metadata_corrects_missing_soxs_leverage():
    m = asset_metadata({"ticker": "SOXS", "isETF": True, "leverage": None})
    assert m["assetType"] == "leveraged_index_etf"
    assert m["leverageMultiple"] == -3
    assert m["direction"] == "inverse"
