# Stock Gene · 上手指南

> 5 分钟把"股性检测"模块跑起来 + 一遍核心工作流走完。

## TL;DR

```
后端：cd backend && python server.py
前端：cd frontend && npm run dev
浏览器：http://localhost:5173 → 输入邀请码 → "股性检测" tab
```

加 1 只你关心的股票 → 自动跑 4 个引擎评分 → 看综合分 + 雷达图 → 启用定时刷新。

## 前置条件

| 工具 | 版本 | 用途 |
|---|---|---|
| Python | ≥ 3.10 | 后端 |
| Node | ≥ 18 | 前端 |
| Git | 任何 | 拉代码 |

可选：
- **DEEPSEEK_API_KEY** — 启用 AI 评分解读（看不到 key 也能用，AI 解读按钮 disabled）
- **TUSHARE_TOKEN** — A 股基本面数据更准（默认 yfinance 兜底）

## 安装

```bash
git clone https://github.com/mingtaohuang617/quantedge.git
cd quantedge

# Backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt    # Windows
# 或 source .venv/bin/activate && pip install -r requirements.txt  (Linux/Mac)

# Frontend
cd ../frontend
npm install
```

## 配置 .env（可选）

`backend/.env`:
```env
DEEPSEEK_API_KEY=sk-...     # AI 解读评分
TUSHARE_TOKEN=...           # A 股财务数据
```

## 启动

**两个终端各跑一个**：

```bash
# Terminal 1: 后端 (port 8001)
cd backend && python server.py

# Terminal 2: 前端 (port 5173，自动 proxy /api → 8001)
cd frontend && npm run dev
```

打开 `http://localhost:5173`，邀请码：`MtQuant2026_X9k7P`（dev 用，写在 `frontend/src/quant-platform.jsx`）。

## 核心工作流

### 1. 加入观察 + 自动评分（30 秒）

1. 顶部导航 → **股性检测**
2. 左下 `+ 添加观察` → 输入 `AAPL`（搜索框会自动补全）→ 选择 → `加入并评分`
3. 等 5-10 秒：4 个引擎并行评分（趋势 / 价值 / 短期 / 风险）
4. 左栏出现 AAPL 行，4 个徽章 `T 3/8 · V 5/6 · S 2/6 · R 6/6`

### 2. 看综合分 + 雷达图

- 左栏每条下方显示 `综合 70`（0-100 加权平均）
- 点击进入详情，右上角 4 维雷达图一眼看股性形状
- 顶栏 ⛭ 按钮（Sliders 图标）调权重，默认 `trend 30 + value 30 + signal 10 + risk 30`

### 3. 切引擎看不同维度

顶栏 4 个 tab：`趋势 · 牛股 / 价值 · 健康度 / 短期 · 信号 / 风险 · 画像`
切换后左栏会高亮对应徽章，详情面板显示对应特征（F1-F8 / V1-V6 / S1-S6 / R1-R6）。

### 4. AI 解读（需 DEEPSEEK_API_KEY）

详情面板顶部 `AI 解读` 按钮 → 一段话总结当前引擎下这只票的强项 / 弱项 / 建议。24h 缓存，第二次秒回。

### 5. 多 watchlist 分组

顶部 list tabs：`默认` `+`
- 点 `+` 新建分组（如"核心仓 / 投机仓 / 长持"），7 种颜色
- 详情面板下拉 `→ 列表名` 移动股票到其它分组

### 6. 从 10x 猎手桥接

`10x 猎手` tab 筛出候选 → 候选行右侧 `+ 股性` 按钮 → 一键加入观察 + 跑 4 引擎评分（自带 `#10x候选 #赛道名` 标签）

### 7. 启用定时刷新

顶栏 ⏰ 按钮（Clock 图标）→ 开启 toggle → 默认 UTC 06:00（北京时间 14:00 美股盘后）→ 之后每天后台自动跑全引擎。

### 8. 评分变化预警

顶栏 🔔 按钮 → 列出近 30 天评分变化（每个引擎评分 ≥ 1 分变化算 alert）
- 红色 ↓ 标记下跌 / 绿色 ↑ 标记上涨
- 启用浏览器桌面通知（panel 顶部按钮请求权限）→ 评分变化时 OS 弹通知

