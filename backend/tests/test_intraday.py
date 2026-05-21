"""
test_intraday — Interval 枚举 + yfinance/router intraday 路径单测（mock，无网络）
"""
from __future__ import annotations

import json
import sys
from datetime import timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import Interval  # noqa: E402
from data_sources import yfinance_source, router  # noqa: E402
from data_sources._intervals import (  # noqa: E402
    max_lookback_days,
    yfinance_period_for,
)


SPY_CFG = {"yf_symbol": "SPY", "market": "US", "name": "SPY"}


# ── Interval 枚举 ─────────────────────────────────────────

class TestIntervalEnum:
    def test_from_str_known(self):
        assert Interval.from_str("1m") is Interval.MIN_1
        assert Interval.from_str("1d") is Interval.DAY_1
        assert Interval.from_str("1h") is Interval.HOUR_1

    def test_from_str_passthrough(self):
        assert Interval.from_str(Interval.MIN_5) is Interval.MIN_5

    def test_from_str_unknown_raises(self):
        with pytest.raises(ValueError, match="未知 interval"):
            Interval.from_str("2m")

    def test_is_intraday(self):
        assert Interval.MIN_1.is_intraday
        assert Interval.MIN_5.is_intraday
        assert Interval.MIN_15.is_intraday
        assert Interval.HOUR_1.is_intraday
        assert not Interval.DAY_1.is_intraday

    def test_string_value_matches_yfinance(self):
        # value 直接拿去喂 yfinance.history(interval=...) 必须是合法字符串
        for iv in Interval:
            assert iv.value in {"1m", "5m", "15m", "1h", "1d"}


class TestPeriodMapping:
    def test_daily_short_returns_3mo(self):
        assert yfinance_period_for(Interval.DAY_1, days=30) == "3mo"

    def test_daily_long_returns_6mo(self):
        assert yfinance_period_for(Interval.DAY_1, days=120) == "6mo"

    def test_min1_returns_7d(self):
        assert yfinance_period_for(Interval.MIN_1, days=5) == "7d"
        # days 即便很大也不会超过 7d 上限
        assert yfinance_period_for(Interval.MIN_1, days=999) == "7d"

    def test_min5_returns_60d(self):
        assert yfinance_period_for(Interval.MIN_5, days=10) == "60d"

    def test_hour1_returns_730d(self):
        assert yfinance_period_for(Interval.HOUR_1, days=10) == "730d"

    def test_max_lookback_days(self):
        assert max_lookback_days(Interval.MIN_1) == 7
        assert max_lookback_days(Interval.MIN_5) == 60
        assert max_lookback_days(Interval.HOUR_1) == 730
        assert max_lookback_days(Interval.DAY_1) == 180


# ── yfinance_source.fetch_history ─────────────────────────

def _mock_ticker(df: pd.DataFrame):
    """构造一个 yfinance.Ticker mock，其 .history 返回指定 df 并记录参数。"""
    tk = MagicMock()
    tk.history = MagicMock(return_value=df)
    return tk


