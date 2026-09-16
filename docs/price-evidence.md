# 价格证据层与总回报准备

2026-09-16：建立独立研究数据层，完成 7 个资产、6,799 条完整日线的采集与离线重放。生产库、原行情路由、评分权重与线上版本未改变。

[本轮验收报告](reviews/price-evidence-2026-09-16/legacy-comparison.md)

## 已实施

- price_evidence.py：按原始响应哈希、请求参数和带时区抓取时间保存证据；重放验证原文和清单均未被修改。衍生数据也按内容哈希另存，包含标准化器版本。
- collect_price_evidence.py：显式、限量采集，最多 20 个指定标的；指定起止日、daily interval、分红/拆股/资本利得事件；无数据源回退，无自动价格修复，无数据库写入。
- audit_price_evidence.py：同日且连续区间对比旧库与供应商候选序列；人工指定官方拆股记录用于交叉核对。
- 总回报计算器：要求价格、现金分配份额单位、币种与公司行动完整性已确认。原始实际成交份额与固定拆股份额分别计算，防止重复乘拆股比例；分配在除息日收盘再投资。

## 操作

在仓库根目录执行：

```powershell
python backend/collect_price_evidence.py --symbols NVDA MU EWY TQQQ RKLX BTC-USD ETH-USD --start 2023-01-01 --end 2026-09-16 --root backend/data/price_evidence --report docs/reviews/price-evidence-2026-09-16/collection.json
```

end 不包含当天。供应商可能额外返回请求外数据；标准化器按交易所时区排除当天及范围外日线，在 excluded_sessions 中保留日期。原始响应不删减。

完全离线重放同一请求：

```powershell
python backend/collect_price_evidence.py --symbols NVDA MU EWY TQQQ RKLX BTC-USD ETH-USD --start 2023-01-01 --end 2026-09-16 --root backend/data/price_evidence --report docs/reviews/price-evidence-2026-09-16/collection.json --replay
python backend/audit_price_evidence.py --database ../../backend/data/quantedge.db --collection docs/reviews/price-evidence-2026-09-16/collection.json --reviews docs/reviews/price-evidence-2026-09-16/action-reviews.json --output docs/reviews/price-evidence-2026-09-16/legacy-comparison.json
```

第二条 database 路径对应本轮隔离工作树；在原仓库使用 backend/data/quantedge.db。原始证据目录受现有忽略规则保护，不随代码提交；复制研究环境时必须一并保留。清单记载本机证据位置。

## 本次实测发现

- NVDA/MU/EWY/TQQQ 各 928 根完整日线；RKLX 379 根；BTC/ETH 各 1,354 根。截止日均为 2026-09-15，RKLX 起点为 2025-03-13。
- NVDA、TQQQ、RKLX 的指定拆股日与比例经 SEC/发行商文件抽查相符；这不等于已经查全分红和其他公司行动。
- RKLX 的 365 个旧库可比区间中，193 个与新供应商调整价收益差异超过 10 bps，中位绝对差异 29.69 bps。旧库 2025-03-14 对应约 757% 日收益，新候选约 13.39%。旧库 source 标签为 futu，不据此断言券商原始数据错误；应追查采集/转换/覆盖历史。
- 新 RKLX 候选自身在 2026-05-08 的调整价收益约 67.70%，仍标记待核查；大幅上涨本身不能证明数据错误，也不自动裁剪。
- 加密货币当天未完成值已排除。新研究行情没有擅自加入原生产评分池。

## 准入状态

七个数据包的 return_basis 均为 vendor_adjusted_proxy，strict_total_return_eligible 均为 false。尚未独立核验所有现金分配金额及份额单位、交易日历、全部公司行动和历史修订版本，因此不接入严格评分有效性结论。

2026-09-16 后续核查已解释 RKLX 的加法复权特征，核对发行商现金分配，并检查其 379 个候选交易日。完整结果见 [RKLX 核查报告](reviews/rklx-reconciliation-2026-09-16/review.md)。独立价格/NAV 与完整份额单位仍待认证；不能通过手改一个 eligible 标志或复制当前值解除准入。

## RKLX 只读复现

在本轮隔离工作树根目录运行，需保留此前的原始归档：

```powershell
python backend/reconcile_rklx.py --database ../../backend/data/quantedge.db --etf-folder backend/data/price_evidence/85acf4781490961359436e37c9b51f3b9f64ad594bbe0ceabaf74692fb85885e --underlying-folder backend/data/price_evidence/9f1d3dae0258f2f5db05de65763585eb5566fde232e22cc65bf671da0825b738 --issuer-folder ../../backend/data/product_sources/2026-09-16 --output docs/reviews/rklx-reconciliation-2026-09-16/reconciliation.json
python -m pytest backend/tests/test_rklx_reconciliation.py backend/tests/test_price_evidence.py backend/tests/test_validate_scoring.py -q
```

research_calendar 仅适用明确边界内的美股日线，不自动扩展到港股、加密资产、其他年份或盘中交易。现有全市场严格回测的日历阻断仍然保留。旧库读取现在包含 OHLC，故新审计的数据哈希与此前只读收盘价时不同；这不是旧库被改写。

## 验证

后续 [跨拆股、分红核验](reviews/rklx-cash-2026-09-16/review.md)增加两个一年期检查点：供应商 Adj Close 比值未通过两项，按发行商现金在除息日收盘再投资的条件式情景通过。累计情景 10/10 项通过；逐日独立价格与行动完整性尚未认证，不修改严格准入或评分权重。下一独立阶段可以建设 SEC 财报公开时间与修订版本。

2026-09-16 新增 [发行商收益检查点核验](reviews/rklx-checkpoints-2026-09-16/review.md)：RKLX 八项累计市场价格收益均落在发行商显示精度内。检查区间均未跨越 2025 年拆股及分红，不能据此解除全历史总回报准入；运行入口及独立 NAV 抽查见该报告。

53 项价格证据、评分验证、产品解析和前后端评分契约相关测试通过；Ruff 检查通过。覆盖拆股/并股、现金再投资、缺失行动、币种、重复复权、源文件篡改、历史版本保留、当日排除、日期不齐和错误收益区间对比。

来源链接、请求、哈希和具体数值见本轮报告及 JSON。未部署、未迁移数据库、未覆盖生产数据。
