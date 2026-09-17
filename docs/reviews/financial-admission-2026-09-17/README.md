# 财报准入与历史质量分试算验收

日期：2026-09-17。范围：研究分支，四家公司、选定申报与六个公告边界查询。四项本轮工作已完成；未修改生产评分权重、数据库或前端，未部署。

## 修改前后

| 项目 | 修改前 | 本轮结果 |
|---|---|---|
| 不可依赖公告 | 仅按申报可用时间选值，公告期间仍可能返回旧财报 | 新准入入口按已核验公告阻断，替代申报须单独核验且已到可用时间 |
| PLUG 原文差异 | 177 项中 168 项完全匹配，9 项因多个显示精度而歧义 | 168 项完全匹配、9 项舍入兼容；仍保留全部原值和精度区间 |
| 公司样本 | NVDA、PLUG | 加入 MU 与 MSFT，新增 41 项原文事实核验 |
| 历史质量分 | 尚未连接可追溯财务输入 | 四个独立历史时点接入现有评分引擎，缺估值输入则总质量分为空 |

## 公告拦截

PLUG 原始 8-K Item 4.02 披露部分旧财报不可依赖。内部决定日期为 2021-03-12，已核验 SEC 接收时间为 2021-03-16 20:52:21 UTC。按后者阻断，不把后来获知的决定回填至 3 月 12 日。这是本案例的 SEC 公开时间代理，不宣称覆盖可能更早的新闻稿。

- 2021-03-16 20:52:20 UTC：选定旧记录可作为研究候选。
- 2021-03-16 20:52:21 UTC 起：旧记录被阻断；5 月 14 日查询仍阻断。
- 2021-05-15 04:00:00 UTC：已核验重述申报到达保守可用时间，2019 年净利润采用重述后的 -83,743,000 美元。
- 2022-03-15：已核验修订申报可选。旧申报不会因时间流逝自动解禁。

公告影响期间、替代申报清单由本次人工原文核验界定，尚无全市场公告完整性保证。`select_fact` 保留为低层候选选择器；任何质量分试算必须通过 `select_admitted`。此前 `sec-transforms` 报告是公告建模前的候选选值案例，不再代表准入结果。新报告 `trial.json` 明确显示被阻断的时段。

## 原文精度

只有候选数值恰为一个原文披露值，并落在所有对应事实按 decimals 推导的闭合舍入区间内，才标记 `matched_with_rounding`。不平均、不改写原始值；未知精度、互斥区间或真正冲突继续拒绝。边界包含仅代表本研究的兼容判断，不断言发行人采用某种半值舍入规则，也不是完整 XBRL 一致性认证。

`financial_basis` 的旧差分和 EPS 单位转换仍要求完全匹配，本轮不扩大这些转换的准入范围。新试算入口接受明确标注的舍入兼容值，报告保留来源。

## 历史试算

采用同一申报的完整年度净利润、营收、上年度营收和期初/期末权益；ROE 使用平均权益。两个权益均须为正，利润率分母须为正，增长计算须前期营收为正且当期营收非负。财政年度按实际日期匹配，不强行转换为自然年；没有季度 TTM 推断。

| 公司 | 财年结束 | 试算日期（纽约） | ROE | 净利率 | 营收增长 | 质量覆盖率 | 总质量分 |
|---|---|---|---:|---:|---:|---:|---|
| NVDA | 2026-01-25 | 2026-02-26 | 101.49% | 55.60% | 65.47% | 50% | 空 |
| PLUG | 2020-12-31 | 2021-05-15 | -74.67% | 空 | 空 | 17% | 空 |
| MU | 2023-08-31 | 2023-10-07 | -12.41% | -37.54% | -49.48% | 50% | 空 |
| MSFT | 2024-06-30 | 2024-07-31 | 37.13% | 35.96% | 15.67% | 50% | 空 |

这是各自历史时点的独立研究案例，不是同一日期的股票排名。使用现有绝对锚；没有历史行业同类样本。PLUG 2020 年营收为负，利润率和增长输入被阻断。四家公司均缺当时可追溯的估值输入，按现有覆盖率门槛保留空质量分。盈利、增长分项及来源在 `trial.json`，不把分项冒充完整质量分。

MU 新增 1,447 条候选、选定原文 21 项；MSFT 新增 1,560 条候选、选定原文 20 项。候选数量不等于已验证样本数量；新增原文全部完全匹配。

## 重放与测试

在隔离工作树根目录运行：

```powershell
python backend/audit_financial_admission.py
python -m pytest backend/tests/test_financial_admission.py backend/tests/test_financial_basis.py backend/tests/test_sec_originals.py backend/tests/test_sec_vintages.py backend/tests/test_price_evidence.py backend/tests/test_validate_scoring.py -q
python -m ruff check backend/financial_admission.py backend/historical_quality_trial.py backend/audit_financial_admission.py backend/verify_sec_originals.py backend/tests/test_financial_admission.py
```

83 项相关测试通过，Ruff 通过。覆盖公告精确时刻、替代申报可用时间、原文缺失/不一致拒绝、负值和舍入边界、真实冲突、年度期间、缺权益、不跨申报拼接、禁止未来输入以及旧有研究回归。试算报告绑定候选与核验报告 SHA-256；公告 HTML 与接收时间证据离线重放时再次校验归档。

原始 SEC 归档位于忽略目录 `backend/data/sec_evidence` 与 `backend/data/sec_filing_evidence`；迁移环境必须另行复制，单独检出 Git 不包含这些原件。HTML/XML 包装为 JSON 归档，哈希对应包装文件，不宣称是原始 HTTP 字节哈希。

## 仍未满足与下一入口

`strict_pit_eligible=false`、`model_change_allowed=false`。本轮验证的是准入和缺失处理，不证明评分具有预测能力。下一批先补选定历史时点的价格、股数及拆股口径，构造可追溯估值输入；之后再扩展历史成员、修订/公告覆盖与样本外检验。不得因四家公司分项可计算而调整权重。

## 一手来源

- [PLUG 不可依赖公告](https://www.sec.gov/Archives/edgar/data/1093691/000110465921037184/tm219753d1_8k.htm)
- [MU 2023 年报](https://www.sec.gov/Archives/edgar/data/723125/000072312523000054/mu-20230831.htm)
- [MSFT 2024 年报](https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm)
- [XBRL precision、decimals 与 units 指引](https://www.xbrl.org/WGN/precision-decimals-units/WGN-2017-01-11/precision-decimals-units-WGN-2017-01-11.html)
- 其余申报 URL、上下文、原值及检索证据见本目录 JSON 和既有 SEC 核验报告。