class TestYFinanceSourceFetchHistory:
    def test_daily_default_passes_no_interval_param_change(self):
        """日 K 默认调用，验证 period=3mo (days<=90)，interval='1d'。"""
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        tk = _mock_ticker(df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            out = yfinance_source.fetch_history(SPY_CFG, days=30)
        tk.history.assert_called_once_with(period="3mo", interval="1d")
        assert list(out.columns) == ["Open", "High", "Low", "Close", "Volume"]
        # 日 K 保持 tz-naive
        assert out.index.tz is None

    def test_daily_long_period_uses_6mo(self):
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        tk = _mock_ticker(df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            yfinance_source.fetch_history(SPY_CFG, days=180)
        tk.history.assert_called_once_with(period="6mo", interval="1d")

    def test_intraday_1m_passes_7d_and_converts_to_utc(self):
        """分钟级：period='7d' interval='1m'，且 ET tz-aware → UTC。"""
        et_idx = pd.DatetimeIndex(
            ["2026-05-08 09:30:00", "2026-05-08 09:31:00"]
        ).tz_localize("America/New_York")
        df = pd.DataFrame(
            {
                "Open": [1.0, 1.1], "High": [1.0, 1.1], "Low": [1.0, 1.1],
                "Close": [1.0, 1.1], "Volume": [100, 200],
                # yfinance intraday 多余列，应被 drop
                "Adj Close": [1.0, 1.1], "Dividends": [0.0, 0.0],
                "Stock Splits": [0.0, 0.0], "Capital Gains": [0.0, 0.0],
            },
            index=et_idx,
        )
        tk = _mock_ticker(df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            out = yfinance_source.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)
        tk.history.assert_called_once_with(period="7d", interval="1m")
        # 列被规范化为 OHLCV
        assert list(out.columns) == ["Open", "High", "Low", "Close", "Volume"]
        # tz 转 UTC
        assert out.index.tz is not None
        assert out.index.tz.utcoffset(None) == timezone.utc.utcoffset(None)
        # 09:30 ET (UTC-4 夏令时) → 13:30 UTC
        assert out.index[0].strftime("%H:%M") == "13:30"

    def test_intraday_accepts_string(self):
        et_idx = pd.DatetimeIndex(["2026-05-08 09:30:00"]).tz_localize("America/New_York")
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=et_idx,
        )
        tk = _mock_ticker(df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            yfinance_source.fetch_history(SPY_CFG, days=5, interval="5m")
        tk.history.assert_called_once_with(period="60d", interval="5m")

    def test_empty_intraday_raises_immediately(self):
        """分钟级空 df 直接抛错（不再 fallback 1mo）。

        禁用重试（max_attempts=1）以隔离"是否 fallback 1mo"这个行为；
        重试本身另见 test_yfinance_retry.py。
        """
        empty = pd.DataFrame()
        tk = _mock_ticker(empty)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk), \
             patch.object(yfinance_source, "YFINANCE_RETRY_MAX", 1):
            with pytest.raises(yfinance_source.YFinanceError, match="interval=1m"):
                yfinance_source.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)
        # 仅 1 次调用，不像日 K 那样再试 1mo
        assert tk.history.call_count == 1

    def test_empty_daily_falls_back_to_1mo(self):
        """日 K 空时回退 period=1mo（旧行为保留）。"""
        empty = pd.DataFrame()
        non_empty = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        tk = MagicMock()
        tk.history = MagicMock(side_effect=[empty, non_empty])
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            out = yfinance_source.fetch_history(SPY_CFG, days=30)
        assert tk.history.call_count == 2
        assert tk.history.call_args_list[1].kwargs == {"period": "1mo"}
        assert len(out) == 1


# ── router.fetch_history ──────────────────────────────────

def _mk_intraday_df(rows: int = 10) -> pd.DataFrame:
    idx = pd.date_range("2026-05-08 13:30", periods=rows, freq="1min", tz="UTC")
    return pd.DataFrame(
        {
            "Open": [1.0] * rows, "High": [1.0] * rows, "Low": [1.0] * rows,
            "Close": [1.0] * rows, "Volume": [100] * rows,
        },
        index=idx,
    )


class TestRouterIntraday:
    def test_intraday_skips_db_and_other_sources(self):
        """interval=1m 时跳过 L0/L1/L2/L3，直接 yfinance。"""
        df = _mk_intraday_df(rows=10)
        with patch.object(
            router.yfinance_source, "fetch_history", return_value=df
        ) as mock_yf, patch.object(
            router, "_db", MagicMock()
        ) as mock_db, patch.object(
            router, "HAS_DB", True
        ), patch.object(
            router, "HAS_YFINANCE", True
        ):
            out, src = router.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)
        assert src == "yfinance"
        assert len(out) == 10
        # yfinance 被调用，且传了 interval
        mock_yf.assert_called_once()
        assert mock_yf.call_args.kwargs.get("interval") == Interval.MIN_1
        # SQLite L0 完全没访问
        mock_db.get_latest_bar_date.assert_not_called()
        mock_db.get_bars.assert_not_called()

    def test_intraday_accepts_string(self):
        df = _mk_intraday_df(rows=10)
        with patch.object(
            router.yfinance_source, "fetch_history", return_value=df
        ) as mock_yf, patch.object(router, "HAS_YFINANCE", True):
            _, src = router.fetch_history(SPY_CFG, days=5, interval="5m")
        assert src == "yfinance"
        assert mock_yf.call_args.kwargs.get("interval") == Interval.MIN_5

    def test_intraday_too_few_rows_raises(self):
        too_few = _mk_intraday_df(rows=3)
        with patch.object(
            router.yfinance_source, "fetch_history", return_value=too_few
        ), patch.object(router, "HAS_YFINANCE", True):
            with pytest.raises(RuntimeError, match="intraday 拉取失败"):
                router.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)

    def test_intraday_yfinance_unavailable_raises(self):
        with patch.object(router, "HAS_YFINANCE", False):
            with pytest.raises(RuntimeError, match="intraday 仅支持 yfinance"):
                router.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)

    def test_intraday_invalid_string_raises(self):
        with pytest.raises(ValueError, match="未知 interval"):
            router.fetch_history(SPY_CFG, days=5, interval="2m")

    def test_daily_default_does_not_touch_yfinance_intraday_path(self):
        """interval=DAY_1（默认）时仍走原 L0-L4 路由，不命中 intraday 早退。"""
        daily_df = pd.DataFrame(
            {"Open": [1.0] * 10, "High": [1.0] * 10, "Low": [1.0] * 10,
             "Close": [1.0] * 10, "Volume": [1] * 10},
            index=pd.date_range("2026-05-01", periods=10, freq="D"),
        )
        # 跳过 L0/L1/L2/L3，让 yfinance 兜底返回
        with patch.object(
            router.yfinance_source, "fetch_history", return_value=daily_df
        ) as mock_yf, patch.object(
            router, "HAS_DB", False
        ), patch.object(
            router, "HAS_TUSHARE", False
        ), patch.object(
            router, "HAS_ITICK", False
        ), patch.object(
            router, "HAS_FUTU", False
        ), patch.object(router, "HAS_YFINANCE", True):
            _, src = router.fetch_history(SPY_CFG, days=30)
        assert src == "yfinance"
        # 没传 interval（向后兼容）
        assert "interval" not in mock_yf.call_args.kwargs


