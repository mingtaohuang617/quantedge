# NVIDIA 原始申报上下文核验

核验日期：2026-09-17。候选集沿用 2026-09-16 采集的 SEC companyfacts/submissions，原始申报于本轮另外下载并归档。

## 结论

三份原始申报的 63 条候选财务事实全部匹配。匹配要求同一申报编号、指标、单位、期间起止和数值，不仅检查页面上是否存在相同数字。该结果支持这些记录的来源可靠性，尚不能把整个历史财报库或估值因子标为可用。

| 申报 | 申报日期 | 匹配事实数 |
|---|---|---:|
| 10-Q，截至 2024-04-28 | 2024-05-29 | 16 |
| 10-Q，截至 2024-07-28 | 2024-08-28 | 26 |
| 10-K，截至 2026-01-25 | 2026-02-25 | 21 |

## Before 与 After

此前只有 SEC 汇总接口与申报编号的关联。本轮新增原始内联 XBRL 核验，保留每项事实的 context_id、fact_id、精度声明和原始文件哈希；重复上下文、不同数值或缺失上下文分别报告，不能靠顺序挑选。

解析时检查公司 CIK、标准会计标签命名空间、单位与期间，排除 segment/scenario 维度。对本轮选中指标，共排除 251 个带维度或不支持单位/上下文的事实节点；这些是原始节点，不是遗漏了 251 个公司级财务指标。

金额按 XBRL scale 转换，例如以百万列示的数字乘以一百万；负号按 sign 属性处理。EPS 的 USD/shares 与 USD 单独识别。未知数值变换、续接数字、nil 和排除内容拒绝解析，不以默认值代替。XML 禁止解析外部实体及加载 DTD，含 DTD 的文档拒绝。

## 单季与累计值

2024-08-28 的原始 10-Q 同时披露：

- 2024-04-29 至 2024-07-28 的单季净利润 165.99 亿美元。
- 2024-01-29 至 2024-07-28 的半年累计净利润 314.80 亿美元。
- 对应稀释 EPS 分别为 0.67 和 1.27 美元。

核验按起止日期区分，不把半年值当第二季度，也不对 EPS 做简单相减以推导另一个季度；加权平均股数及舍入使每股指标不能直接套用总额差分。

## 拆股与修订的边界

2024-05-29 申报的截至 2024-04-28 单季稀释 EPS 为 5.98 美元。后续 2024-08-28 申报明确全部每股金额已按十拆一追溯调整。各份原始数字均保留其申报口径，不用后来的尺度覆盖此前披露。

因此，即使 EPS 原始值匹配，历史市盈率仍须将 EPS 与相同时点股价转换到相同份额尺度。当前筛选函数不负责这个转换，也未自动允许这些 EPS 进入历史估值计算。

本轮三份实际样本均不是 /A 修订表单。已有修订生效逻辑通过合成测试，但真实修订链尚未完成核验，不能称为已验证所有修订。原始申报是今天下载的版本，也不是当时留存的抓取快照。

## 验收与下一步

- 实际三份 SEC 原始文件下载成功，哈希校验后离线核验，63/63 条候选匹配。
- 51 项相关测试与 Ruff 通过，覆盖尺度、负号、零值、USD/shares、公司与维度隔离、期间、冲突、未知变换及 DTD 拒绝。
- 沿用环境中的 lxml 5.3.0，并将研究依赖声明为可选 research 组；没有新增运行中的服务或改动生产评分。
- strict_pit_eligible 和 model_change_allowed 继续为 false。未改数据库、权重或前端，未上线。

下一步建立显式的财务期间与股份尺度转换：金额指标先验证季度与累计关系；每股指标按公司行动对齐股价，保留原始披露及转换证据，再用真实修订样本检验时点查询。完成后才扩大公司范围并接入历史质量分。

## 复现与证据

```powershell
python backend/verify_sec_originals.py --candidates docs/reviews/sec-vintages-2026-09-16/nvda.json --collection docs/reviews/sec-originals-2026-09-17/collection.json --output docs/reviews/sec-originals-2026-09-17/verification.json
python -m pytest backend/tests/test_sec_originals.py backend/tests/test_sec_vintages.py backend/tests/test_price_evidence.py backend/tests/test_validate_scoring.py -q
```

需要保留 backend/data/sec_filing_evidence 的原始归档。HTML 作为 JSON 的 html 字段封装，清单哈希覆盖这个封装后的原始证据；不是声称该哈希直接等于 HTTP HTML 字节哈希。报告另保留候选文件 SHA-256，防止拿不同候选版本冒充同次核验。

[下载清单](collection.json) · [逐项核验及原始证据](verification.json)

## 原始来源

- [2024-04-28 10-Q](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000124/nvda-20240428.htm)
- [2024-07-28 10-Q](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000264/nvda-20240728.htm)
- [2026-01-25 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)
