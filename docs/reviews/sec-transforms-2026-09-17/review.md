# 财务期间、拆股份额与真实修订案例

核验日期：2026-09-17。本轮增加显式转换工具和真实重述样本，仍不改变生产评分权重。

## 结果

三个案例均已通过原始事实与转换规则核验：

| 案例 | 输入与结果 | 使用边界 |
|---|---|---|
| NVIDIA 期间差分 | 半年净利润 314.80 亿美元减第二季度 165.99 亿美元，得到第一季度 148.81 亿美元 | 同一申报、指标与单位；推导结果到该次申报公开后才可用 |
| NVIDIA EPS 份额转换 | 拆股前 5.98 美元按十拆一换算为 0.598 美元 | 仅对齐份额尺度；单季 EPS 不能直接充当 TTM EPS |
| Plug Power 2019 年净利润重述 | 原值 -85,465,000 美元；后续重述 -83,743,000 美元 | 查询按版本公开时间切换，原始值不覆盖 |

## Before 与 After

此前只验证原始事实与汇总接口是否一致。本轮新增同申报金额差分和有证据的 EPS 份额转换，结果均携带输入事实、可用时间、来源及转换方法。

期间差分仅用于白名单内的可加总金额，要求同一公司、同一申报、同一指标、同一单位，且扣除部分必须是总期间的完整前段或后段。跨申报、EPS、时点余额及中间重叠区间直接拒绝。没有自动拼接 TTM。

EPS 转换要求明确源份额尺度、目标份额尺度、拆股比例及证据，不能根据申报日期猜测。已包含的拆股不重复处理，尚未公开或尚未进入拆股后交易口径的事件不能用于早期查询。原始 EPS 不被覆盖，转换结果 valuation_ready 仍为 false。

## NVIDIA 实际核验

差分使用 2024-08-28 申报的两个净利润上下文。推导出的 2024-01-29—2024-04-28 净利润与 2024-05-29 原始申报数值一致，但推导结果的保守可用时间仍为 2024-08-29，不能把后来推导的记录回填为早期已知数据。早期查询可使用当时的原始披露记录。

EPS 来源为 2024-05-29 申报中的单季 5.98 美元。转换事件依据 2024-06-07 的 SEC 8-K，目标尺度对应 06-10 开始的拆股后交易。本轮仅核对该十拆一事件，不能据此证明完整股份行动链。换算值保留 0.598，不额外四舍五入；它不代表重新估算了原始 EPS 的精确未舍入值。

## Plug Power 真实修订链

新增采集 CIK 0001093691 的候选事实，并独立保存以下三份申报：

- 2020-03-10 的 2019 年 10-K：2019 年净利润 -85,465,000 美元。
- 2021-05-14 的 2020 年 10-K：对照披露的 2019 年净利润 -83,743,000 美元。
- 2022-03-14 的 2020 年 10-K/A：再次披露 -83,743,000 美元。

所选净利润事实在三份原始文件中均匹配。保守查询规则的结果为：2021-05-14 纽约中午仍选原值；05-15 选重述值；2022-03-15 选 /A 申报中的值。最后一次修订值未发生变化也保留其版本，不为制造案例而要求数值不同。

这验证的是选定事实的版本切换，尚未覆盖“此前财报不可依赖”公告或更早的业绩披露。因此不能把保守查询仍返回旧值解释为该时点旧值仍适合投资决策。真实历史评分接入前还须增加不可依赖状态的阻断。

## 原始解析与未通过项

2019 年原始年报使用传统独立 XBRL 实例。本轮从同一 SEC 申报目录的文件清单定位实例，保留原始 HTML 和 XML，新增传统实例支持；不把普通 HTML 强行当作内联 XBRL。

兼容已观察到的旧版标准标签命名空间、numdotdecimal 数字变换及本地标准 HTML 实体表。继续拒绝未知变换、外部实体和 DTD，不使用宽松 XML 修复来掩盖格式错误。

三份 Plug Power 申报共核验 177 条候选事实，168 条精确匹配，9 条存在原始上下文的多个数值。示例：2019 年经营现金流分别显示 -51,522,000 和 -51,500,000，精度声明也不同。这提示差异可能来自显示舍入，尚未将它们自动视为等价。该项仍标为 ambiguous_original_context，整体核验命令预期返回 2；本轮选取的三个净利润事实不在这九项之内。

## 验证与下一步

- 68 项相关测试与 Ruff 通过。涵盖期间边界、同申报限制、EPS 禁止差分、来源未公开、重复拆股、缺失事件、传统 XBRL、旧标签及实体处理。
- 三个实际案例由脚本重算，输出完整输入来源；没有用合成数值冒充真实修订。
- strict_pit_eligible、model_change_allowed 继续为 false。未改生产数据库、前端或权重，未上线。

下一步补财报不可依赖状态，以及按原始 decimals 精度声明判断多值是否兼容的规则，再扩大历史财报样本。期间和股份转换不能替代完整数据准入，也不足以直接宣布质量分有效。

## 复现

```powershell
python backend/verify_sec_originals.py --candidates docs/reviews/sec-transforms-2026-09-17/plug-candidates.json --collection docs/reviews/sec-transforms-2026-09-17/plug-originals.json --output docs/reviews/sec-transforms-2026-09-17/plug-verification.json
python backend/audit_financial_basis.py --nvda docs/reviews/sec-originals-2026-09-17/verification.json --plug docs/reviews/sec-transforms-2026-09-17/plug-candidates.json --plug-verified docs/reviews/sec-transforms-2026-09-17/plug-verification.json --output docs/reviews/sec-transforms-2026-09-17/cases.json
```

第一条预期返回 2，保留九项未解决的多值上下文。第二条仅验证三个已明确的案例。原始证据位于 backend/data/sec_evidence、backend/data/sec_filing_evidence，目录不随代码提交，需另行保留。

[转换与查询结果](cases.json) · [Plug Power 逐项原始核验](plug-verification.json) · [原始下载清单](plug-originals.json)

## 来源

- [NVIDIA 拆股 8-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000144/nvda-20240607.htm)
- [Plug Power 原始 2019 年 XBRL](https://www.sec.gov/Archives/edgar/data/1093691/000155837020002267/plug-20191231.xml)
- [Plug Power 2020 年 10-K](https://www.sec.gov/Archives/edgar/data/1093691/000155837021007147/plug-20201231x10k.htm)
- [Plug Power 2020 年 10-K/A](https://www.sec.gov/Archives/edgar/data/1093691/000155837022003577/plug-20201231x10ka.htm)
