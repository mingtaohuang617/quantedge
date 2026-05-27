"""
测试 Futu OpenD 断路器
======================
验证：
  - 默认 closed（_futu_available() = True）
  - 失败后 open，指数退避（60s → 120s → ...）
  - 成功后 reset
  - FUTU_DISABLE=1 强制 open
"""
import time

import pytest


@pytest.fixture(autouse=True)
def reset_circuit():
    """每个测试前后重置断路器状态，避免污染。"""
    import server
    server._futu_circuit["open_until"] = 0.0
    server._futu_circuit["fail_count"] = 0
    yield
    server._futu_circuit["open_until"] = 0.0
    server._futu_circuit["fail_count"] = 0


def test_default_state_closed():
    """初始状态：断路器关闭（可用）。"""
    import server
    assert server._futu_available() is True


def test_single_failure_opens_for_60s():
    """单次失败 → 熔断 60s。"""
    import server
    server._futu_mark_failure("test")
    assert server._futu_available() is False
    # cooldown 应为 60s 内
    remaining = server._futu_circuit["open_until"] - time.time()
    assert 55 <= remaining <= 60


def test_exponential_backoff():
    """连续失败 → cooldown 翻倍：60 → 120 → 240 → ... ≤ 3600。"""
    import server
    expected = [60, 120, 240, 480, 960, 1920, 3600, 3600]  # 第 7 次起被 cap 在 3600
    for i, want in enumerate(expected, start=1):
        server._futu_mark_failure(f"fail #{i}")
        remaining = server._futu_circuit["open_until"] - time.time()
        assert want - 5 <= remaining <= want, f"第 {i} 次失败，期望 cooldown≈{want}s，实际 {remaining:.1f}s"


def test_success_resets_circuit():
    """成功调用 → fail_count 归零 + open_until 清零。"""
    import server
    server._futu_mark_failure("test")
    server._futu_mark_failure("test")
    assert server._futu_circuit["fail_count"] == 2
    server._futu_mark_success()
    assert server._futu_circuit["fail_count"] == 0
    assert server._futu_circuit["open_until"] == 0.0
    assert server._futu_available() is True


def test_env_disable_blocks_even_when_closed(monkeypatch):
    """FUTU_DISABLE=1 → 即使断路器是 closed 也返回 unavailable。"""
    import server
    # 直接 patch 模块级常量（os.getenv 只在 import 时读一次）
    monkeypatch.setattr(server, "_FUTU_DISABLED", True)
    assert server._futu_circuit["open_until"] == 0.0  # 断路器是 closed
    assert server._futu_available() is False  # 但环境变量优先


def test_open_window_expires(monkeypatch):
    """熔断窗口过期后 → 自动 closed。"""
    import server
    server._futu_mark_failure("test")
    assert server._futu_available() is False
    # 把过期时间挪到过去
    server._futu_circuit["open_until"] = time.time() - 1
    assert server._futu_available() is True