### 9. 持仓集成

如果有 `transactions` 记录（持仓表）：
- 持仓股自动在观察列表中显示 📊 金色徽章
- 详情面板出 `持仓信息` 卡（持股 / 均价 / 现价 / 市值 / 浮动 P&L）
- 顶部 banner 提示"X 只持仓还没加入" + 一键全部加入

### 10. 备份 / 迁移

- 头栏 ⬇ 按钮：导出 JSON（含 lists / 评分历史 / 双引擎缓存 / tags / notes）
- 头栏 ⬆ 按钮：导入 JSON（merge 合并 / replace 替换）
- 头栏 `CSV` 按钮：导出 Excel 友好 CSV（每个引擎 4 列：score / max / verdict / checked_at）

## 键盘快捷键（在股性检测 tab 内）

| 键 | 动作 |
|---|---|
| `j` / `↓` | 选下一只 |
| `k` / `↑` | 选上一只 |
| `/` | 聚焦搜索框 |
| `t` | 切到趋势引擎 |
| `v` | 切到价值引擎 |
| `r` | 刷新列表 |
| `Esc` | 清过滤 / 关弹层 |
| `?` | 显示帮助 |

## 数据落盘

| 文件 | 内容 | gitignore |
|---|---|---|
| `backend/stock_gene.json` | watchlist + 评分历史 + lists | ✓ |
| `backend/stock_gene_scheduler.json` | 调度器配置 + 最近运行 | ✓ |
| `backend/data/quantedge.db` | K 线 + 持仓事实库 | ✓ |
| `frontend localStorage` | 综合分权重 / 当前 list / 已读 alerts 时间戳 | n/a |

## 4 个引擎特征详表

### 趋势 · 牛股（F1-F8，米勒维尼 + CANSLIM）
| # | 特征 | 阈值 |
|---|---|---|
| F1 | 股价在 200 日均线之上 | close > MA200 |
| F2 | 200 日均线方向向上 | 20D 斜率 > 0.5% |
| F3 | 接近或正在创新高 | 距 52W 高 ≥ -5% |
| F4 | 相对强度 RS | 6M vs SPY/HSI/沪深300，RS≈80+ |
| F5 | 盈利加速 | 季报 QoQ ≥ 25% 且加速 |
| F6 | 行业走强 | 行业 ETF 6M 跑赢基准 3%+ |
| F7 | 机构资金痕迹 | 20D/50D 量比 ≥ 1.15 + 涨/跌量比 ≥ 1.1 |
| F8 | 充分整理 | 近 20D ATR / 前 50D ATR < 0.85 |

verdict：6+ 牛股潜质 · 5 中性偏强 · 4 中性 · ≤3 待观察

### 价值 · 健康度（V1-V6，Graham + Buffett）
| # | 特征 | 阈值 |
|---|---|---|
| V1 | 估值合理 | PE ≤ 25 且 PB ≤ 5 |
| V2 | ROE 优秀 | ≥ 15% |
| V3 | 毛利率健康 | ≥ 30% |
| V4 | 自由现金流健康 | FCF > 0 且 FCF/营收 ≥ 5% |
| V5 | 负债可控 | D/E ≤ 1.0 |
| V6 | 盈利质量稳健 | 净利率 ≥ 10% |

verdict：5-6 优质标的 · 4 质量合格 · 3 中性 · ≤2 不推荐

### 短期 · 信号（S1-S6，入场时机）
| # | 特征 | 阈值 |
|---|---|---|
| S1 | 突破前期阻力 | close ≥ 20D 高 × 0.99 |
| S2 | 放量突破 | 当日量比 ≥ 1.5 |
| S3 | MACD 金叉（近 10D） | DIF 上穿 DEA |
| S4 | RSI 抬头 | 近 10D 从 ≤45 抬到 ≥50 |
| S5 | 短期均线多头排列 | MA5 > MA10 > MA20 |
| S6 | 强势整理（量缩窄幅） | 放量阳后量比 ≤ 0.7、波幅 < 8% |

