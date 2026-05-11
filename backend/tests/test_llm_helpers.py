"""
LLM 模块内的纯函数 helpers 测试。
不依赖 DEEPSEEK_API_KEY，不会发任何网络请求。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from llm import _clamp_int  # noqa: E402


# ── _clamp_int（10x thesis 结构化数字字段容错） ──────────
def test_clamp_int_valid():
    assert _clamp_int(1, 1, 5, 3) == 1
    assert _clamp_int(5, 1, 5, 3) == 5


def test_clamp_int_below_range_returns_default():
    assert _clamp_int(0, 1, 5, 3) == 3


def test_clamp_int_above_range_returns_default():
    assert _clamp_int(10, 1, 5, 3) == 3


def test_clamp_int_string_digit_coerced():
    assert _clamp_int("4", 1, 5, 3) == 4


def test_clamp_int_string_garbage_returns_default():
    assert _clamp_int("not a number", 1, 5, 3) == 3


def test_clamp_int_none_returns_default():
    assert _clamp_int(None, 1, 5, 3) == 3


def test_clamp_int_float_truncated():
    # int(2.7) = 2，仍在范围内
    assert _clamp_int(2.7, 1, 5, 3) == 2


# ── value_thesis prompt 构造 + 缓存命中（不发 LLM 网络请求） ─────
def test_value_thesis_uses_cache(monkeypatch):
    """缓存命中时直接返回，不触发 _chat。"""
    import llm as _llm
    cached_response = {
        "价值赛道": "高股息蓝筹",
        "估值点位": "PE 9 显著低于历史均值 14",
        "估值点位_int": 1,
        "内在价值": "DDM 估算公允价 $42",
        "护城河": "网络规模 + 牌照壁垒",
        "卡位等级_int": 4,
        "风险": "5G 增长见顶",
        "推演结论": "$35 以下关注",
    }
    # mock cache hit
    monkeypatch.setattr(_llm._db, "llm_cache_get", lambda k: {"response": cached_response})
    # 任何 _chat 调用都视为失败（确保走 cache 路径）
    def _no_call(*a, **kw):
        raise AssertionError("不应调用 LLM；缓存应命中")
    monkeypatch.setattr(_llm, "_chat", _no_call)

    out = _llm.value_thesis(
        {"ticker": "VZ", "name": "Verizon", "sector": "Telecom Services",
         "marketCap": 167e9, "pe": 9.2, "pb": 1.8, "dividend_yield": 0.066,
         "roe": 0.234, "debt_to_equity": 1.62},
        {"id": "value_div", "name": "高股息蓝筹", "note": "公用事业 / 银行龙头"},
    )
    assert out["ok"] is True
    assert out["cached"] is True
    assert out["thesis"] == cached_response


def test_value_thesis_clamps_int_fields(monkeypatch):
    """LLM 返回非法 _int 字段时应被 _clamp_int 兜底，不抛错。"""
    import json as _json

    import llm as _llm

    # mock cache miss
    monkeypatch.setattr(_llm._db, "llm_cache_get", lambda k: None)
    monkeypatch.setattr(_llm._db, "llm_cache_put",
                        lambda *a, **kw: None)
    # mock _chat 返回缺 _int 字段的 JSON（结构化字段缺失）
    fake_content = _json.dumps({
        "价值赛道": "高股息",
        "估值点位": "PE 低估",
        # 缺 估值点位_int / 卡位等级_int
        "内在价值": "...",
        "护城河": "...",
        "风险": "...",
        "推演结论": "...",
    }, ensure_ascii=False)
    monkeypatch.setattr(_llm, "_chat",
                        lambda *a, **kw: (fake_content, 100, 50))

    out = _llm.value_thesis(
        {"ticker": "VZ", "name": "Verizon"},
        {"id": "value_div", "name": "高股息蓝筹", "note": ""},
    )
    assert out["ok"] is True
    # 结构化数字字段缺失时取默认中位值
    assert out["thesis"]["估值点位_int"] == 2
    assert out["thesis"]["卡位等级_int"] == 3
