"""
mining_alpha.catalog — 自动生成因子目录 Markdown
================================================

从 _ALPHA_REGISTRY 扫所有已注册因子，按编号排序，输出 Markdown 表格。
分类（基于 desc 关键词推断）：

  动量/反转 / KDJ-RSI-WR / 量价相关性 / MFI-AD-资金流 /
  多周期均线 / 波动-ATR / TRIX-MACD / 极值位置 / 趋势回归 /
  DECAY-CORR 组合 / 复杂条件 / ADX-DTM-DBM / 基准依赖 / 杂

CLI:
  python -m mining_alpha.catalog --output docs/MINING_ALPHA_FACTORS.md
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _infer_category(desc: str, func_name: str) -> str:
    """简单关键词推断分类。"""
    d = (desc + " " + func_name).lower()
    if any(k in d for k in ["adx", "dtm", "dbm"]):
        return "ADX / DTM / DBM"
    if "bench" in d or "基准" in desc:
        return "基准依赖"
    if any(k in d for k in ["kdj", "rsi", "wr", "威廉"]):
        return "KDJ / RSI / WR"
    if "macd" in d or "trix" in d or "ema" in d:
        return "TRIX / MACD"
    if any(k in d for k in ["mfi", "资金流", "ad", "a/d", "obv"]):
        return "MFI / 资金流"
    if "atr" in d or "std" in d or "波动" in desc or "tr," in desc:
        return "波动 / ATR"
    if "highday" in d or "lowday" in d or "极值" in desc or "位置" in desc:
        return "极值位置"
    if "regbeta" in d or "回归" in desc:
        return "趋势回归"
    if "decay" in d or "decaylinear" in d.lower():
        return "DECAY / CORR 组合"
    if "corr" in d or "相关" in desc or "cov" in d:
        return "量价相关性"
    if "ma" in d and ("均线" in desc or "mean" in d):
        return "多周期均线"
    if "动量" in desc or "delay" in d or "reversal" in d or "反转" in desc:
        return "动量 / 反转"
    if "if" in d or "条件" in desc or "case" in d:
        return "复杂条件"
    return "杂"


def generate_catalog_md() -> str:
    """生成 Markdown 字符串。"""
    from mining_alpha.alpha191_factors import _ALPHA_REGISTRY, list_alphas

    nums = list_alphas()
    by_cat: dict[str, list[dict]] = {}
    for n in nums:
        info = _ALPHA_REGISTRY[n]
        cat = _infer_category(info.get("desc", ""), info.get("name", ""))
        by_cat.setdefault(cat, []).append({
            "alpha": n,
            "name": info.get("name", f"alpha_{n}"),
            "desc": info.get("desc", ""),
            "category": info.get("category", "price-volume"),
        })

    lines = []
    lines.append("# Mining Alpha — 因子目录")
    lines.append("")
    lines.append(f"> 自动生成。共 **{len(nums)} / 191** 个因子。")
    lines.append("> 来源：`mining_alpha.alpha191_factors._ALPHA_REGISTRY` 注册器。")
    lines.append("> 运行 `python -m mining_alpha.catalog` 重新生成。")
    lines.append("")

    # 总体分布
    lines.append("## 分类分布")
    lines.append("")
    lines.append("| 分类 | 数量 |")
    lines.append("|---|---|")
    for cat in sorted(by_cat, key=lambda c: -len(by_cat[c])):
        lines.append(f"| {cat} | {len(by_cat[cat])} |")
    lines.append("")

    # 按分类列出
    for cat in sorted(by_cat, key=lambda c: -len(by_cat[c])):
        items = sorted(by_cat[cat], key=lambda x: x["alpha"])
        lines.append(f"## {cat} ({len(items)})")
        lines.append("")
        lines.append("| α# | 函数 | 描述 |")
        lines.append("|---:|---|---|")
        for item in items:
            desc = item["desc"].replace("|", "\\|")
            lines.append(f"| {item['alpha']} | `{item['name']}` | {desc} |")
        lines.append("")

    return "\n".join(lines)


def main():
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    p = argparse.ArgumentParser(prog="mining_alpha.catalog")
    p.add_argument("--output", default="docs/MINING_ALPHA_FACTORS.md",
                   help="输出路径（相对仓库根）")
    args = p.parse_args()

    md = generate_catalog_md()
    repo_root = Path(__file__).resolve().parents[2]
    output = repo_root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(md, encoding="utf-8")
    print(f"[catalog] 已生成 {output} ({len(md.splitlines())} 行)")


if __name__ == "__main__":
    main()
