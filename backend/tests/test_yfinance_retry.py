"""
test_yfinance_retry — yfinance_source 重试 + 指数退避单测（mock，无网络、无 sleep）

覆盖：
- _with_retry 行为：成功不重试 / 失败重试 / 延迟序列 / 放弃语义
- fetch_history 集成：tk.history 异常包成 YFinanceError 后重试
- fetch_fundamentals 集成：tk.info 失败重试
- 配置：max_attempts / base_delay / module-level 常量
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import yfinance_source  # noqa: E402
from data_sources.yfinance_source import (  # noqa: E402
    YFinanceError,
    _with_retry,
    fetch_fundamentals,
    fetch_history,
)


SPY_CFG = {"yf_symbol": "SPY", "market": "US", "name": "SPY"}


# ── _with_retry 行为 ─────────────────────────────────────

class TestWithRetry:
    def test_first_call_succeeds_no_retry(self):
        fn = MagicMock(return_value="ok")
        sleeps: list[float] = []
        out = _with_retry(fn, "arg1", max_attempts=3, base_delay=1.0,
                          sleep=sleeps.append)
        assert out == "ok"
        assert fn.call_count == 1
        assert sleeps == []

    def test_retries_until_success(self):
        """前 2 次抛 YFinanceError，第 3 次返回。"""
        fn = MagicMock(side_effect=[
            YFinanceError("net 1"),
            YFinanceError("net 2"),
            "ok",
        ])
        sleeps: list[float] = []
        out = _with_retry(fn, max_attempts=3, base_delay=1.0, sleep=sleeps.append)
        assert out == "ok"
        assert fn.call_count == 3
        # 指数退避: 1.0, 2.0（第 3 次成功，不 sleep）
        assert sleeps == [1.0, 2.0]

    def test_all_attempts_fail_raises_last(self):
        last_exc = YFinanceError("final boom")
        fn = MagicMock(side_effect=[
            YFinanceError("net 1"),
            YFinanceError("net 2"),
            last_exc,
        ])
        sleeps: list[float] = []
        with pytest.raises(YFinanceError, match="final boom"):
            _with_retry(fn, max_attempts=3, base_delay=1.0, sleep=sleeps.append)
        assert fn.call_count == 3
        # 最后一次不 sleep
        assert sleeps == [1.0, 2.0]

    def test_logs_giveup_on_final_failure(self, capsys):
        fn = MagicMock(side_effect=YFinanceError("boom"))
        fn.__name__ = "doomed_fn"
        with pytest.raises(YFinanceError):
            _with_retry(fn, max_attempts=2, base_delay=0.0, sleep=lambda _: None)
        err = capsys.readouterr().err
        assert "重试 2 次后放弃" in err
        assert "doomed_fn" in err

    def test_logs_intermediate_failures(self, capsys):
        fn = MagicMock(side_effect=[YFinanceError("boom1"), "ok"])
        fn.__name__ = "tricky_fn"
        out = _with_retry(fn, max_attempts=2, base_delay=0.0, sleep=lambda _: None)
        assert out == "ok"
        err = capsys.readouterr().err
        assert "第 1/2 次失败" in err
        assert "tricky_fn" in err

    def test_max_attempts_one_no_retry(self):
        fn = MagicMock(side_effect=YFinanceError("boom"))
        sleeps: list[float] = []
        with pytest.raises(YFinanceError):
            _with_retry(fn, max_attempts=1, base_delay=1.0, sleep=sleeps.append)
        assert fn.call_count == 1
        assert sleeps == []

    def test_max_attempts_zero_treated_as_one(self):
        """max_attempts < 1 视为 1，不死循环也不跳过。"""
        fn = MagicMock(side_effect=YFinanceError("boom"))
        with pytest.raises(YFinanceError):
            _with_retry(fn, max_attempts=0, base_delay=0.0, sleep=lambda _: None)
        assert fn.call_count == 1

    def test_custom_base_delay(self):
        fn = MagicMock(side_effect=[
            YFinanceError("e"), YFinanceError("e"), "ok",
        ])
        sleeps: list[float] = []
        _with_retry(fn, max_attempts=3, base_delay=0.5, sleep=sleeps.append)
        assert sleeps == [0.5, 1.0]

    def test_uses_module_default_when_args_none(self):
        """不传 max_attempts/base_delay 时走 module-level 常量。"""
        fn = MagicMock(return_value="ok")
        # 临时改 module-level 常量
        with patch.object(yfinance_source, "YFINANCE_RETRY_MAX", 5), \
             patch.object(yfinance_source, "YFINANCE_RETRY_BASE_DELAY", 2.0):
            fn.side_effect = [YFinanceError("e")] * 4 + ["ok"]
            sleeps: list[float] = []
            out = _with_retry(fn, sleep=sleeps.append)
        assert out == "ok"
        assert fn.call_count == 5
        # 2.0 × [1, 2, 4, 8] = [2.0, 4.0, 8.0, 16.0]
        assert sleeps == [2.0, 4.0, 8.0, 16.0]


# ── fetch_history 集成 ───────────────────────────────────

def _df(rows: int = 5) -> pd.DataFrame:
    return pd.DataFrame(
        {"Open": [1.0]*rows, "High": [1.0]*rows, "Low": [1.0]*rows,
         "Close": [1.0]*rows, "Volume": [100]*rows},
        index=pd.date_range("2026-05-01", periods=rows, freq="D"),
    )


class TestFetchHistoryRetry:
    def test_network_exception_wrapped_and_retried(self):
        """tk.history 抛 ConnectionError → 包成 YFinanceError → 重试到成功。"""
        tk_fail = MagicMock()
        tk_fail.history = MagicMock(side_effect=ConnectionError("simulated 429"))
        tk_ok = MagicMock()
        tk_ok.history = MagicMock(return_value=_df(5))

        # 第 1 次返回 tk_fail（抛错），第 2 次返回 tk_ok
        with patch.object(yfinance_source.yf, "Ticker",
                          side_effect=[tk_fail, tk_ok]), \
             patch("data_sources.yfinance_source.time.sleep") as mock_sleep:
            df = fetch_history(SPY_CFG, days=30)
        assert len(df) == 5
        assert tk_fail.history.call_count == 1
        assert tk_ok.history.call_count == 1
        mock_sleep.assert_called_once_with(1.0)

    def test_empty_then_fallback_then_empty_retries(self):
        """daily empty → fallback 1mo empty → YFinanceError → 重试一次成功。"""
        empty = pd.DataFrame()
        ok = _df(5)

        # 每次 Ticker 创建后 .history 被调用：第 1 次 2 调用（6mo+1mo 都 empty），
        # 第 2 次 1 调用就成功
        tk1 = MagicMock()
        tk1.history = MagicMock(side_effect=[empty, empty])
        tk2 = MagicMock()
        tk2.history = MagicMock(return_value=ok)

        with patch.object(yfinance_source.yf, "Ticker",
                          side_effect=[tk1, tk2]), \
             patch("data_sources.yfinance_source.time.sleep"):
            df = fetch_history(SPY_CFG, days=30)
        assert len(df) == 5

    def test_gives_up_after_max_attempts(self):
        tk = MagicMock()
        tk.history = MagicMock(side_effect=ConnectionError("persistent"))
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk), \
             patch("data_sources.yfinance_source.time.sleep"), \
             patch.object(yfinance_source, "YFINANCE_RETRY_MAX", 3):
            with pytest.raises(YFinanceError, match="persistent"):
                fetch_history(SPY_CFG, days=30)
        # daily: 每次 fetch_history 内部最多 2 次 .history（6mo + 1mo fallback）
        # 第 1 次 .history 抛 ConnectionError 就 break out，不走 fallback
        assert tk.history.call_count == 3  # 3 attempts × 1 失败调用

    def test_no_retry_on_first_success(self):
        tk = MagicMock()
        tk.history = MagicMock(return_value=_df(5))
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk), \
             patch("data_sources.yfinance_source.time.sleep") as mock_sleep:
            df = fetch_history(SPY_CFG, days=30)
        assert len(df) == 5
        assert tk.history.call_count == 1
        mock_sleep.assert_not_called()


# ── fetch_fundamentals 集成 ──────────────────────────────

class TestFetchFundamentalsRetry:
    def test_info_failure_retries(self):
        """tk.info 抛 ConnectionError 第 1 次，第 2 次返回 → 重试成功。"""
        tk1 = MagicMock()
        # .info 是 property — 用 PropertyMock 模拟抛错
        type(tk1).info = property(
            lambda self: (_ for _ in ()).throw(ConnectionError("net"))
        )
        tk2 = MagicMock()
        tk2.info = {
            "trailingPE": 15.0, "priceToBook": 2.0,
            "dividendYield": 0.03, "returnOnEquity": 0.18,
            "debtToEquity": 80.0,
        }
        with patch.object(yfinance_source.yf, "Ticker",
                          side_effect=[tk1, tk2]), \
             patch("data_sources.yfinance_source.time.sleep"):
            r = fetch_fundamentals("AAPL")
        assert r["pe"] == 15.0
        assert r["debt_to_equity"] == 0.80

    def test_info_all_fail_raises(self):
        tk = MagicMock()
        type(tk).info = property(
            lambda self: (_ for _ in ()).throw(ConnectionError("persistent"))
        )
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk), \
             patch("data_sources.yfinance_source.time.sleep"), \
             patch.object(yfinance_source, "YFINANCE_RETRY_MAX", 2):
            with pytest.raises(YFinanceError, match="persistent"):
                fetch_fundamentals("AAPL")

    def test_empty_symbol_no_retry_just_raises(self):
        """yf_symbol 为空 → 立即抛错，不消耗重试次数。"""
        with patch("data_sources.yfinance_source.time.sleep") as mock_sleep:
            with pytest.raises(YFinanceError, match="yf_symbol 不能为空"):
                fetch_fundamentals("")
        mock_sleep.assert_not_called()


# ── 环境变量配置 ─────────────────────────────────────────

class TestEnvConfig:
    def test_env_int_default_on_unset(self, monkeypatch):
        monkeypatch.delenv("FAKE_KEY", raising=False)
        assert yfinance_source._env_int("FAKE_KEY", 7) == 7

    def test_env_int_overrides(self, monkeypatch):
        monkeypatch.setenv("FAKE_KEY", "42")
        assert yfinance_source._env_int("FAKE_KEY", 7) == 42

    def test_env_int_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("FAKE_KEY", "not-an-int")
        assert yfinance_source._env_int("FAKE_KEY", 7) == 7

    def test_env_float_overrides(self, monkeypatch):
        monkeypatch.setenv("FAKE_KEY", "0.25")
        assert yfinance_source._env_float("FAKE_KEY", 1.0) == 0.25

    def test_env_float_bad_value_falls_back(self, monkeypatch):
        monkeypatch.setenv("FAKE_KEY", "x")
        assert yfinance_source._env_float("FAKE_KEY", 1.0) == 1.0


# ── YFINANCE_HISTORY_TIMEOUT 行为 ────────────────────────

class TestHistoryTimeout:
    def test_default_timeout_passed_to_yfinance(self):
        """默认 timeout 从模块常量取，并显式传入 tk.history。"""
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        from unittest.mock import MagicMock
        tk = MagicMock()
        tk.history = MagicMock(return_value=df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            yfinance_source.fetch_history(SPY_CFG, days=30)
        kwargs = tk.history.call_args.kwargs
        assert "timeout" in kwargs
        assert kwargs["timeout"] == yfinance_source.YFINANCE_HISTORY_TIMEOUT

    def test_module_constant_override_takes_effect(self):
        """改 YFINANCE_HISTORY_TIMEOUT 模块常量后下次调用立即生效。"""
        df = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        from unittest.mock import MagicMock
        tk = MagicMock()
        tk.history = MagicMock(return_value=df)
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk), \
             patch.object(yfinance_source, "YFINANCE_HISTORY_TIMEOUT", 5.0):
            yfinance_source.fetch_history(SPY_CFG, days=30)
        assert tk.history.call_args.kwargs["timeout"] == 5.0

    def test_default_value_is_30_seconds(self):
        """文档/语义保证：模块默认是 30 秒（yfinance 内置 10s 偏短）。"""
        # 任何 import 时未设 env var → 默认 30.0
        # 这测试只在没有 env var 时有意义；如果 CI 设了就跳过
        import os
        if "YFINANCE_HISTORY_TIMEOUT" in os.environ:
            pytest.skip("YFINANCE_HISTORY_TIMEOUT env var 已设，跳过默认值检查")
        assert yfinance_source.YFINANCE_HISTORY_TIMEOUT == 30.0

    def test_fallback_1mo_also_carries_timeout(self):
        """日 K 第一次 empty 回退 1mo 时，第二次调用也应带 timeout。"""
        from unittest.mock import MagicMock
        empty = pd.DataFrame()
        non_empty = pd.DataFrame(
            {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
            index=pd.DatetimeIndex(["2026-05-01"]),
        )
        tk = MagicMock()
        tk.history = MagicMock(side_effect=[empty, non_empty])
        with patch.object(yfinance_source.yf, "Ticker", return_value=tk):
            yfinance_source.fetch_history(SPY_CFG, days=30)
        assert tk.history.call_count == 2
        # 两次调用都带 timeout
        assert "timeout" in tk.history.call_args_list[0].kwargs
        assert "timeout" in tk.history.call_args_list[1].kwargs
