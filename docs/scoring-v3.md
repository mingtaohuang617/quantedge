# 评分 v3：第一优先级修改与验收

日期：2026-09-15

## 结果与范围

本轮修复评分口径、数据缺失和资产路由，保留现有因子家族及默认 60/40 权重。修改位于本地工作区，未发布线上。既有 Storybook、依赖配置和 main.jsx 工作不属于本轮修改。

这次修复不证明模型具备预测收益的能力。分类模型、历史时点基本面、企业行动与复权核验、成本和样本外回测仍属于后续研究。

## Before / After

| 项目 | 修改前 | 修改后 |
|---|---|---|
| 总分 | 全资产池内分别标准化质量和时机，再加权；页面却写直接加权 | 显示轨道直接加权；80 × 60% + 96 × 40% = 86.4 |
| 刷新与新增 | 后端批量、单标的 API、独立模式存在新旧公式混用 | 所有有效输出进入 v3 契约；浏览器在 DataProvider 统一评分 |
| 配置 | 分散的权重与隐含规则 | Python 与浏览器读取同一 scoring-policy.json，并通过跨语言测试验证 |
| 雷达图 | 自行转换 PE、ROE、RSI 等；与归因不同 | 详情及对比雷达都读取 subScores；跨资产对比仅显示共同趋势因子 |
| 缺失值 | 部分缺失填 50；未知折溢价填 0 | 分项保留 null；未达到最低覆盖率时不生成对应轨道及总分 |
| 数值单位 | 58.1B 等展示字符串直接送入 float | 解析 K/M/B/T；新抓取与重算快照使用数值，界面再缩写 |
| 币种 | 营收与市值直接相除；AUM 按美元阈值混用 | 营收/市值必须有相同且已标注的币种；非美元 AUM 不直接套美元阈值 |
| ETF 数据 | 缺集中度时用类别固定分；规模称为流动性 | 缺集中度保持缺失；明确命名“规模代理”，并提示尚未验证价差及深度 |
| 净值 | 杠杆产品被认为没有适用的 NAV；静态净值参与推算溢价 | 保留净值概念；没有折溢价时间依据时不参与，移除未标时静态 NAV 推算 |
| 资产分类 | 股票/ETF 两分法，所有杠杆产品混在一起 | 股票、指数 ETF、其他 ETF、单股杠杆、指数杠杆、其他杠杆、待分类 ETF、加密货币 |
| 历史变化 | 旧模型历史可能接入新分数 | 历史写入 score_history.v3.0.0.json；自定义权重不显示默认权重历史变化 |
| 页面含义 | “现在是不是买点” | “多月趋势强弱”，并注明不是买点或上涨概率 |

## 评分契约

- qualityScore、timingScore 和 score：数字或 null。总分使用已展示的一位小数轨道分计算。
- subScores：唯一的分项展示来源；缺失保持 null，不填中性值。
- scoring.version：3.0.0。
- scoring.status：ready、insufficient_data 或 unsupported。
- scoring.coverage：已使用数据的覆盖情况，不是预测准确率、上涨概率或来源可靠性。
- scoring.qualityCoverage、timingCoverage：分别展示；自定义权重同步改变综合覆盖率。
- scoring.factorPeerCounts：每个基本面因子的有效同类样本数量。
- scoring.momentumPeers：相同资产类型、市场和方向的有效动量样本数。
- scoring.priceAsOf：计算趋势使用的行情日期，不是刷新按钮点击时间。
- financialPeriod、financialPublishedAt：不确定时为空；抓取时间不冒充财报期或发布日期。
- assetType、underlyingType、underlyingSymbol、leverageMultiple、direction：明确分类；未确认的底层代码允许为空。
- scoringInputs：带模型版本的日线派生数据，旧版本不被自动接受。

资产元数据不完整时不会猜测杠杆倍数。识别为加密货币、其他杠杆或待分类 ETF 的产品暂不启用完整评分。基础数据不足的 ETF 也可暂不评分，分项仍展示已经具备的数据。

股票因子至少需要 65% 数据覆盖且有至少两个质量维度。ETF 使用有效维度权重计算覆盖率，缺费率或缺折溢价分别减少覆盖。趋势轨道也要求至少 65% 覆盖；动量分位至少需要 8 个有效同类样本。MA200 趋势必须有 200 根观测，不再用短历史冒充 MA200。基本面同类样本不足时使用已定义的绝对锚；没有绝对锚的因子暂缺，不跨行业、市场强行拼池。

杠杆质量封顶和波动磨损仍为原有规则；页面补充合计扣减说明。重新设计这部分模型属于第二优先级。

## 本地数据结果

本次重算 543 个标的，508 个有综合分，35 个暂不评分。没有重新获取行情或财报，也没有修改本地数据库。

评分所用本地行情日期：2026-05-29、2026-07-31、2026-08-04、2026-08-17、2026-08-21、2026-09-01、2026-09-02。页面对超过 10 个自然日的评分行情显示过期提示。这是提示阈值，不是历史回测的数据筛选规则。

例如本地 MU 重算结果为质量 77.0、趋势 89.8、总分 82.1，趋势行情截至 2026-09-01。它与用户截图的行情日期和输入不同，不能将两者差额解释为单日评分变化。前述 80/96 的示例只用于解释原截图的合成公式问题。

快照中没有财务币种来源的营收/市值因子会继续保持缺失；修复解析器不等于补齐币种。最新抓取入口已保留 financialCurrency 和 marketCapCurrency。跨币种折算需要有时间依据的汇率，当前不做默认换算。

SOXS 原快照缺少杠杆字段，已根据发行方资料补入已核验元数据，识别为指数反向 3 倍产品；元数据保存来源与核验日期。来源：[Direxion 产品页](https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs)。

## 验证与复现

后端相关测试 71 项通过，包含 Python/浏览器公式一致性、数值单位、跨币种、缺失数据、非法日线、资产分类、无关资产不改变总分、版本隔离历史及已有回测工具兼容性。前端 708 项测试通过，生产构建通过。

Playwright 验证桌面及 390×844 手机页面：权重切换公式、分类筛选、缺失状态、日期依据、布局宽度和页面异常。测试使用本地快照，拦截外部请求；它不构成线上接口可用性验证。

web-perf 的 Chrome DevTools 采集被现有 chrome-profile 占用阻断，new_page 与 list_pages 均返回配置目录已被使用。因此没有 Core Web Vitals trace，不宣称完成性能全面验收。

在仓库根目录运行：

```powershell
python -m pytest backend/tests/test_scoring.py backend/tests/test_scoring_contract.py backend/tests/test_score_history.py backend/tests/test_backtest_scoring.py backend/tests/test_backtest_strategy.py backend/tests/test_llm_helpers.py -q
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run test:e2e -- scoring-v3.spec.ts --project=chromium --workers=1
```

仅用本地日线库重新计算评分快照，不刷新行情与财报：

```powershell
python backend/rebuild_score_snapshot.py
```

后续入口：先补齐带来源、币种和日期的基础数据，再开展分类模型及样本外检验；不能用提高当前分数替代有效性验证。
# 后续版本

2026-09-16：当前实现已推进至 [v3.1 资产分层评价](scoring-v3.1.md)。下文保留第一阶段的历史验收记录，其中 ETF 60 分封顶与旧产品质量权重已被 v3.1 替换。
