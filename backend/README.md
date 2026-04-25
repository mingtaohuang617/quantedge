# QuantEdge 数据管道

自动拉取行情数据、计算量化因子、输出前端 JSON 的 Python 脚本。

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 运行管道
python pipeline.py

# 3. 查看输出
ls output/
```

## 输出文件

| 文件 | 说明 |
|------|------|
| `output/stocks_data.json` | 完整数据（JSON 格式，可供后端 API 使用） |
| `output/alerts.json` | 自动生成的预警信号 |
| `output/frontend_data.js` | **可直接替换前端代码中的 STOCKS 和 ALERTS 常量** |
| `output/pipeline_log.txt` | 运行日志 |

## 如何更新前端

运行 `pipeline.py` 后，打开 `output/frontend_data.js`，将其中的 `STOCKS` 和 `ALERTS` 常量复制到前端 `quant-platform.jsx` 中替换对应的数据定义即可。

## 定时运行

### macOS / Linux (cron)
```bash
# 每天美东时间 17:00（收盘后）运行
# 编辑 crontab: crontab -e
0 17 * * 1-5 cd /path/to/quant-pipeline && python pipeline.py >> output/cron.log 2>&1
```

### Windows (Task Scheduler)
创建计划任务，触发器设为每个工作日 17:00，操作为运行 `python pipeline.py`。

## 标的配置

编辑 `config.py` 即可添加或删除追踪标的：

```python
# 添加新个股
"AAPL": {
    "name": "Apple Inc",
    "yf_symbol": "AAPL",
    "type": "stock",
    "market": "US",
    "sector": "消费电子",
    "currency": "USD",
    "description": "...",
},

# 添加新 ETF
"SMH": {
    "name": "VanEck Semiconductor ETF",
    "yf_symbol": "SMH",
    "type": "etf",
    "etf_type": "行业ETF",
    "market": "US",
    ...
},
```

## 因子计算说明

### 个股评分 (calc_stock_score)
- **基本面 (40%)**: PE 估值 + ROE + 利润率
- **技术面 (30%)**: 动量 + RSI 健康度
- **成长性 (30%)**: 营收增长率

### ETF 评分 (calc_etf_score)
- **成本效率 (20%)**: 总费率
- **折溢价 (20%)**: 偏离 NAV 程度
- **规模 (15%)**: AUM
- **动量 (25%)**: 价格趋势
- **集中度风险 (20%)**: 前3大持仓集中度
- **杠杆惩罚**: 杠杆 ETF 额外扣 15 分

## 已知限制

1. **yfinance 数据延迟**: 免费数据有 15 分钟延迟，适合日线级分析
2. **港股 ETF 覆盖**: 07709.HK 的持仓数据可能无法通过 yfinance 获取，需手动补充
3. **财报日期**: yfinance 对 `nextEarnings` 字段支持不稳定
4. **费率数据**: 部分 ETF 的 `expenseRatio` 可能缺失，需在 config.py 中手动配置

## 文件结构

```
quant-pipeline/
├── pipeline.py          # 主脚本
├── config.py            # 标的配置
├── factors.py           # 因子计算
├── requirements.txt     # 依赖
├── README.md            # 本文件
└── output/              # 输出目录
    ├── stocks_data.json
    ├── alerts.json
    ├── frontend_data.js
    └── pipeline_log.txt
```
