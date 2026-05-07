"""
DeepSeek LLM 客户端 + 端点级别封装
====================================
对外提供 5 个高层场景函数，每个：
  - 根据输入构造 prompt
  - 走 db.llm_cache_* 缓存
  - 命中直接返回；未命中调 DeepSeek，写库
  - 失败时返回 {ok: False, error: ...}（永远不抛）

约定：
  - DeepSeek 兼容 OpenAI SDK，base_url = https://api.deepseek.com/v1
  - 模型默认 deepseek-chat（便宜）；复杂场景用 deepseek-reasoner
  - 超时 30s + 退避重试 1 次

环境变量：
  DEEPSEEK_API_KEY   必填，从 backend/.env 加载
  DEEPSEEK_MODEL     可选，默认 deepseek-chat
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

import db as _db

try:
    from openai import OpenAI  # OpenAI SDK 兼容 DeepSeek
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


# ── 配置 ──────────────────────────────────────────────────
DEFAULT_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
BASE_URL = "https://api.deepseek.com/v1"
TIMEOUT_SEC = 30
MAX_RETRIES = 1


_client = None


def _get_client():
    """惰性创建 client，缺 key 或 SDK 时抛 LLMError。"""
    global _client
    if _client is not None:
        return _client
    if not HAS_OPENAI:
        raise LLMError("openai 包未安装：pip install openai")
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise LLMError("DEEPSEEK_API_KEY 未设置（在 backend/.env 添加）")
    _client = OpenAI(api_key=api_key, base_url=BASE_URL, timeout=TIMEOUT_SEC)
    return _client


class LLMError(RuntimeError):
    pass


# ── 低阶调用 ────────────────────────────────────────────────
def _chat(
    messages: list[dict],
    *,
    model: str = DEFAULT_MODEL,
    json_mode: bool = False,
    max_tokens: int = 600,
    temperature: float = 0.3,
) -> tuple[str, int, int]:
    """
    返回 (content, prompt_tokens, completion_tokens)。
    json_mode=True 时使用 DeepSeek 的 response_format=json_object。
    """
    cli = _get_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = cli.chat.completions.create(**kwargs)
            content = resp.choices[0].message.content or ""
            usage = resp.usage
            return (
                content,
                usage.prompt_tokens if usage else 0,
                usage.completion_tokens if usage else 0,
            )
        except Exception as e:
            last_err = e
            if attempt < MAX_RETRIES:
                time.sleep(1.5 * (attempt + 1))  # 简单退避
                continue
            raise LLMError(f"DeepSeek 调用失败（{MAX_RETRIES + 1} 次重试后）: {e}")

    raise LLMError(f"unreachable: {last_err}")


def _safe_json_parse(text: str) -> dict:
    """容错 JSON 解析（处理 markdown 包裹）。"""
    text = text.strip()
    if text.startswith("```"):
        # 去掉 ```json ... ``` 或 ``` ... ```
        lines = text.split("\n")
        text = "\n".join(line for line in lines if not line.strip().startswith("```"))
    return json.loads(text)


# ── 高阶端点 ────────────────────────────────────────────────
def summary(stock: dict, ttl_seconds: int = 3600) -> dict:
    """
    B1: 个股 AI 摘要卡。
    输入 stock dict 应含: ticker, name(可选), sector, pe, roe, momentum, rsi,
                         revenueGrowth(可选), profitMargin(可选),
                         descriptionCN(可选), week52High/Low(可选)
    返回 {ok: bool, ticker, summary: {看点, 风险, 估值}, cached: bool}
    """
    ticker = stock.get("ticker", "?")

    # 构造 prompt
    bullets = [
        f"代码: {ticker}",
        f"名称: {stock.get('name', '')}",
        f"行业: {stock.get('sector', '')}",
    ]
    if stock.get("pe") is not None:
        bullets.append(f"PE: {stock['pe']}")
    if stock.get("roe") is not None:
        bullets.append(f"ROE: {stock['roe']}%")
    if stock.get("revenueGrowth") is not None:
        bullets.append(f"营收增长: {stock['revenueGrowth']}%")
    if stock.get("profitMargin") is not None:
        bullets.append(f"利润率: {stock['profitMargin']}%")
    if stock.get("rsi") is not None:
        bullets.append(f"RSI(14): {stock['rsi']}")
    if stock.get("momentum") is not None:
        bullets.append(f"动量: {stock['momentum']}")
    if stock.get("week52High") and stock.get("week52Low"):
        bullets.append(f"52周区间: {stock['week52Low']} ~ {stock['week52High']}")
    if stock.get("descriptionCN"):
        bullets.append(f"业务: {stock['descriptionCN'][:200]}")

    prompt = (
        "你是量化投资分析助手。基于以下数据，用客观、简洁的中文给出 3 个判断："
        "看点 / 风险 / 估值水平（贵/合理/低估）。\n"
        "要求：\n"
        "- 不给买卖建议\n"
        "- 每项 ≤30 字\n"
        "- 严格输出 JSON: {\"看点\": str, \"风险\": str, \"估值\": str}\n\n"
        + "\n".join(bullets)
    )

    cache_key = _db.llm_cache_key("summary", DEFAULT_MODEL, prompt)

    # 缓存命中
    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {
            "ok": True,
            "ticker": ticker,
            "summary": cached["response"],
            "cached": True,
        }

    # 未命中 → 调 LLM
    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=True,
            max_tokens=300,
            temperature=0.2,
        )
        parsed = _safe_json_parse(content)
        # 校验关键字段
        for k in ("看点", "风险", "估值"):
            if k not in parsed:
                parsed[k] = ""
        _db.llm_cache_put(
            cache_key, "summary", DEFAULT_MODEL, parsed,
            ticker=ticker, prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {
            "ok": True,
            "ticker": ticker,
            "summary": parsed,
            "cached": False,
        }
    except LLMError as e:
        return {"ok": False, "ticker": ticker, "error": str(e)}
    except json.JSONDecodeError as e:
        return {"ok": False, "ticker": ticker, "error": f"LLM 返回非合法 JSON: {e}"}


def journal_structure(text: str, watchlist: list[str], ttl_seconds: int = 0) -> dict:
    """
    B5: 一句话投资日志 → 结构化字段。
    text: 用户原文（"今天加仓 NVDA 100 股@201，看好财报"）
    watchlist: 当前自选股列表（约束 ticker 必须在内）
    返回 {ok: bool, structured: {action, ticker, qty, price, sentiment, reason, tags}}
    """
    prompt = (
        "你是投资日志助手。把以下一句话投资记录解析成 JSON。\n"
        "字段（缺失留 null）：\n"
        '  - action: "buy" | "sell" | "watch" | "note"\n'
        '  - ticker: 必须从给定列表选，否则 null\n'
        "  - qty: 数量（整数或 null）\n"
        "  - price: 单价（数字或 null）\n"
        '  - sentiment: "bullish" | "bearish" | "neutral"\n'
        "  - reason: 投资逻辑（≤30 字）\n"
        "  - tags: string[] (≤3 个标签，如 [\"财报\", \"加仓\"])\n\n"
        f"自选股列表: {json.dumps(watchlist, ensure_ascii=False)}\n\n"
        f"用户原文: {text}\n\n"
        "严格输出 JSON。"
    )

    cache_key = _db.llm_cache_key("journal-structure", DEFAULT_MODEL, prompt)
    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {"ok": True, "structured": cached["response"], "cached": True}

    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=True,
            max_tokens=400,
            temperature=0.1,
        )
        parsed = _safe_json_parse(content)
        _db.llm_cache_put(
            cache_key, "journal-structure", DEFAULT_MODEL, parsed,
            ticker=parsed.get("ticker"),
            prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {"ok": True, "structured": parsed, "cached": False}
    except LLMError as e:
        return {"ok": False, "error": str(e)}
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"LLM 返回非合法 JSON: {e}"}


def explain_score(stock: dict, weights: dict, ttl_seconds: int = 86400) -> dict:
    """
    B2: 评分解读 — 解释为什么这只票得这个分。
    输入:
      stock: {ticker, score, subScores: {fundamental, technical, growth}, isETF (optional)}
      weights: {fundamental, technical, growth}（前端归一化前的整数权重，函数内部归一化）
    返回 {ok, ticker, explanation: str, cached}
    """
    ticker = stock.get("ticker", "?")
    score = stock.get("score")
    subs = stock.get("subScores") or {}

    # 归一化 weights
    total = sum(v for v in weights.values() if isinstance(v, (int, float)))
    if total <= 0:
        wf = wt = wg = 1 / 3
    else:
        wf = weights.get("fundamental", 0) / total
        wt = weights.get("technical", 0) / total
        wg = weights.get("growth", 0) / total

    if stock.get("isETF"):
        prompt = (
            f"ETF {ticker} 综合得分 {score}/100。"
            f"子项: 成本={subs.get('cost')}, 流动性={subs.get('liquidity')}, "
            f"动量={subs.get('momentum')}, 风险={subs.get('risk')}（各项都是 0-100，越高越好）。"
            "用 1-2 句中文解释为什么得这个分（哪个子项拉高/拉低了综合分），≤50 字。"
        )
    else:
        prompt = (
            f"个股 {ticker} 综合得分 {score}/100。\n"
            f"子项打分: 基本面={subs.get('fundamental')}/100, 技术面={subs.get('technical')}/100, "
            f"成长={subs.get('growth')}/100。\n"
            f"用户权重: 基本面 {wf*100:.0f}% / 技术 {wt*100:.0f}% / 成长 {wg*100:.0f}%。\n"
            "用 1-2 句中文解释为什么得这个分（指出哪个子项拉高/拉低了综合分、是否在权重侧重项上表现强），"
            "≤50 字，纯文本不要 JSON。"
        )

    cache_key = _db.llm_cache_key("explain-score", DEFAULT_MODEL, prompt)
    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {"ok": True, "ticker": ticker, "explanation": cached["response"].get("text", ""), "cached": True}

    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=False,
            max_tokens=120,
            temperature=0.3,
        )
        text = (content or "").strip()
        _db.llm_cache_put(
            cache_key, "explain-score", DEFAULT_MODEL, {"text": text},
            ticker=ticker, prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {"ok": True, "ticker": ticker, "explanation": text, "cached": False}
    except LLMError as e:
        return {"ok": False, "ticker": ticker, "error": str(e)}


def backtest_narrate(payload: dict, ttl_seconds: int = 1800) -> dict:
    """
    B4: 回测结果 AI 解读。
    payload 应含: tickers (list), weights (dict ticker→weight),
                 annualReturn, sharpe, maxDD, vol(可选),
                 worstMonth (str like '2024-10', 可选),
                 worstMonthReturn (float, 可选),
                 benchAnnualReturn (float, 可选)
    返回 {ok, narration: str (4-5 句), cached}
    """
    tickers = payload.get("tickers", [])
    weights = payload.get("weights", {})
    portfolio_str = ", ".join(f"{t}({w*100:.0f}%)" for t, w in weights.items()) if weights else ", ".join(tickers)

    lines = [f"组合: {portfolio_str}"]
    if payload.get("annualReturn") is not None:
        lines.append(f"年化收益: {payload['annualReturn']:.2f}%")
    if payload.get("benchAnnualReturn") is not None:
        lines.append(f"基准年化: {payload['benchAnnualReturn']:.2f}%")
    if payload.get("sharpe") is not None:
        lines.append(f"夏普: {payload['sharpe']:.2f}")
    if payload.get("maxDD") is not None:
        lines.append(f"最大回撤: {payload['maxDD']:.2f}%")
    if payload.get("vol") is not None:
        lines.append(f"年化波动: {payload['vol']:.2f}%")
    if payload.get("worstMonth"):
        wm = payload["worstMonth"]
        wmr = payload.get("worstMonthReturn")
        lines.append(f"最差单月: {wm}" + (f" ({wmr:.2f}%)" if wmr is not None else ""))

    prompt = (
        "回测结果总结。基于以下指标，用 4-5 句中文给出："
        "1) 整体表现评价（与基准对比）；"
        "2) 主要风险时点；"
        "3) 一句改进建议（可针对持仓集中度或时机）。"
        "客观、不给买卖建议，纯文本。\n\n" + "\n".join(lines)
    )

    cache_key = _db.llm_cache_key("backtest-narrate", DEFAULT_MODEL, prompt)
    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {"ok": True, "narration": cached["response"].get("text", ""), "cached": True}

    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=False,
            max_tokens=400,
            temperature=0.4,
        )
        text = (content or "").strip()
        _db.llm_cache_put(
            cache_key, "backtest-narrate", DEFAULT_MODEL, {"text": text},
            ticker=None, prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {"ok": True, "narration": text, "cached": False}
    except LLMError as e:
        return {"ok": False, "error": str(e)}


def tenx_thesis(stock: dict, supertrend: dict, ttl_seconds: int = 86400) -> dict:
    """
    10x 猎手 — 卡位分析草稿生成。
    按"成长型十倍股"策略框架给出 5 段结构化输出，作为用户编辑 thesis 的起草。

    输入:
      stock: {ticker, name, sector?, industry?, marketCap?, descriptionCN?}
      supertrend: {id, name, note}（来自 list_supertrends()）
    返回 {ok, ticker, thesis: {超级趋势, 瓶颈层, 卡位逻辑, 风险, 推演结论}, cached}
    """
    ticker = stock.get("ticker", "?")
    name = stock.get("name", "")
    sector = stock.get("sector") or stock.get("industry") or ""
    mc = stock.get("marketCap")
    desc = (stock.get("descriptionCN") or stock.get("description") or "")[:300]

    if mc is None:
        mc_str = "未知"
    elif mc >= 1e9:
        mc_str = f"{mc/1e9:.1f}B"
    else:
        mc_str = f"{mc/1e6:.0f}M"

    st_id = supertrend.get("id", "")
    st_name = supertrend.get("name", st_id)
    st_note = supertrend.get("note", "")

    prompt = (
        "你是产业研究助手，按 '成长型十倍股' 策略给出客观分析。\n"
        "策略框架：超级趋势 → 双层瓶颈（共识层 / 深度认知层）→ "
        "关键卡位公司（小市值 + 不可替代 + 未被完全理解）→ 第一性原理推演（订单概率 / 产能 / 管理层 / 瓶颈依赖度）。\n\n"
        f"标的: {ticker} ({name})\n"
        f"行业/分类: {sector}\n"
        f"市值: {mc_str}\n"
        f"所属超级趋势: {st_name}（{st_note}）\n"
        f"业务描述: {desc or '（缺失）'}\n\n"
        "请严格输出 JSON，5 个字段都要有：\n"
        '{\n'
        '  "超级趋势": "<这只票为什么属于这条超级趋势，≤30 字>",\n'
        '  "瓶颈层": "<判断它卡在共识层(1)还是深度认知层(2)，简述理由，≤40 字>",\n'
        '  "卡位逻辑": "<它在产业链什么位置、为什么不可替代，≤60 字>",\n'
        '  "风险": "<最大风险点，≤30 字>",\n'
        '  "推演结论": "<基于第一性原理的概率性判断，不给买卖建议，≤60 字>"\n'
        '}\n'
        "要求：客观、不夸张；不知道就承认不确定。"
    )

    cache_key = _db.llm_cache_key("10x-thesis", DEFAULT_MODEL, prompt)

    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {"ok": True, "ticker": ticker, "thesis": cached["response"], "cached": True}

    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=True,
            max_tokens=600,
            temperature=0.3,
        )
        parsed = _safe_json_parse(content)
        for k in ("超级趋势", "瓶颈层", "卡位逻辑", "风险", "推演结论"):
            if k not in parsed:
                parsed[k] = ""
        _db.llm_cache_put(
            cache_key, "10x-thesis", DEFAULT_MODEL, parsed,
            ticker=ticker, prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {"ok": True, "ticker": ticker, "thesis": parsed, "cached": False}
    except LLMError as e:
        return {"ok": False, "ticker": ticker, "error": str(e)}
    except json.JSONDecodeError as e:
        return {"ok": False, "ticker": ticker, "error": f"LLM 返回非合法 JSON: {e}"}


def macro_narrative(composite: dict, ttl_seconds: int = 43200) -> dict:
    """
    每日宏观市场画像。基于 compute_composite() 的输出生成 150-200 字中文解读。

    输入: composite 含 market_temperature / by_category / alerts / hmm / survival
    返回: {ok, narrative: str, cached}
    缓存：默认 12 小时；同 prompt 直接命中。
    """
    temp = composite.get("market_temperature")
    cats = composite.get("by_category") or {}
    alerts = composite.get("alerts") or []
    hmm = (composite.get("hmm") or {}).get("current") or {}
    survival = composite.get("survival") or {}

    cat_cn = {"valuation": "估值", "liquidity": "流动性",
              "sentiment": "情绪", "breadth": "宽度"}
    sub_lines = []
    for cat, info in cats.items():
        s = info.get("score")
        if s is not None:
            sub_lines.append(f"  - {cat_cn.get(cat, cat)}: {s:.1f}/100")

    # 极端因子（≥90 或 ≤10 分位）
    extremes = []
    for cat, info in cats.items():
        for f in info.get("factors", []):
            pct = f.get("percentile")
            raw = f.get("raw_value")
            if pct is not None and (pct >= 90 or pct <= 10):
                extremes.append(f"{f.get('name')}={raw}（分位 {pct:.0f}%）")

    alert_lines = []
    for a in alerts:
        alert_lines.append(f"  - [{a.get('level')}] {a.get('title')}: {a.get('summary')}")

    bull_p = (hmm.get("bull") or 0) * 100
    neutral_p = (hmm.get("neutral") or 0) * 100
    bear_p = (hmm.get("bear") or 0) * 100

    surv_str = ""
    if survival and not survival.get("error"):
        surv_str = (
            f"当前 {survival.get('current_regime')} 已 {survival.get('current_duration_days')} 天 "
            f"(超过 {survival.get('current_duration_pct_rank'):.0f}% 历史；中位 "
            f"{survival.get('median_past_days')}d，最长 {survival.get('max_past_days')}d)"
        )

    prompt = (
        "你是宏观策略助手。基于以下美股市场数据快照，用中文写一段 150-200 字的当日市场画像。\n\n"
        "数据：\n"
        f"- L3 综合温度: {temp}/100（0=极熊 100=极牛）\n"
        f"- 4 类子分(0=熊 100=牛 方向化):\n" + "\n".join(sub_lines) + "\n"
        f"- L4 HMM 三态: 牛 {bull_p:.0f}% / 震荡 {neutral_p:.0f}% / 熊 {bear_p:.0f}%\n"
        + (f"- 持续期: {surv_str}\n" if surv_str else "")
        + (f"- 极端因子:\n  · " + "\n  · ".join(extremes) + "\n" if extremes else "")
        + f"- 双重确认告警:\n" + ("\n".join(alert_lines) if alert_lines else "  无")
        + "\n\n要求：\n"
        "- 客观、不给具体买卖建议；不夸张\n"
        "- 重点指出主要矛盾（特别是 L3 温度 vs HMM 价格行为视角分歧）+ 一句风险或机会观察\n"
        "- 严格 150-200 字，纯文本不用 markdown，不用列表"
    )

    cache_key = _db.llm_cache_key("macro-narrative", DEFAULT_MODEL, prompt)
    cached = _db.llm_cache_get(cache_key)
    if cached:
        return {
            "ok": True,
            "narrative": cached["response"].get("text", ""),
            "cached": True,
        }

    try:
        content, p_tok, c_tok = _chat(
            [{"role": "user", "content": prompt}],
            json_mode=False,
            max_tokens=500,
            temperature=0.5,
        )
        text = (content or "").strip()
        _db.llm_cache_put(
            cache_key, "macro-narrative", DEFAULT_MODEL, {"text": text},
            ticker=None, prompt_tokens=p_tok, completion_tokens=c_tok,
            ttl_seconds=ttl_seconds,
        )
        return {"ok": True, "narrative": text, "cached": False}
    except LLMError as e:
        return {"ok": False, "error": str(e)}


def health_check() -> tuple[bool, str]:
    """轻量探活，不消耗有意义的 token。"""
    if not HAS_OPENAI:
        return False, "openai 包未安装"
    if not os.environ.get("DEEPSEEK_API_KEY", "").strip():
        return False, "DEEPSEEK_API_KEY 未设置"
    try:
        cli = _get_client()
        # 一个 1-token 的 ping
        resp = cli.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
        )
        return True, f"DeepSeek 正常 (model={DEFAULT_MODEL})"
    except Exception as e:
        return False, f"DeepSeek 失败: {e}"
