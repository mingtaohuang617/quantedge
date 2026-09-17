# 历史估值输入：采集、口径与准入

验收日期：2026-09-17。研究分支，本轮完成四家公司价格证据采集、原文股数提取、拆股单位检查、估值诊断和评分准入连接。正式估值输入仍被阻断；未修改生产模型、数据库、评分权重或前端，未部署。

## Before → After

| 项目 | 修改前 | 修改后 |
|---|---|---|
| 历史价格 | 四个财报试算未绑定报价 | 每例绑定指定完整交易日的 Close、币种、收盘时刻、请求和原始响应哈希 |
| 股数 | 尚未提取原文股数 | 从同份 SEC 原文提取期末普通股流通股数，另列 EPS 加权平均股数 |
| EPS | 未进入估值诊断 | 按同一财年完整期间取原文稀释 EPS；亏损/缺失不生成正 PE |
| 拆股 | 已有 NVDA EPS 单位案例 | 新增一般拆股/反向拆股因子校验，并重放原文 10 拆 1 案例 |
| 估值 | 全部缺少输入 | 提供带假设的 PE/PB/市值诊断；准入失败时不给评分引擎传入这些值 |

## 证据结果

四次请求全部成功。归档日线共 2,751 条，每家公司从指定报价日期请求至 2026-09-17（不含）；标准化结果最后完整日期为 2026-09-15，供应商返回的 09-16 行按实际抓取时刻排除。以 `prices.json`、原始 manifest 的实际 UTC 抓取时间为准，不把报告日期当作抓取时刻。

Yahoo 是价格供应商来源，未冒充交易所一手成交档案。SEC 原文是本轮财务数据一手来源。Adj Close 不用于估值；Yahoo 官方说明它包含拆股与分红调整。Close 也不因字段名称而自动视为当时未复权成交价。

以下仅为诊断：假设供应商 Close 与所选原文财务数字具有相同每股口径，并暂以期末股数估算。不是获准进入模型的估值，也不是同一日期的横向排名。

| 公司 | 报价日期 | 供应商 Close（美元） | 股数日期 | 原文期末股数 | 诊断 PE | 诊断 PB | 正式准入 |
|---|---|---:|---|---:|---:|---:|---|
| NVDA | 2026-02-25 | 195.56 | 2026-01-25 | 24,304,000,000 | 39.91 | 30.22 | 阻断 |
| PLUG | 2021-05-14 | 24.58 | 2020-12-31 | 458,051,920 | 空 | 7.68 | 阻断 |
| MU | 2023-10-06 | 69.96 | 2023-08-31 | 1,098,000,000 | 空 | 1.74 | 阻断 |
| MSFT | 2024-07-30 | 422.92 | 2024-06-30 | 7,434,000,000 | 35.84 | 11.71 | 阻断 |

NVDA、MSFT 年度稀释 EPS 分别为 4.90、11.80 美元；MU 为 -5.34，不生成正 PE。PLUG 所选原文标准上下文中未取得该完整年度稀释 EPS，保持缺失。没有使用“净利润÷期末股数”冒充稀释 EPS，也没有拿加权平均股数计算市值。

## 明确阻断原因

- 四例 Close 尚未独立核验为当时未复权价格。
- 价格、EPS 和股数没有获证完整一致的拆股口径链。供应商请求范围内没有返回拆股事件，不等于独立证明没有事件，且请求起点不覆盖财年末至报价日的完整间隔。
- 期末股数距离试算日分别为 32、135、37、31 个自然日，不能宣称是估值当日股数。当前保守准入要求股数日期与报价日期一致；这是待校准的研究规则，不是生产评分政策。后续若接受最近披露股数估计，应单独定义可信度与更新规则，不能偷偷放宽。

所有诊断单列在 `valuation.json` 的 `diagnostics`；`inputs` 均为空。实际调用现有评分引擎验证其不进入质量分，四例总质量分继续为空。没有凭诊断值改善覆盖率，也没有调整权重。

## 拆股检查

发行人 2024 年公告确认 NVDA 于 6 月 10 日开始按 10 拆 1 后口径交易。重放既有核验案例：原单季 EPS 5.98 转为 0.598，因子 10。仅验证每股单位变化，不把单季 EPS 当成年化或 TTM EPS。

通用因子采用新股/旧股比例，按 `(start, end]` 计入事件，拒绝重复日期、非法比例和缺来源事件。测试覆盖反向拆股，并验证价格与 EPS 同比转换后 PE 不变、价格与股数反向转换后市值不变。它不负责自动认证事件清单完整性；未完成认证不能自动放行。

## 重放及验收

```powershell
python backend/audit_historical_valuation.py
python -m pytest backend/tests/test_historical_valuation.py backend/tests/test_financial_admission.py backend/tests/test_financial_basis.py backend/tests/test_sec_originals.py backend/tests/test_sec_vintages.py backend/tests/test_price_evidence.py backend/tests/test_validate_scoring.py -q
python -m ruff check backend/historical_valuation.py backend/audit_historical_valuation.py backend/tests/test_historical_valuation.py backend/verify_sec_originals.py
```

95 项相关测试和 Ruff 通过。原文解析器仅增加可选标签集合，默认八类标签不变；原有财报准入、原文验证及价格归档测试通过。没有前端变更，本轮验证采用实际归档重放与 Python 测试。

报告记录上游文件 SHA-256，并验证原准入报告所引用文件未改变；原文和报价读取时再次核验不可变归档哈希。原始文件位于忽略目录 `backend/data/sec_filing_evidence`、`backend/data/price_evidence`，迁移环境需另行复制。单独 Git 检出不能重建这些原件。

## 下一批建议

先集中打通 MSFT 单一历史时点：取得独立价格口径证明，提取截至查询时点最近公开的实际流通股数，并评估“最近披露股数估计”与“估值日股数”的差异及可信度。达到可解释的准入标准后，再推广至其他公司。ETF 和杠杆 ETF 的产品质量、加密资产专属指标仍须走各自模型，不能继承股票估值输入。

## 来源

- [Yahoo 调整后收盘价定义](https://help.yahoo.com/kb/SLN28256.html)
- [NVDA 拆股 SEC 公告](https://www.sec.gov/Archives/edgar/data/1045810/000104581024000144/nvda-20240607.htm)
- [NVIDIA 官方拆股问答](https://investor.nvidia.com/files/doc_downloads/2024/06/nvidia-2024-stock-split_faq_investors.pdf)
- 四份财报的原文 URL、context ID、fact ID、单位、精度及价格请求参数详见 `valuation.json`。