# ── pipeline_intraday CLI ─────────────────────────────────

class TestPipelineIntradayCLI:
    def test_df_to_records_intraday_utc(self):
        import pipeline_intraday

        idx = pd.date_range("2026-05-08 13:30", periods=2, freq="1min", tz="UTC")
        df = pd.DataFrame(
            {"Open": [1.0, 2.0], "High": [1.5, 2.5], "Low": [0.5, 1.5],
             "Close": [1.2, 2.2], "Volume": [100, 200]},
            index=idx,
        )
        recs = pipeline_intraday._df_to_records(df)
        assert len(recs) == 2
        assert recs[0]["timestamp"] == "2026-05-08T13:30:00+00:00"
        assert recs[0]["open"] == 1.0
        assert recs[0]["volume"] == 100

    def test_df_to_records_daily_tz_naive(self):
        import pipeline_intraday

        idx = pd.DatetimeIndex(["2026-05-08"])
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=idx,
        )
        recs = pipeline_intraday._df_to_records(df)
        assert len(recs) == 1
        # tz-naive 也能序列化
        assert "2026-05-08" in recs[0]["timestamp"]

    def test_fetch_intraday_routes_through_router(self):
        import pipeline_intraday

        df = _mk_intraday_df(rows=5)
        with patch.object(
            pipeline_intraday, "fetch_history", return_value=(df, "yfinance")
        ) as mock_fetch:
            recs, src = pipeline_intraday.fetch_intraday(
                ticker="SPY", interval="1m", lookback_days=5, market="US",
            )
        assert src == "yfinance"
        assert len(recs) == 5
        cfg_arg = mock_fetch.call_args.args[0]
        assert cfg_arg == {"yf_symbol": "SPY", "market": "US", "name": "SPY"}
        assert mock_fetch.call_args.kwargs.get("days") == 5
        assert mock_fetch.call_args.kwargs.get("interval") is Interval.MIN_1

    def test_main_writes_csv_to_stdout(self, capsys):
        import pipeline_intraday

        df = _mk_intraday_df(rows=2)
        with patch.object(pipeline_intraday, "fetch_history", return_value=(df, "yfinance")):
            rc = pipeline_intraday.main(
                ["--ticker", "SPY", "--interval", "1m", "--lookback-days", "5"]
            )
        assert rc == 0
        captured = capsys.readouterr()
        # stdout 是 CSV
        lines = captured.out.strip().splitlines()
        assert lines[0] == "timestamp,open,high,low,close,volume"
        assert len(lines) == 1 + 2  # header + 2 rows
        # stderr 有 src/rows 摘要
        assert "rows=2" in captured.err
        assert "src=yfinance" in captured.err

    def test_main_writes_json_file(self, tmp_path):
        import pipeline_intraday

        df = _mk_intraday_df(rows=3)
        out = tmp_path / "spy_1m.json"
        with patch.object(pipeline_intraday, "fetch_history", return_value=(df, "yfinance")):
            rc = pipeline_intraday.main(
                ["--ticker", "SPY", "--interval", "1m",
                 "--lookback-days", "5", "--out", str(out)]
            )
        assert rc == 0
        data = json.loads(out.read_text(encoding="utf-8"))
        assert len(data) == 3
        assert "timestamp" in data[0]
        assert data[0]["volume"] == 100

    def test_main_invalid_interval_argparse_exits(self):
        import pipeline_intraday

        with pytest.raises(SystemExit):
            pipeline_intraday.main(
                ["--ticker", "SPY", "--interval", "2m", "--lookback-days", "5"]
            )

    def test_main_fetch_failure_returns_nonzero(self, capsys):
        import pipeline_intraday

        with patch.object(
            pipeline_intraday, "fetch_history",
            side_effect=RuntimeError("simulated network fail"),
        ):
            rc = pipeline_intraday.main(
                ["--ticker", "SPY", "--interval", "1m", "--lookback-days", "5"]
            )
        assert rc == 1
        captured = capsys.readouterr()
        assert "FAILED" in captured.err
        assert "simulated network fail" in captured.err


