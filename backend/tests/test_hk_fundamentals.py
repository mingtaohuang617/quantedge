"""
test_hk_fundamentals — pipeline.apply_hk_fundamentals_fallback 集成测试

验证港股财务补充源已正确接入 pipeline:
  yfinance 主路径 None → yfinance .info 兜底重试 → 仍 None 才回落 static_overrides
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import pipeline  # noqa: E402
from pipeline import apply_hk_fundamentals_fallback  # noqa: E402


HK_CFG = {"yf_symbol": "0005.HK", "market": "HK", "name": "HSBC"}
US_CFG = {"yf_symbol": "AAPL", "market": "US", "name": "Apple"}


# ── 字段映射 + 仅 HK + 不覆盖已有值 ──────────────────────

class TestApplyHkFundamentalsFallback:
    def test_non_hk_is_noop(self):
        """美股标的应跳过 yfinance 调用，原 result 不变。"""
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None}
        with patch.object(pipeline, "fetch_hk_fundamentals") as mock_fetch:
            out = apply_hk_fundamentals_fallback(result, US_CFG)
        mock_fetch.assert_not_called()
        assert out == result

    def test_hk_fills_only_none_fields(self):
        """HK 标的 + yfinance 全 None → yfinance 4 字段都被填。"""
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None}
        ak_data = {
            "pe": 8.5, "roe": 11.2, "revenue_growth": 5.3,
            "profit_margin": 28.0, "market_cap": 1.6e12, "eps": 6.7,
        }
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          return_value=(ak_data, "yfinance")):
            out = apply_hk_fundamentals_fallback(result, HK_CFG)
        assert out["pe"] == 8.5
        assert out["roe"] == 11.2
        assert out["revenueGrowth"] == 5.3
        assert out["profitMargin"] == 28.0
        # market_cap / eps 不在 fallback 字段集（避开 fmt_big 复杂度）
        assert "marketCap" not in out
        assert "eps" not in out

    def test_does_not_overwrite_existing_values(self):
        """yfinance 已经给了的字段不被 yfinance 覆盖。"""
        result = {"pe": 9.9, "roe": None, "revenueGrowth": 12.0, "profitMargin": None}
        ak_data = {
            "pe": 8.5, "roe": 11.2, "revenue_growth": 5.3, "profit_margin": 28.0,
        }
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          return_value=(ak_data, "yfinance")):
            out = apply_hk_fundamentals_fallback(result, HK_CFG)
        assert out["pe"] == 9.9                  # 保留 yfinance
        assert out["roe"] == 11.2                # 补 yfinance
        assert out["revenueGrowth"] == 12.0      # 保留 yfinance
        assert out["profitMargin"] == 28.0       # 补 yfinance

    def test_akshare_none_value_does_not_overwrite_none(self):
        """yfinance 字段也是 None → result 字段保持 None。"""
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None}
        ak_data = {"pe": None, "roe": 15.0, "revenue_growth": None, "profit_margin": None}
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          return_value=(ak_data, "yfinance")):
            out = apply_hk_fundamentals_fallback(result, HK_CFG)
        assert out["pe"] is None
        assert out["roe"] == 15.0
        assert out["revenueGrowth"] is None
        assert out["profitMargin"] is None

    def test_empty_akshare_returns_unchanged(self):
        """yfinance 返回空 dict → result 不变。"""
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None}
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          return_value=({}, "none")):
            out = apply_hk_fundamentals_fallback(result, HK_CFG)
        assert all(out[k] is None for k in
                   ("pe", "roe", "revenueGrowth", "profitMargin"))

    def test_akshare_exception_silently_returns(self, capsys):
        """yfinance 抛错应被吞掉 + 日志，不污染 pipeline 主流程。"""
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None}
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          side_effect=RuntimeError("network blip")):
            out = apply_hk_fundamentals_fallback(result, HK_CFG)
        # result 应保持原样
        assert all(out[k] is None for k in
                   ("pe", "roe", "revenueGrowth", "profitMargin"))


# ── 调用顺序契约：apply_overrides 之前调用 ──────────────

class TestFallbackOrder:
    def test_static_overrides_only_fills_what_akshare_left_none(self):
        """链路：yfinance(None) → yfinance(部分 None) → static_overrides(兜余下)。"""
        # 模拟：yfinance 给出 None，yfinance 只给 pe 和 profitMargin，
        # static_overrides 给 roe 和 revenueGrowth
        result = {"pe": None, "roe": None, "revenueGrowth": None, "profitMargin": None,
                  "isETF": False}
        ak_data = {"pe": 8.0, "roe": None, "revenue_growth": None, "profit_margin": 25.0}
        cfg = {
            **HK_CFG,
            "static_overrides": {"pe": 99.0, "roe": 15.0, "revenueGrowth": 5.0,
                                 "profitMargin": 50.0},
        }
        with patch.object(pipeline, "fetch_hk_fundamentals",
                          return_value=(ak_data, "yfinance")):
            result = apply_hk_fundamentals_fallback(result, cfg)
        # yfinance 填了 pe / profitMargin
        assert result["pe"] == 8.0
        assert result["profitMargin"] == 25.0
        assert result["roe"] is None
        assert result["revenueGrowth"] is None
        # 再走 static_overrides
        result = pipeline.apply_overrides(result, cfg)
        # yfinance 已填的不被静态值覆盖（仅 None 才补）
        assert result["pe"] == 8.0           # yfinance 优先于 static
        assert result["profitMargin"] == 25.0
        # yfinance 没填的，static_overrides 补
        assert result["roe"] == 15.0
        assert result["revenueGrowth"] == 5.0


# ── 真实网络拉数据（yfinance .info；CI 用 -m "not network" 排除，仅本地跑）─

@pytest.mark.network
def test_real_0005hk_fundamentals():
    """真实拉 0005.HK 验证 yfinance 港股兜底能出数（在线 sanity check）。

    取代旧 akshare/eastmoney 路径（TLS 指纹反爬不可用）；yfinance .info 对
    港股小池子稳定，汇丰应给全 pe/roe/profit_margin。
    """
    data, src = pipeline.fetch_hk_fundamentals(HK_CFG)
    assert isinstance(data, dict)
    assert src == "yfinance"
    # 至少一个数值字段非空（yfinance .info 正常应给全 pe/roe/profit_margin）
    has_any = any(data.get(k) is not None for k in
                  ("pe", "roe", "revenue_growth", "profit_margin"))
    assert has_any, f"yfinance 港股完全无数据: src={src}, data={data}"
