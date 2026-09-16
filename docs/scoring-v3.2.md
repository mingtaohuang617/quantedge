# 评分 v3.2：真实 ETF 产品数据接入

日期：2026-09-16。状态：本地完成，未部署生产。

## 本轮结果

三个代表性产品已接入可复现的产品数据。TQQQ 跑通费率、价差和每日跟踪误差的完整链路；EWY、RKLX 保留真实的部分覆盖，不补齐缺失值。所有产品仍与股票综合分分开。

| 产品 | 之前 | 当前结果 |
| --- | --- | --- |
| EWY，指数 ETF | 无带来源与日期的产品指标 | 官方费率 0.59%，30 日价差中位数 2 bps；覆盖 60%，产品分为空 |
| TQQQ，指数杠杆 ETF | 无完整产品分 | 官方净费率 0.82%，价差 1 bp；52 个对齐日收益的跟踪误差标准差 2.523494 bps；覆盖 100%，实验性产品质量 81.3 |
| RKLX，单股杠杆 ETF | 发行商与成立日错误，未关联底层 | 修正为 Defiance、2025-03-12，关联 RKLB；官方总费率 1.63%，价差 23 bps；覆盖 60%，产品分为空 |

价差观测日为 2026-09-15，抓取日为 2026-09-16。EWY、TQQQ 费率没有单独有效起始日，使用抓取日记录“当日观察到的费率”，不假设它此前已可得。RKLX 产品详情区标注数据日 2026-09-15。TQQQ 净费率减免期限为 2026-09-30，评价日越过该日期后该费率失效；不会擅自延续减免或猜测新费率。

## 跟踪计算与质量检查

TQQQ：发行商官方每日净值，与 Yahoo 提供的 Nasdaq-100 价格指数 NDX 日线匹配。指数数据来自行情供应商，不冒充 Nasdaq 授权直连数据。窗口为 2026-07-01 至 2026-09-15，共 53 个完全对应的净值和指数点，形成 52 个日收益观测。

逐日偏离 = 净值日收益 − 3 × NDX 日收益。产品误差采用逐日偏离的样本标准差，单位 bps，非年化。同时展示均值 −3.731430 bps、最大绝对值 12.984332 bps。不能用标准差代替持续偏离的方向，也不能据此判断持有期收益。

本次窗口经发行商分红接口及行情公司行动事件核查，没有分红或拆分，因此可使用净值比值构建该窗口的净值总回报。适配器遇到公司行动窗口会拒绝继续，等待经过核验的调整适配器，不把未调整净值当作总回报。日期不齐、重复、乱序、无效价格、样本不足、币种或收盘口径不同亦拒绝；不会通过内连接跳过中间缺日来制造“单日”收益。超过 10% 的日偏离会触发数据或公司行动复核，不截尾美化。

RKLX 公开跟踪 PDF 是区间计数与最大／最小偏离，不是本模型要求的每日标准差，因此没有入分。EWY 尚缺 MSCI Korea 25/50 Net 的可核验每日序列，未使用其他韩国 ETF 代替真实基准。

## 实现

- product-registry.json：官方产品身份、底层代码、目标收益口径及来源。更新 RKLX 的配置错误。
- product_ingestion.py：三个发行商页面的结构化适配器、单位转换、日期和身份校验、严格对齐的跟踪计算。
- refresh_product_data.py：显式只读抓取、原始文件缓存、SHA-256 证据清单及原子写入。失败保留明确缺失态，不编造数据；缓存可离线重放。
- product-observations.json：前后端共用的有日期观测快照。
- product_data.py / product-data.js：评分入口读取相同产品事实，刷新、静态快照和浏览器计算保持一致。评分请求本身不抓网页。
- asset_assessment：独立产品评价日、可得日与减免有效期校验；产品费率同步到旧的详情字段，避免同页出现两套费率。旧波动磨损字段缺少复权证据，三只接入产品不再展示旧估算。
- 页面显示产品来源、费率口径、减免期限、跟踪窗口、均值偏离及具体缺失原因。产品质量已有值时不再用“暂不评分”概括整张卡片。

主版本 3.2.0，资产分层版本 1.1.0。产品评价日独立于旧行情日，不回填历史得分；底层股票评价仍显示其原始行情日期。本轮未刷新 543 个资产的价格和股票财务字段。

## 可执行入口

在仓库根目录运行：

```powershell
python backend/refresh_product_data.py
python backend/rebuild_score_snapshot.py
npm --prefix frontend run build
```

第一条读取公开发行商及行情接口，更新本地产品观测；第二条使用只读本地日线重算评分字段。两者均不修改数据库结构，不发布网站。没有额外创建定时任务。

重放已保存的本次原始数据：

```powershell
python backend/refresh_product_data.py --cache-only --as-of 2026-09-16
```

缓存位于 backend/data/product_sources/2026-09-16，受现有 Git 忽略规则保护。来源清单保存于 [sources.json](reviews/scoring-v3.2/sources.json)。七个输入文件的 SHA-256 校验均与清单一致。失败不产生完整产品分；部分产品正常、部分失败时仍写入逐产品状态。

## 验证与边界

- 后端相关回归 92 项通过，包括三家发行商解析、异常序列、费率到期、源数据失败和前后端一致性。
- 前端 723 项通过；生产构建通过。
- 桌面与 390px 手机端浏览器验证通过，覆盖完整 TQQQ 产品数据、部分覆盖 EWY、SOXS 情景和股票原有公式。
- 产品分仍是未经过样本外校准的执行质量指标。股票行业模型、指数持仓穿透、加密链上基本面、时点回测没有在本轮完成。
- EWY 基准每日序列、RKLX 经公司行动核验的净值总回报序列及 TQQQ 有公司行动窗口的调整适配器是后续数据入口。
- 本轮没有新增公开发布、数据库迁移或付费数据授权。

## 一手资料与行情来源

- [iShares EWY 产品页](https://www.ishares.com/us/products/239681/ishares-msci-south-korea-capped-etf)
- [ProShares TQQQ 产品页](https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq)
- [ProShares TQQQ 历史净值](https://accounts.profunds.com/etfdata/ByFund/TQQQ-historical_nav.csv)
- [Defiance RKLX 产品页](https://www.defianceetfs.com/rklx/)
- [Defiance 跟踪偏离报告](https://www.defianceetfs.com/wp-content/uploads/divergence-tidal/DailyLeverageTrackingData.pdf)
- [Yahoo NDX 日线接口](https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX)

产品页支持产品事实，不为模型的分档阈值、权重或实验性产品分背书。