# ── /api/intraday TestClient ──────────────────────────────

class TestIntradayApi:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        import server  # noqa: F401  — import 一次足够
        return TestClient(server.app), server

    def test_intraday_endpoint_returns_bars(self, client):
        c, server_mod = client
        df = _mk_intraday_df(rows=10)
        with patch.object(server_mod, "fetch_history", return_value=(df, "yfinance")):
            r = c.get("/api/intraday", params={
                "ticker": "SPY", "interval": "1m", "lookback_days": 5,
            })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ticker"] == "SPY"
        assert body["interval"] == "1m"
        assert body["source"] == "yfinance"
        assert body["count"] == 10
        assert len(body["bars"]) == 10
        # 时间戳序列化为 UTC ISO8601
        assert body["bars"][0]["timestamp"].endswith("+00:00")

    def test_intraday_passes_interval_enum_to_fetch(self, client):
        c, server_mod = client
        df = _mk_intraday_df(rows=2)
        with patch.object(
            server_mod, "fetch_history", return_value=(df, "yfinance")
        ) as mock_fetch:
            c.get("/api/intraday", params={"ticker": "SPY", "interval": "5m"})
        assert mock_fetch.call_args.kwargs["interval"] is Interval.MIN_5
        assert mock_fetch.call_args.kwargs["days"] == 5  # default lookback_days

    def test_intraday_unknown_interval_returns_400(self, client):
        c, _ = client
        r = c.get("/api/intraday", params={"ticker": "SPY", "interval": "2m"})
        assert r.status_code == 400
        assert "未知 interval" in r.text

    def test_intraday_fetch_failure_returns_502(self, client):
        c, server_mod = client
        with patch.object(
            server_mod, "fetch_history",
            side_effect=RuntimeError("upstream timeout"),
        ):
            r = c.get("/api/intraday", params={"ticker": "SPY", "interval": "1m"})
        assert r.status_code == 502
        assert "upstream timeout" in r.text

    def test_intraday_start_end_filters_window(self, client):
        c, server_mod = client
        df = _mk_intraday_df(rows=10)  # 2026-05-08 13:30..13:39 UTC
        with patch.object(server_mod, "fetch_history", return_value=(df, "yfinance")):
            r = c.get("/api/intraday", params={
                "ticker": "SPY", "interval": "1m",
                "start": "2026-05-08T13:33:00+00:00",
                "end":   "2026-05-08T13:36:59+00:00",
            })
        assert r.status_code == 200, r.text
        body = r.json()
        # 13:33, 13:34, 13:35, 13:36 = 4 bars
        assert body["count"] == 4
        assert body["bars"][0]["timestamp"].startswith("2026-05-08T13:33")
        assert body["bars"][-1]["timestamp"].startswith("2026-05-08T13:36")

    def test_intraday_volume_is_int_not_float(self, client):
        c, server_mod = client
        df = _mk_intraday_df(rows=1)
        with patch.object(server_mod, "fetch_history", return_value=(df, "yfinance")):
            r = c.get("/api/intraday", params={"ticker": "SPY", "interval": "1m"})
        body = r.json()
        assert isinstance(body["bars"][0]["volume"], int)


# ── 真实网络拉数据（默认跳过，本地 -m network 跑）────────

@pytest.mark.network
def test_fetch_intraday_spy_live():
    """SPY 1m × 过去 5-7 天，sanity check：足量、UTC、无 NaN Close。"""
    df, src = router.fetch_history(SPY_CFG, days=5, interval=Interval.MIN_1)
    assert src == "yfinance"
    # 5 个交易日 × 390，留 1 个交易日缓冲
    assert len(df) >= 4 * 390, f"分钟 K 数量异常: {len(df)} from {src}"
    assert df.index.tz is not None
    assert str(df.index.tz) == "UTC"
    assert int(df["Close"].isna().sum()) == 0
