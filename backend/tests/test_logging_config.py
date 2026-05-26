"""
backend/logging_config.py — RotatingFileHandler setup 单元测试

覆盖：setup() 幂等 / handler 配置正确 / propagate=True 子 logger / 文件路径与 maxBytes
"""
from __future__ import annotations

import logging
import logging.handlers
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 注意：import logging_config 即自动跑 setup() — 测试需要在 import 前清理 handlers
# 但因为 conftest 等可能已经 import 过，本测试主要验证最终状态而非首次 setup 行为
import logging_config  # noqa: E402, F401  导入即激活 setup


class TestModuleConstants:
    """模块级常量正确"""

    def test_log_dir_is_backend_logs(self):
        # LOG_DIR 应该是 backend/logs（相对 logging_config.py）
        assert logging_config.LOG_DIR.name == "logs"
        assert logging_config.LOG_DIR.parent.name == "backend"

    def test_log_dir_exists(self):
        # setup() 调用后 logs/ 应已创建
        assert logging_config.LOG_DIR.exists()
        assert logging_config.LOG_DIR.is_dir()

    def test_log_path_is_server_log(self):
        assert logging_config.LOG_PATH.name == "server.log"
        assert logging_config.LOG_PATH.parent == logging_config.LOG_DIR

    def test_max_bytes_is_10mb(self):
        assert logging_config._MAX_BYTES == 10 * 1024 * 1024

    def test_backup_count_is_5(self):
        assert logging_config._BACKUP_COUNT == 5

    def test_format_includes_all_fields(self):
        fmt = logging_config._FORMAT
        for field in ("%(asctime)s", "%(levelname)s", "%(name)s", "%(message)s"):
            assert field in fmt, f"missing {field} in format"


class TestSetupBehavior:
    """setup() 函数行为"""

    def test_root_logger_has_rotating_handler(self):
        root = logging.getLogger()
        rotating = [h for h in root.handlers
                    if isinstance(h, logging.handlers.RotatingFileHandler)]
        assert len(rotating) >= 1, "root logger 应该至少有 1 个 RotatingFileHandler"

    def test_rotating_handler_targets_server_log(self):
        root = logging.getLogger()
        rotating = [h for h in root.handlers
                    if isinstance(h, logging.handlers.RotatingFileHandler)
                    and getattr(h, "baseFilename", None) == str(logging_config.LOG_PATH)]
        assert len(rotating) >= 1, "应有指向 server.log 的 RotatingFileHandler"

    def test_rotating_handler_uses_10mb_limit(self):
        root = logging.getLogger()
        rotating = [h for h in root.handlers
                    if isinstance(h, logging.handlers.RotatingFileHandler)
                    and getattr(h, "baseFilename", None) == str(logging_config.LOG_PATH)]
        assert rotating[0].maxBytes == 10 * 1024 * 1024

    def test_rotating_handler_keeps_5_backups(self):
        root = logging.getLogger()
        rotating = [h for h in root.handlers
                    if isinstance(h, logging.handlers.RotatingFileHandler)
                    and getattr(h, "baseFilename", None) == str(logging_config.LOG_PATH)]
        assert rotating[0].backupCount == 5

    def test_idempotent_no_duplicate_handlers(self):
        """重复调 setup() 不应重复加 handler — 第 36-37 行的 not any(...) 守卫"""
        before = sum(1 for h in logging.getLogger().handlers
                     if isinstance(h, logging.handlers.RotatingFileHandler)
                     and getattr(h, "baseFilename", None) == str(logging_config.LOG_PATH))
        logging_config.setup()  # 再次调用
        logging_config.setup()  # 再次
        after = sum(1 for h in logging.getLogger().handlers
                    if isinstance(h, logging.handlers.RotatingFileHandler)
                    and getattr(h, "baseFilename", None) == str(logging_config.LOG_PATH))
        assert before == after, f"setup 应幂等，但 handler 从 {before} 变成 {after}"


class TestChildLoggerPropagate:
    """futu / uvicorn 子 logger 应 propagate=True 走 root"""

    def test_futu_propagate_true(self):
        assert logging.getLogger("futu").propagate is True

    def test_uvicorn_propagate_true(self):
        assert logging.getLogger("uvicorn").propagate is True

    def test_uvicorn_access_propagate_true(self):
        assert logging.getLogger("uvicorn.access").propagate is True

    def test_uvicorn_error_propagate_true(self):
        assert logging.getLogger("uvicorn.error").propagate is True


class TestRootLevel:
    """root level 应被设置（默认 INFO）"""

    def test_root_level_set(self):
        root = logging.getLogger()
        # setup() 默认 level=INFO（除非测试运行环境改过）
        assert root.level <= logging.INFO, \
            f"root logger level 应 ≤ INFO，实际 {root.level}"
