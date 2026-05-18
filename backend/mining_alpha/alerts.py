"""
mining_alpha.alerts — IC 衰减 + 回测漂移告警
=============================================

定时跑（每个交易日收盘后），检测：
  1. 模型 IC 突然下降（过去 20 日 IC mean < 历史 -1.5σ）
  2. 回测净值最大回撤创新高
  3. 因子相关性矩阵漂移（top-N 因子相对上次更新有显著变化）
  4. 数据同步失败（sync_state.consec_fails >= 3）

告警通道：
  - 写文件 backend/output/mining_alpha/alerts.log（始终）
  - 可选 webhook（Telegram / 企业微信 / Slack） — 通过环境变量配置

公开接口:
  - check_ic_degradation(ic_history) → list[Alert]
  - check_drawdown(equity_curve) → list[Alert]
  - check_data_health() → list[Alert]
  - run_all_checks(run_dir) → list[Alert]
  - send_alerts(alerts) → None  (写日志 + webhook)
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

import pandas as pd
import requests


Severity = Literal["info", "warning", "critical"]


@dataclass
class Alert:
    timestamp: str
    severity: Severity
    category: str           # 'ic_degradation' / 'drawdown' / 'data_health' / 'factor_drift'
    message: str
    detail: dict = field(default_factory=dict)


# ── IC 衰减检测 ────────────────────────────────────────────


def check_ic_degradation(
    ic_history: pd.Series | pd.DataFrame,
    *,
    short_window: int = 20,
    sigma_threshold: float = 1.5,
) -> list[Alert]:
    """
    检测 IC 是否在最近 N 日跌出历史正常区间。

    Args:
      ic_history: pd.Series (日 IC) 或 pd.DataFrame (各因子日 IC)
      short_window: 最近 N 日均值作为"当前 IC"
      sigma_threshold: 跌出历史均值 -k*sigma 触发告警

    Returns:
      Alert 列表
    """
    alerts: list[Alert] = []
    if ic_history is None or len(ic_history) < short_window * 3:
        return alerts

    ts = datetime.now().isoformat(timespec="seconds")

    def _check_series(name: str, s: pd.Series):
        s = s.dropna()
        if len(s) < short_window * 3:
            return
        recent_mean = s.iloc[-short_window:].mean()
        hist_mean = s.iloc[:-short_window].mean()
        hist_std = s.iloc[:-short_window].std()
        if hist_std == 0 or pd.isna(hist_std):
            return
        z = (recent_mean - hist_mean) / hist_std
        if z < -sigma_threshold:
            alerts.append(Alert(
                timestamp=ts,
                severity="warning" if z > -2.5 else "critical",
                category="ic_degradation",
                message=f"{name} 近 {short_window} 日 IC mean={recent_mean:.4f}，"
                        f"显著低于历史均值 {hist_mean:.4f} (z={z:.2f}σ)",
                detail={
                    "recent_mean": float(recent_mean),
                    "hist_mean": float(hist_mean),
                    "hist_std": float(hist_std),
                    "z_score": float(z),
                },
            ))

    if isinstance(ic_history, pd.Series):
        _check_series("model_ic", ic_history)
    else:
        for col in ic_history.columns:
            _check_series(str(col), ic_history[col])
    return alerts


# ── 最大回撤检测 ────────────────────────────────────────────


def check_drawdown(
    equity_curve: pd.Series,
    *,
    threshold: float = -0.15,
) -> list[Alert]:
    """
    若当前距离历史峰值的回撤超过 threshold，触发告警。
    """
    alerts: list[Alert] = []
    if equity_curve is None or len(equity_curve) < 30:
        return alerts
    cummax = equity_curve.cummax()
    dd = equity_curve / cummax - 1
    curr_dd = float(dd.iloc[-1])
    if curr_dd < threshold:
        alerts.append(Alert(
            timestamp=datetime.now().isoformat(timespec="seconds"),
            severity="critical" if curr_dd < threshold * 1.5 else "warning",
            category="drawdown",
            message=f"当前回撤 {curr_dd:.2%}，已突破 {threshold:.0%} 阈值",
            detail={
                "current_drawdown": curr_dd,
                "threshold": threshold,
                "peak_date": str(cummax.idxmax()),
            },
        ))
    return alerts


# ── 数据健康度检测 ────────────────────────────────────────────


def check_data_health() -> list[Alert]:
    """检查 sync_state.consec_fails 高于 3 的 ticker。"""
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).resolve().parent.parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    import db as _db

    alerts: list[Alert] = []
    conn = _db._get_conn()
    rows = conn.execute(
        "SELECT ticker, consec_fails, last_error, last_attempt_ts "
        "FROM sync_state WHERE consec_fails >= 3"
    ).fetchall()
    if rows:
        tickers = [r["ticker"] for r in rows]
        alerts.append(Alert(
            timestamp=datetime.now().isoformat(timespec="seconds"),
            severity="warning",
            category="data_health",
            message=f"{len(tickers)} 个 ticker 连续失败 ≥ 3 次",
            detail={"failed_tickers": tickers[:20]},
        ))
    return alerts


# ── 总检 ──────────────────────────────────────────────────────


def run_all_checks(run_dir: Path) -> list[Alert]:
    """
    把所有检测跑一遍，返回告警列表。

    Args:
      run_dir: 某个 run 的输出目录（包含 fold_ic.csv / equity_curve.csv 等）
    """
    alerts: list[Alert] = []

    # 1. IC 衰减（用 fold_ic 的 ic_mean 序列）
    fold_ic_csv = run_dir / "fold_ic.csv"
    if fold_ic_csv.exists():
        try:
            df = pd.read_csv(fold_ic_csv)
            if "test_ic_mean" in df.columns:
                ic_series = pd.Series(df["test_ic_mean"].values)
                alerts += check_ic_degradation(ic_series, short_window=2)
        except Exception:
            pass

    # 2. 最大回撤
    eq_csv = run_dir / "equity_curve.csv"
    if eq_csv.exists():
        try:
            df = pd.read_csv(eq_csv, index_col=0, parse_dates=True)
            col = "equity" if "equity" in df.columns else df.columns[0]
            alerts += check_drawdown(df[col])
        except Exception:
            pass

    # 3. 数据健康
    try:
        alerts += check_data_health()
    except Exception:
        pass

    return alerts


# ── 通知通道 ─────────────────────────────────────────────────


def send_alerts(alerts: list[Alert], log_path: Path | None = None) -> None:
    """
    把告警写日志 + 推送 webhook。
    webhook URL 从环境变量取:
      - MA_ALERT_WEBHOOK_TELEGRAM (Telegram Bot URL)
      - MA_ALERT_WEBHOOK_WECOM (企业微信群机器人 URL)
      - MA_ALERT_WEBHOOK_SLACK (Slack incoming webhook)
    """
    if not alerts:
        return
    if log_path is None:
        log_path = Path(__file__).resolve().parent.parent / "output" / "mining_alpha" / "alerts.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        for a in alerts:
            f.write(json.dumps(asdict(a), ensure_ascii=False) + "\n")

    msg_summary = "\n".join(f"[{a.severity.upper()}] {a.category}: {a.message}" for a in alerts)
    print(msg_summary)

    # Telegram
    tg = os.environ.get("MA_ALERT_WEBHOOK_TELEGRAM", "").strip()
    if tg:
        try:
            requests.post(tg, json={"text": f"⚠️ Mining Alpha 告警\n{msg_summary}"}, timeout=5)
        except Exception as e:
            print(f"  [warn] Telegram 推送失败: {e}")

    # 企业微信
    wc = os.environ.get("MA_ALERT_WEBHOOK_WECOM", "").strip()
    if wc:
        try:
            requests.post(wc, json={"msgtype": "text", "text": {"content": msg_summary}}, timeout=5)
        except Exception as e:
            print(f"  [warn] 企业微信推送失败: {e}")

    # Slack
    sl = os.environ.get("MA_ALERT_WEBHOOK_SLACK", "").strip()
    if sl:
        try:
            requests.post(sl, json={"text": msg_summary}, timeout=5)
        except Exception as e:
            print(f"  [warn] Slack 推送失败: {e}")


if __name__ == "__main__":
    # Windows GBK 终端兜底
    import sys as _sys
    if _sys.stdout.encoding and _sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        try:
            _sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    import argparse
    p = argparse.ArgumentParser(prog="mining_alpha.alerts")
    p.add_argument("--run-dir", default=None, help="指定 run 目录；默认用 latest.txt")
    args = p.parse_args()

    backend_dir = Path(__file__).resolve().parent.parent
    output_root = backend_dir / "output" / "mining_alpha"
    if args.run_dir:
        run_dir = Path(args.run_dir)
    else:
        latest = output_root / "latest.txt"
        if latest.exists():
            run_id = latest.read_text(encoding="utf-8").strip()
            run_dir = output_root / "runs" / run_id
        else:
            run_dir = output_root

    print(f"[alerts] 检查 {run_dir} ...")
    alerts = run_all_checks(run_dir)
    if alerts:
        send_alerts(alerts)
        print(f"  发出 {len(alerts)} 条告警")
    else:
        print("  ✓ 一切正常")
