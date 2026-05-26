"""
test_akshare_source — 覆盖 #7 修复后的 akshare_source.fetch_hk_fundamentals 防御逻辑
（mock akshare 调用，零网络）

锁住的行为：
- 代码列多种格式都能匹配（00005 / 0005 / 5）
- 字段名按候选列表逐一尝试
- ROE 用 net_profit / equity 正确计算（之前 _net_profit key bug 已修）
- _safe_float 识别多种占位符
- akshare API 异常不抛 + 写诊断日志 + 字段保持 None
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

from data_sources import akshare_source  # noqa: E402
from data_sources.akshare_source import (  # noqa: E402
    _code_candidates,
    _first_field,
    _safe_float,
    fetch_hk_fundamentals,
)


# ── _safe_float ──────────────────────────────────────────

class TestSafeFloat:
    @pytest.mark.parametrize("val,expected", [
        (1.5, 1.5),
        (10, 10.0),
        ("12.3", 12.3),
        (None, None),
        ("", None),
        ("-", None),
        ("--", None),
        ("—", None),  # 全角破折号（eastmoney 占位符之一）
        ("N/A", None),
        ("nan", None),
        ("NaN", None),
        ("not a number", None),
    ])
    def test_various_inputs(self, val, expected):
        assert _safe_float(val) == expected

    def test_nan_float(self):
        assert _safe_float(float("nan")) is None

    def test_inf_returns_none(self):
        assert _safe_float(float("inf")) is None
        assert _safe_float(float("-inf")) is None


# ── _code_candidates ─────────────────────────────────────

class TestCodeCandidates:
    def test_dotted_format(self):
        out = _code_candidates("0005.HK")
        assert "00005" in out      # zfill 5 位
        assert "0005" in out       # 原样
        assert "5" in out          # 去前导零
        assert "0005.HK" in out    # 带后缀

    def test_already_zfilled(self):
        out = _code_candidates("00700.HK")
        assert "00700" in out
        assert "700" in out

    def test_no_suffix(self):
        out = _code_candidates("700")
        assert "00700" in out
        assert "700" in out
        # 无 . 时不应加 .xxx 后缀
        assert all("." not in c for c in out)

    def test_priority_order(self):
        """zfilled 5 位是优先候选（最常见的 eastmoney 格式）。"""
        out = _code_candidates("0005.HK")
        assert out[0] == "00005"

    def test_all_zeros_safe(self):
        """边界：纯 0 不会 lstrip 成空字符串。"""
        out = _code_candidates("00000")
        # lstrip("0") = "" → fallback "0"
        assert "0" in out


# ── _first_field ─────────────────────────────────────────

class TestFirstField:
    def test_matches_first_candidate(self):
        row = {"市盈率-动态": 12.5, "市盈率": 10.0}
        assert _first_field(row, ["市盈率-动态", "市盈率"]) == 12.5

    def test_fallback_to_second(self):
        row = {"市盈率": 10.0}  # 第一个候选缺失
        assert _first_field(row, ["市盈率-动态", "市盈率"]) == 10.0

    def test_all_missing_returns_none(self):
        assert _first_field({"foo": 1}, ["bar", "baz"]) is None

    def test_skips_nan(self):
        row = {"市盈率-动态": float("nan"), "市盈率": 8.0}
        assert _first_field(row, ["市盈率-动态", "市盈率"]) == 8.0

    def test_works_with_pandas_series(self):
        s = pd.Series({"市盈率-动态": 15.0, "总市值": 1.5e12})
        assert _first_field(s, ["市盈率-动态"]) == 15.0


# ── fetch_hk_fundamentals 集成 ───────────────────────────

def _spot_df(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


class TestFetchHkFundamentals:
    def test_matches_zfilled_code(self):
        """0005.HK → 在表里以 '00005' 形式存在 → 匹配 + 提取 PE/市值。"""
        spot = _spot_df([
            {"代码": "00005", "名称": "汇丰", "市盈率-动态": 8.5, "总市值": 1.6e12},
            {"代码": "00700", "名称": "腾讯", "市盈率-动态": 22.0, "总市值": 4e12},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["pe"] == 8.5
        assert r["market_cap"] == 1.6e12

    def test_matches_stripped_code(self):
        """如果 akshare 用 '5' 不是 '00005'，我们也能匹配。"""
        spot = _spot_df([
            {"代码": "5", "名称": "汇丰", "市盈率-动态": 8.5, "总市值": 1.6e12},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["pe"] == 8.5

    def test_pe_field_name_drift(self):
        """字段名从 '市盈率-动态' 漂移到 '市盈率' → 仍能找到。"""
        spot = _spot_df([
            {"代码": "00005", "名称": "汇丰", "市盈率": 9.0, "总市值": 1.6e12},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["pe"] == 9.0

    def test_no_match_returns_none(self):
        """代码不在表里 → 所有字段 None，但不抛错。"""
        spot = _spot_df([
            {"代码": "00700", "名称": "腾讯", "市盈率-动态": 22.0, "总市值": 4e12},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert all(r[k] is None for k in r)

    def test_spot_em_exception_does_not_crash(self):
        """stock_hk_spot_em 抛错 → 字段保 None，函数返回。"""
        with patch.object(akshare_source.ak, "stock_hk_spot_em",
                          side_effect=RuntimeError("network blip")), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["pe"] is None
        assert r["market_cap"] is None

    def test_profit_margin_computed(self):
        """利润表有 net_profit + revenue → 算出 profit_margin。"""
        spot = pd.DataFrame()  # PE/市值不重要
        income = pd.DataFrame([{"净利润": 150.0, "营业收入": 600.0}])  # margin 25%
        balance = pd.DataFrame()
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(
                 akshare_source.ak, "stock_financial_hk_report_em",
                 side_effect=[income, balance],
             ):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["profit_margin"] == 25.0

    def test_roe_computed_from_net_profit_and_equity(self):
        """关键修复：之前 result.get('_net_profit') bug 让 ROE 永远 None。

        现在 net_profit 是局部变量在利润表/资产负债表块共享 → ROE 能算出。
        """
        spot = pd.DataFrame()
        income = pd.DataFrame([{"净利润": 100.0, "营业收入": 1000.0}])
        balance = pd.DataFrame([{"股东权益合计": 500.0}])  # ROE = 100/500 = 20%
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(
                 akshare_source.ak, "stock_financial_hk_report_em",
                 side_effect=[income, balance],
             ):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["profit_margin"] == 10.0  # 100/1000 = 10%
        assert r["roe"] == 20.0            # 100/500 = 20%

    def test_roe_skipped_when_net_profit_missing(self):
        """利润表无 net_profit → 即使有 equity 也不算 ROE（避免错误数）。"""
        spot = pd.DataFrame()
        income = pd.DataFrame([{"营业收入": 1000.0}])  # 缺净利润
        balance = pd.DataFrame([{"股东权益合计": 500.0}])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(
                 akshare_source.ak, "stock_financial_hk_report_em",
                 side_effect=[income, balance],
             ):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["roe"] is None

    def test_revenue_field_drift(self):
        """利润表字段名从 '营业收入' 漂移到 '营业总收入' → 仍能匹配。"""
        spot = pd.DataFrame()
        income = pd.DataFrame([{"净利润": 100.0, "营业总收入": 500.0}])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(
                 akshare_source.ak, "stock_financial_hk_report_em",
                 side_effect=[income, pd.DataFrame()],
             ):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["profit_margin"] == 20.0  # 100/500

    def test_safe_float_protects_against_placeholder(self):
        """eastmoney 用 '-' 表示无 PE → 不应该抛错或塞 NaN。"""
        spot = _spot_df([
            {"代码": "00005", "名称": "汇丰", "市盈率-动态": "-", "总市值": "—"},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            r = fetch_hk_fundamentals("0005.HK")
        assert r["pe"] is None
        assert r["market_cap"] is None

    def test_returns_complete_dict_schema(self):
        """无论成败，返回 dict 必含全部 6 个字段（即使全 None）。"""
        with patch.object(
            akshare_source.ak, "stock_hk_spot_em",
            side_effect=Exception("die"),
        ), patch.object(
            akshare_source.ak, "stock_financial_hk_report_em",
            side_effect=Exception("die"),
        ):
            r = fetch_hk_fundamentals("0005.HK")
        assert set(r.keys()) == {
            "pe", "roe", "revenue_growth", "profit_margin", "market_cap", "eps",
        }

    def test_diagnostic_log_on_no_code_match(self, capsys):
        """代码列匹配不上 → stderr 写诊断（包含试过的格式和表中样本）。"""
        spot = _spot_df([
            {"代码": "00700", "名称": "腾讯", "市盈率-动态": 22.0, "总市值": 4e12},
        ])
        with patch.object(akshare_source.ak, "stock_hk_spot_em", return_value=spot), \
             patch.object(akshare_source.ak, "stock_financial_hk_report_em",
                          return_value=pd.DataFrame()):
            fetch_hk_fundamentals("0005.HK")
        err = capsys.readouterr().err
        assert "代码列无匹配" in err
        assert "00700" in err  # 表中样本被打印