verdict：5-6 入场窗口 · 4 可关注 · 3 观望 · ≤2 暂避

### 风险 · 画像（R1-R6，下行风险）
| # | 特征 | 阈值（达标 = 风险低） |
|---|---|---|
| R1 | 历史最大回撤可控 | 1Y MDD ≤ 30% |
| R2 | 波动率偏低 | 年化日波动 ≤ 35% |
| R3 | Beta 温和 | \|Beta\| ≤ 1.3 |
| R4 | 流动性充足 | 20D 平均成交额 ≥ $5M（US 等价）|
| R5 | 极端事件抗跌 | 最差 5 日累计跌幅 ≤ 15% |
| R6 | 基本面无雷区 | 净利率 > 0 且毛利率 > 20% |

verdict：5-6 低风险 · 4 风险可控 · 3 中等风险 · ≤2 高风险

## 跑测试

```bash
cd backend
.venv/Scripts/python.exe -m pytest tests/test_stock_gene*.py -v
```

应看到 **80 passed**（schema 迁移 / CRUD / 历史 / 预警 / 4 引擎特征 / 调度器）。

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 顶部 "演示模式" 徽章 | 后端没启动或 5173 → 8001 proxy 失败。检查 `backend && python server.py`。 |
| 评分一直转圈 | yfinance 偶发被 Yahoo 限流。等 1 分钟重试，或换 ticker 测。 |
| AI 解读报 503 | 没设 `DEEPSEEK_API_KEY`。在 `backend/.env` 加。 |
| 评分结果 N/A 全部 | 后端日志看 yfinance 是否被 ECONNRESET。本地 db 缓存不够时第一次评分会慢。 |
| 4 引擎徽章 = `T —` | 该股票还没评分。点详情面板 "立即评分" 或顶栏 "批量评分"。 |
| 桌面通知没弹 | 浏览器拒绝了。Chrome 地址栏左侧 ⓘ → 允许通知。 |
| Schema 迁移失败 | 删 `backend/stock_gene.json` 重新开始，或手动 export 后清空 import。 |

## 文件地图

```
backend/
├── stock_gene.py             # 主模块（CRUD + lists + 历史 + alerts + export/import）
├── value_gene.py             # 6 价值特征
├── signal_gene.py            # 6 短期信号特征
├── risk_gene.py              # 6 风险特征
├── stock_gene_scheduler.py   # 后台定时刷新线程
├── llm.py                    # DeepSeek 集成（含 explain_gene_score）
├── server.py                 # FastAPI，28 个 /api/stock-gene/* 路由
└── tests/
    ├── test_stock_gene.py            # CRUD / 迁移 / 历史 / alerts (60 tests)
    ├── test_stock_gene_engines.py    # 4 引擎特征阈值 (15 tests)
    └── test_stock_gene_scheduler.py  # 调度器状态 IO + 时刻计算 (10 tests)

frontend/src/
├── pages/StockGene.jsx              # 主页面（orchestration + 顶栏 + 三栏）
└── components/stock-gene/
    ├── helpers.js               # ENGINES 配置 + compositeScore + 格式化
    ├── dialogs.jsx              # ConfirmDialog / ShortcutsHelp / WeightsPanel / ListDialog / AlertsPanel / SchedulerPanel
    ├── filters.jsx              # VerdictFilterChips / TagFilterChips / TagsInput
    ├── viz.jsx                  # EngineRadar / ScoreSparkline (SVG)
    ├── cards.jsx                # VerdictBadge / FeatureRow / PositionCard / PeersTable / NotesBlock / TagsRow
    ├── TickerSearchBox.jsx      # 搜索自动补全
    ├── ListsTabBar.jsx          # 多 list 切换
    └── ScoreDetail.jsx          # 中栏详情面板
```

## 下一步建议

刚上手后可以试：
1. 加 5-10 只你长期跟踪的票 → 看综合分排行
2. 试不同权重组合（如全 risk 100 → 排出"风险最低"列表）
3. 创建 "核心仓" / "投机仓" 两个 list，把股票分类
4. 启用定时刷新 + 桌面通知 → 让评分异常主动找你

更多功能 backlog 见 PR #81 描述里的"未实现方向"。
