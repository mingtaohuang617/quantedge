# 历史财报公开时间与版本入口

## 本轮状态

2026-09-17 新增 [期间、拆股份额与真实修订案例](reviews/sec-transforms-2026-09-17/review.md)：同申报金额差分、显式 EPS 份额转换及 Plug Power 真实重述切换已验证。Plug Power 原始文件仍有九项多精度数值待核查，且尚缺财报不可依赖状态阻断，未解除整体准入限制。

2026-09-17 后续完成 [三份原始申报核验](reviews/sec-originals-2026-09-17/review.md)：63 条候选事实全部按原始上下文匹配。实际修订链、EPS 与股价股份尺度仍未认证；下文 2026-09-16 初始准入限制并未因此整体解除。

2026-09-16 建立 SEC companyfacts 与 submissions 按申报编号关联的研究入口。完成 NVIDIA 单公司试点，尚未连接生产评分。原始响应、请求、抓取时间和哈希独立归档；后续抓取保留新版本。

现有评分验证框架只有通用的日期筛选辅助函数，没有真实个股历史财报面板。本轮新增实际 SEC 数据采集与精确财务上下文查询，不把当前基本面回填到历史。

## 时间与财务口径

- 每条候选保留 CIK、指标名称、单位、期间起止、数值、申报编号、表单类型、filed 日期、SEC 接收时间、原始文件链接及保守可用时间。
- 可用时间为申报日期与接收时间对应纽约日期中的较晚日期，再延后到下一纽约日零点。查询必须提供带时区的时刻；实际评分仍须在其市场交易时点调用。
- 同一期间允许多个申报版本并存，查询只选择截至指定时刻已可用的最新接收版本。后来的更正不能影响早期结果。
- 必须指定完全相同的指标、单位、期间起止。半年累计值不当作第二季度值，USD 不与 USD/shares 混用，不自动把两个营收标签合并为同一序列。
- 同一申报、指标、单位、期间存在不同值时保留歧义，查询返回不可用；不挑选有利值，也不静默退回更早版本。相同值的重复上下文去重。
- 仅接受 10-K、10-Q 及其 /A 修订。其他表单、没有申报元数据、日期矛盾及无效值计入隔离统计。

## NVIDIA 实际采集

2026-09-16 采集 CIK 0001045810：3 个 SEC 原始响应，关联 69 份申报，生成 1,698 条候选记录。申报日期范围 2009-08-20—2026-08-26。5 条事实因表单类型不在本轮范围被排除；没有以默认值补齐。

| 指标 | 候选记录数 |
|---|---:|
| Assets | 138 |
| EarningsPerShareDiluted | 309 |
| NetCashProvidedByUsedInOperatingActivities | 161 |
| NetIncomeLoss | 309 |
| OperatingIncomeLoss | 225 |
| RevenueFromContractWithCustomerExcludingAssessedTax | 28 |
| Revenues | 280 |
| StockholdersEquity | 248 |

这些是带版本的事实记录数，不是独立季度数、公司数或有效回测样本数。相同历史期间可在多次申报出现。

例如样本内截至 2026-07-26 的单季净利润和年初累计净利润分别保留不同起始日期；2026-08-26 申报对应的保守可用时间为 2026-08-27 纽约零点，不能用于 08-26 收盘信号。

## 2026-09-17 进展

历史价格、股数与估值输入的后续批次见[估值准入验收](reviews/historical-valuation-2026-09-17/README.md)：四例绑定供应商报价、提取原文股数并提供带假设的估值诊断；因价格复权与股数时点仍未满足准入，总质量分继续为空。

已完成选定 NVDA、PLUG、MU、MSFT 原始财报核验、PLUG 不可依赖公告拦截及四个独立历史质量分试算。新增准入入口为 `financial_admission.select_admitted`；底层 `select_fact` 仅返回候选，不提供公告准入保证。详见[本轮验收](reviews/financial-admission-2026-09-17/README.md)。四例均因历史估值数据不足保留空总质量分，未调整生产模型。以下早期采集范围与限制是初始阶段记录；完整修订链和公告覆盖仍未认证。

## 初始采集阶段限制

strict_pit_eligible 和 model_change_allowed 均为 false。SEC 当前汇总接口保留申报编号，但今日下载不证明当时 API 返回相同内容。尚未逐份保存并核对原始 XBRL/内联 XBRL 上下文，也未验证完整修订链。不能将本轮入口称为完整的历史时点财报库。

财报之前的业绩公告与 8-K 可能更早公开有关数字，本轮未覆盖。当前保守规则可能晚于真实首次公开时间；不声称捕捉所有信息首次披露时点。自定义标签、季度差分、TTM、行业可比性和币种转换也尚未实现。

下一步先按申报编号保存并核对一组原始 10-Q/10-K 的选定事实，验证单季与累计上下文及修订；随后扩展公司试点。通过后再考虑接入历史质量分，价格、历史成员和交易成本等回测条件仍须分别满足。

## 运行与证据

在隔离工作树根目录执行。网络请求仅访问 SEC 官方公开 API；不需 API 密钥。可通过 SEC_USER_AGENT 环境变量提供项目访问标识，不写入报告。

```powershell
python backend/collect_sec_vintages.py --cik 0001045810 --root backend/data/sec_evidence --output docs/reviews/sec-vintages-2026-09-16/nvda.json
python backend/collect_sec_vintages.py --cik 0001045810 --root backend/data/sec_evidence --output docs/reviews/sec-vintages-2026-09-16/nvda.json --replay
python -m pytest backend/tests/test_sec_vintages.py backend/tests/test_price_evidence.py backend/tests/test_validate_scoring.py -q
```

最多读取五个历史申报列表文件，超过上限拒绝，不能默默截断。离线重放校验原始文件哈希，选择相同请求的最新归档，并在报告保留所选证据；报告可重建，原始响应不可覆盖。跨抓取版本比较需保留各轮报告。

[候选记录、隔离统计和原始证据清单](reviews/sec-vintages-2026-09-16/nvda.json)。原始文件在忽略目录 backend/data/sec_evidence，迁移研究环境时必须另行保存。

## 验收

41 项相关测试和 Ruff 通过；实际 SEC 采集成功，离线重放记录哈希一致。覆盖公开时间、修订生效、纽约日期、期间与单位隔离、冲突值、缺失元数据、非法值、时区缺失以及归档篡改拒绝。

未改变数据库、生产数据、评分权重或前端，未上线。测试数量不代表全市场财报数据已验证。

## 资料来源

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)：submissions、companyfacts 的范围、更新方式和历史申报分页。
- 实际原始请求地址、抓取时间、SHA-256 以及各条申报原始文件链接见候选报告。
