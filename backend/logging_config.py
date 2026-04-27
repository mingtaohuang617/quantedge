"""
日志配置 — 统一注入轮转 FileHandler
==================================
解决 server.log 无限增长的问题。
导入即生效；调用方只需 `import logging_config` 一次。

输出位置：backend/logs/server.log（10MB × 5 份轮转）
"""
import logging
import logging.handlers
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_PATH = LOG_DIR / "server.log"

_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_BACKUP_COUNT = 5


def setup(level: int = logging.INFO) -> None:
    """配置根 logger + futu / uvicorn 子 logger 都走轮转文件 + stdout。"""
    handler = logging.handlers.RotatingFileHandler(
        LOG_PATH,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(_FORMAT))

    root = logging.getLogger()
    root.setLevel(level)
    # 避免重复添加（重复 import 时）
    if not any(isinstance(h, logging.handlers.RotatingFileHandler) and
               getattr(h, "baseFilename", None) == str(LOG_PATH) for h in root.handlers):
        root.addHandler(handler)

    # futu-api / uvicorn 都继承 root logger，不必单独配置
    # 但确保它们 propagate=True
    for name in ("futu", "uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).propagate = True


# 模块导入即自动调用
setup()
