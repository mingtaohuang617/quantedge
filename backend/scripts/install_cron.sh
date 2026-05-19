#!/usr/bin/env bash
# ===============================================================
# install_cron.sh —— 在 macOS / Linux 安装 QuantEdge 定时任务
# ===============================================================
# 默认：每个交易日（周一至周五）本地时间 17:05 跑 backend/pipeline.py
# 日志：backend/output/cron.log（追加）
#
# 用法：
#   ./backend/scripts/install_cron.sh
#
# 卸载（手动）：
#   crontab -e   # 删掉含 "## QuantEdge" 标识的那行
#
# 自定义运行时间：编辑下方 CRON_SCHEDULE 变量（标准 cron 五字段）
set -euo pipefail

# ── 路径解析（无论从哪里调用都正确）─────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

# 优先 venv python，没有就用 PATH 里的 python3
PYTHON_BIN="$PROJECT_ROOT/backend/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
    PYTHON_BIN="$(command -v python3 || command -v python)"
fi

LOG_FILE="$PROJECT_ROOT/backend/output/cron.log"
TAG="## QuantEdge"  # 标识，便于卸载/查找
CRON_SCHEDULE="5 17 * * 1-5"  # 每周一至周五 17:05 本地时区

# 确保输出目录存在
mkdir -p "$(dirname "$LOG_FILE")"

# 组装 crontab 行：cd → 跑 pipeline → 追加日志
CRON_LINE="$CRON_SCHEDULE cd $PROJECT_ROOT && $PYTHON_BIN backend/pipeline.py >> $LOG_FILE 2>&1 $TAG"

# 取当前 crontab → 去掉已有的 QuantEdge 行 → 加新行 → 写回
( crontab -l 2>/dev/null | grep -vF "$TAG" ; echo "$CRON_LINE" ) | crontab -

echo "✓ 已安装 QuantEdge cron 任务："
echo "    $CRON_LINE"
echo ""
echo "  查看：crontab -l"
echo "  日志：tail -f $LOG_FILE"
echo "  卸载：crontab -e  # 删掉含 '$TAG' 的那行"
