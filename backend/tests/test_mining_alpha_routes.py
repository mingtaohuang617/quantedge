"""Mining Alpha FastAPI 路由测试 — 锁住 ?run_id= 参数契约。

覆盖点：
  - _ma_dir_for(None) / 合法 run_id / 不存在 run_id 三态
  - 8 个路由：不传 run_id = 老行为，传合法 = 读对应目录，传不存在 = 404
  - 文件缺失 → 404 + 期待的错误信息
  - top-holdings parquet "存在但读不了" 的 hint 路径
  - status / switch-run / alerts 的协作行为
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import server  # noqa: E402


@pytest.fixture
def ma_root(tmp_path, monkeypatch):
    """把 _MA_OUTPUT_ROOT 指向 tmp_path，构造若干 runs 目录。

    生成的目录结构::

        tmp_path/
          latest.txt        → "run_A"
          alerts.log
          runs/
            run_A/          # 完整产物
              ic_report.csv
              feature_importance.csv
              fold_ic.csv
              regime.csv
              equity_curve.csv
              benchmark_equity.csv
              backtest_report.json
              ic_monthly_heatmap.csv
              backtest_multi_topn.csv
            run_B/          # 空目录（仅存在不构造产物）
    """
    monkeypatch.setattr(server, "_MA_OUTPUT_ROOT", tmp_path)
    runs = tmp_path / "runs"
    run_a = runs / "run_A"
    run_b = runs / "run_B"
    run_a.mkdir(parents=True)
    run_b.mkdir(parents=True)
    (tmp_path / "latest.txt").write_text("run_A", encoding="utf-8")

    # ic_report.csv
    pd.DataFrame({
        "alpha": [1, 2, 3],
        "ic_mean": [0.03, -0.02, 0.04],
        "ic_ir": [0.7, -0.5, 0.9],
        "ic_t": [3.1, -2.2, 4.0],
        "ic_pos_rate": [0.62, 0.45, 0.7],
        "top_excess_mean": [0.01, -0.005, 0.012],
        "turnover": [0.15, 0.2, 0.18],
    }).to_csv(run_a / "ic_report.csv", index=False)

    # feature_importance.csv (multi-fold, index=feature)
    pd.DataFrame(
        {"fold0": [1.0, 0.8, 0.6], "fold1": [1.2, 0.7, 0.5]},
        index=["alpha_1", "alpha_2", "alpha_3"],
    ).to_csv(run_a / "feature_importance.csv")

    # fold_ic.csv
    pd.DataFrame({
        "fold": [1, 2],
        "test_start": ["2024-01-01", "2024-07-01"],
        "test_end": ["2024-06-30", "2024-12-31"],
        "test_ic_mean": [0.025, 0.031],
        "test_ic_ir": [0.6, 0.75],
        "best_iter": [180, 220],
    }).to_csv(run_a / "fold_ic.csv", index=False)

    # regime.csv
    pd.DataFrame({
        "date": ["2024-01-02", "2024-01-03"],
        "label": ["bull", "neutral"],
        "bull_prob": [0.7, 0.4],
        "neutral_prob": [0.2, 0.5],
        "bear_prob": [0.1, 0.1],
    }).to_csv(run_a / "regime.csv", index=False)

    # equity_curve / benchmark_equity
    dates = pd.date_range("2024-01-02", periods=10, freq="B").astype(str)
    pd.DataFrame({"date": dates, "equity": [1.0 + i * 0.01 for i in range(10)]}) \
        .to_csv(run_a / "equity_curve.csv", index=False)
    pd.DataFrame({"date": dates, "bench_equity": [1.0 + i * 0.005 for i in range(10)]}) \
        .to_csv(run_a / "benchmark_equity.csv", index=False)

    # backtest_report.json
    (run_a / "backtest_report.json").write_text(json.dumps({
        "annual_return": 0.18,
        "sharpe": 1.5,
        "max_drawdown": -0.12,
    }), encoding="utf-8")

    # ic_monthly_heatmap.csv (factor × month)
    pd.DataFrame(
        {"2024-01": [0.03, -0.01, 0.02], "2024-02": [0.02, 0.01, -0.03]},
        index=[1, 2, 3],
    ).to_csv(run_a / "ic_monthly_heatmap.csv")

    # backtest_multi_topn.csv
    pd.DataFrame({
        "top_n": [20, 50, 100],
        "annual_return": [0.22, 0.18, 0.15],
        "sharpe": [1.6, 1.4, 1.2],
        "max_drawdown": [-0.1, -0.12, -0.15],
        "calmar": [2.2, 1.5, 1.0],
        "alpha_annual": [0.08, 0.05, 0.03],
        "ir_vs_benchmark": [1.2, 1.0, 0.8],
        "monthly_win_rate": [0.65, 0.6, 0.55],
        "turnover_annual": [1.2, 1.0, 0.9],
    }).to_csv(run_a / "backtest_multi_topn.csv", index=False)

    # alerts.log（全局，root 下，不属于 run）
    (tmp_path / "alerts.log").write_text(
        json.dumps({"severity": "critical", "message": "test alert"}) + "\n",
        encoding="utf-8",
    )

    return tmp_path


@pytest.fixture
def client(ma_root):
    return TestClient(server.app)


# ─── _ma_dir_for() 单元 ────────────────────────────────────────


def test_dir_for_none_returns_active_dir(ma_root):
    """不传 run_id → 读 latest.txt 指向的目录。"""
    assert server._ma_dir_for(None) == ma_root / "runs" / "run_A"


def test_dir_for_valid_run_id(ma_root):
    """传合法 run_id → 直接返回 runs/{id}/。"""
    assert server._ma_dir_for("run_B") == ma_root / "runs" / "run_B"


def test_dir_for_invalid_run_id_raises_404(ma_root):
    """传不存在的 run_id → 抛 HTTPException(404)。"""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        server._ma_dir_for("does_not_exist")
    assert exc.value.status_code == 404
    assert "does_not_exist" in exc.value.detail


def test_dir_for_falls_back_when_no_latest(ma_root):
    """latest.txt 不存在 → fallback 到 _MA_OUTPUT_ROOT（老路径兼容）。"""
    (ma_root / "latest.txt").unlink()
    assert server._ma_dir_for(None) == ma_root


# ─── 通用 run_id 校验：所有 8 个路由都拒绝不存在的 run_id ──────


@pytest.mark.parametrize("path", [
    "/api/mining-alpha/ic-report",
    "/api/mining-alpha/feature-importance",
    "/api/mining-alpha/backtest",
    "/api/mining-alpha/top-holdings",
    "/api/mining-alpha/regime",
    "/api/mining-alpha/fold-ic",
    "/api/mining-alpha/ic-heatmap",
])
def test_invalid_run_id_returns_404(client, path):
    """传不存在的 run_id → 7 个 GET 路由统一 404。"""
    r = client.get(path, params={"run_id": "ghost_run"})
    assert r.status_code == 404
    assert "ghost_run" in r.json()["detail"]


# ─── ic-report ─────────────────────────────────────────────────


def test_ic_report_no_run_id_reads_active(client):
    r = client.get("/api/mining-alpha/ic-report", params={"top_n": 2})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    # |ICIR| 降序：alpha=3 (|0.9|) 居首
    assert data[0]["alpha"] == 3


def test_ic_report_explicit_run_id(client):
    r = client.get("/api/mining-alpha/ic-report", params={"run_id": "run_A"})
    assert r.status_code == 200
    assert len(r.json()) == 3


def test_ic_report_missing_file_returns_404(client, ma_root):
    """run_B 是空目录，没有 ic_report.csv → 404。"""
    r = client.get("/api/mining-alpha/ic-report", params={"run_id": "run_B"})
    assert r.status_code == 404
    assert "ic_report" in r.json()["detail"]


# ─── feature-importance ───────────────────────────────────────


def test_feature_importance_returns_sorted(client):
    r = client.get("/api/mining-alpha/feature-importance", params={"top_n": 10})
    assert r.status_code == 200
    rows = r.json()
    # 多 fold 平均后降序：alpha_1 最大
    assert rows[0]["feature"] == "alpha_1"
    assert rows[0]["importance"] > rows[1]["importance"]


def test_feature_importance_404_when_missing(client):
    r = client.get("/api/mining-alpha/feature-importance", params={"run_id": "run_B"})
    assert r.status_code == 404


# ─── backtest ──────────────────────────────────────────────────


def test_backtest_returns_metrics_and_curves(client):
    r = client.get("/api/mining-alpha/backtest")
    assert r.status_code == 200
    body = r.json()
    assert body["metrics"]["sharpe"] == 1.5
    assert len(body["equity_curve"]) > 0
    assert len(body["benchmark_curve"]) > 0
    assert len(body["multi_topn"]) == 3


def test_backtest_404_when_missing(client):
    r = client.get("/api/mining-alpha/backtest", params={"run_id": "run_B"})
    assert r.status_code == 404


# ─── top-holdings parquet hint ─────────────────────────────────


def test_top_holdings_missing_predictions(client):
    """predictions.parquet 不存在 → 404 with '不存在'。"""
    r = client.get("/api/mining-alpha/top-holdings")
    assert r.status_code == 404
    assert "不存在" in r.json()["detail"]


def test_top_holdings_corrupted_parquet_uses_hint(client, ma_root):
    """predictions.parquet 存在但读不了 → 404 with '存在但读取失败'。"""
    bogus = ma_root / "runs" / "run_A" / "predictions.parquet"
    bogus.write_bytes(b"this is not a real parquet file")
    r = client.get("/api/mining-alpha/top-holdings")
    assert r.status_code == 404
    assert "存在但读取失败" in r.json()["detail"]


# ─── regime / fold-ic / ic-heatmap ────────────────────────────


def test_regime_returns_timeseries(client):
    r = client.get("/api/mining-alpha/regime")
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["label"] == "bull"
    assert rows[0]["bull_prob"] == 0.7


def test_fold_ic_returns_rows(client):
    r = client.get("/api/mining-alpha/fold-ic")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_ic_heatmap_returns_alphas_months_cells(client):
    r = client.get("/api/mining-alpha/ic-heatmap", params={"top_n": 10, "recent_months": 12})
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"alphas", "months", "cells"}
    assert len(body["alphas"]) > 0
    assert len(body["cells"]) > 0


# ─── status / switch-run / alerts 协作 ───────────────────────


def test_status_lists_runs_and_current_id(client):
    r = client.get("/api/mining-alpha/status")
    assert r.status_code == 200
    body = r.json()
    assert body["current_run_id"] == "run_A"
    run_ids = [r["run_id"] for r in body["history_runs"]]
    assert "run_A" in run_ids
    assert "run_B" in run_ids
    # run_A 有 backtest 产物
    a = next(r for r in body["history_runs"] if r["run_id"] == "run_A")
    assert a["has_backtest"] is True
    assert a["has_predictions"] is False


def test_switch_run_updates_latest_txt(client, ma_root):
    r = client.post("/api/mining-alpha/switch-run/run_B")
    assert r.status_code == 200
    assert (ma_root / "latest.txt").read_text(encoding="utf-8").strip() == "run_B"
    # 切换后 _ma_active_dir() 应当反映新值
    assert server._ma_active_dir() == ma_root / "runs" / "run_B"


def test_switch_run_unknown_id_returns_404(client):
    r = client.post("/api/mining-alpha/switch-run/ghost_run")
    assert r.status_code == 404


def test_alerts_reads_global_log_not_run_scoped(client, ma_root):
    """alerts.log 是 root 下的全局文件，不属于某个 run。"""
    r = client.get("/api/mining-alpha/alerts")
    assert r.status_code == 200
    body = r.json()
    assert len(body["alerts"]) == 1
    assert body["alerts"][0]["severity"] == "critical"


def test_alerts_missing_log_returns_empty(client, ma_root):
    (ma_root / "alerts.log").unlink()
    r = client.get("/api/mining-alpha/alerts")
    assert r.status_code == 200
    assert r.json() == {"alerts": [], "n_total": 0}
