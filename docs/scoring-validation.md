# 评分验证入口

本轮基于已发布提交 1719f30、评分模型 3.2.0，完成数据审计、趋势探索性诊断与 TQQQ 实际路径复核。没有调整线上权重，也没有发布新版本。

结果见 [2026-09-16 审计报告](reviews/scoring-validation-2026-09-16/audit.md)。

## 执行

在仓库根目录运行。`--database` 显式指向已有库，工具只读，不调用 init_db、不迁移结构，也不联网拉取或覆盖行情。

```powershell
python backend/validate_scoring.py --database backend/data/quantedge.db --output docs/reviews/scoring-validation-2026-09-16/audit.json
```

严格模式写出审计结果并以退出码 2 结束，表示数据不满足准入条件。这是失败关闭机制，不是程序故障。当前 SQLite 适配器没有历史财务版本、统一收益口径、历史成员和权威日历，不能通过一个开关声明“严格回测通过”。

显式执行描述性诊断：

```powershell
python backend/validate_scoring.py --database backend/data/quantedge.db --output docs/reviews/scoring-validation-2026-09-16/audit.json --diagnostic
python backend/validate_product_paths.py --cache backend/data/product_sources/2026-09-16 --output docs/reviews/scoring-validation-2026-09-16/product-paths.json
python -m pytest backend/tests/test_validate_scoring.py backend/tests/test_backtest_scoring.py backend/tests/test_scoring.py backend/tests/test_scoring_contract.py backend/tests/test_product_ingestion.py
```

在隔离工作树中，显式将 database 和 cache 指向原工作目录对应路径。不会复制用户交易记录或账户数据；只读取市场日线和表名。

## 历史数据适配契约

- 价格：标的永久标识、交易所、币种、交易日与时区、原始价格、现金分红、拆并股、收益口径、数据源、抓取时间、修订版本和源文件哈希。不同来源不能无记录覆盖。
- 财务：标的、指标、数值、单位、币种、报告期、公开可用时间、原始 filing/version、来源及修订关系。仅有日期时，保守推迟一天使用。`point_in_time_record` 仅实现版本选择规则，尚未接入不存在的历史财务面板。
- 标的池：加入/退出时间、退出原因和退市收益；行业归属也需要历史有效期。
- ETF：费用与减免有效期、历史价差窗口、NAV/市场成交价区分、基准定义、倍数和重置频率、分红拆并股。
- 加密：24/7 UTC 日历、交易所及报价币、稳定币分类、代币迁移和退市规则。

只有完成上述来源验证及专门适配器，才能解除相应严格准入项。不能用当前字段、固定披露延迟或默认值冒充缺失记录。

## 结果解释

探索性诊断没有使用当期财务值，但仍存在当前标的池、整段质量筛选和缺失窗口选择偏差，不能称为严格 PIT 或证明策略可投资。交易成本仅是单边 0/10/25/50 bps 的敏感性假设；没有构建可交易组合净值，不报告年化或 Sharpe。

TQQQ 使用 2026-07-01 至 2026-09-15 的 53 个对齐净值/指数点，首先核验文件哈希、公司行动、币种和收盘时间；形成 52 个一日、10 个五日、2 个二十日不重叠持有区间。60/120 日窗口为空。费用已反映于净值，不重复扣除。NAV 收益不代表实际成交收益，不能据此验证 81.3 分的预测能力。

旧 backtest_scoring CLI 已禁用。保留的无日期窗口函数只用于合成回归测试，拒绝有日期的真实历史数据，也不再使用质量和综合分。

## 模型变更规则

本轮决策为不变更。完成数据准入后，先冻结研究假设与日期划分，再在开发集选择候选、验证集校准，最后仅一次使用最终测试集。按行业及资产类别检查增量信息、成本后表现和不确定性；不因某个窗口 IC 为正就上线新权重。

## 本轮工程验收

- 60 项相关回归通过，覆盖公开时间、修订版本、未来价格、当前财务字段隔离、下一日成交、双边成本、缺失收益整组剔除、并列分数、样本隔离、实际杠杆路径及源文件哈希。
- 后端 Ruff 检查通过。严格模式实际执行返回 2；描述性模式写出审计 JSON 和报告。
- 没有改动前端页面、生产评分权重、数据库结构或生产部署。
# 2026-09-17 统一验收补充

六批工程改造、真实加密样本、股票与产品数据诊断及页面验收见[统一报告](reviews/scoring-completion-2026-09-17/README.md)。该报告明确区分已实施代码与未通过的数据/模型验收。当前 `model_change_allowed=false`、`production_release_ready=false`，不能将本地测试通过解释为评分已经具备预测能力。
