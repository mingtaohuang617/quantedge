# QuantEdge 数据源与新鲜度契约

状态日期：2026-08-28

## 结论

页面不得只依赖一个“实时”布尔值。所有在线数据通过同源 BFF 返回 `data` 与 `meta`，其中 `as_of`、`source`、`cache_status`、`stale`、`quality`、`schema_version` 和 `request_id` 构成最低可信契约。

## 1. 数据路由

| 数据类型 | 主路由 | 失败处理 | 时间边界 |
|---|---|---|---|
| 浏览器报价 | Vercel `/api/yahoo` → Yahoo Finance | network-first，只回退已验证缓存 | 30 秒以内 fresh，最多回退 5 分钟 |
| 日线 K 线 | SQLite L0 → Tushare → iTick → Futu → yfinance | 按市场跳过不支持源，最终显式失败 | SQLite 日线默认 3 天新鲜 |
| 分钟线 | yfinance | 不落入日线 SQLite schema | 遵循上游历史窗口 |
| 实时报价 | iTick → yfinance；港股本地可用 Futu | 断路器防止 Futu 重复阻塞 | 响应携带 as_of |
| 公司基本面 | iTick → yfinance，美股批量补全可用 Finnhub | 不用缺失值冒充 0 | 保留披露日期或抓取日期 |
| 美国宏观 | FRED，multpl 只用于明确序列 | 子因子失败降质，不改写时点 | 按日/周/月频并显示观测日 |
| 中国宏观 | AKShare 与 Tushare | 单因子标记 unavailable | 按源数据频率 |
| Mining Alpha | Tushare/本地 Parquet/合成数据 | 真实策略不回退为 demo 结论 | run_id 绑定数据区间与产物 |
| LLM | DeepSeek，仅服务端 | 并发/成本限额，失败显示降级 | 输出标注模型与生成时间 |

## 2. 市场路由细则

- US：Tushare → iTick → yfinance。
- HK：Tushare → iTick → Futu → yfinance。
- SH/SZ/CN：Tushare → iTick → Futu → yfinance。
- KR/JP：iTick → yfinance。
- 非日线 interval 跳过日线缓存与不兼容源，直接走 yfinance。

## 3. 前端状态

- loading：尚无可用数据，不显示上次数值伪装实时。
- stale：有可用缓存，但已超过该数据类型的 fresh 窗口。
- fallback：上游失败，使用未超过硬上限的替代数据。
- empty：请求成功但数据集合法为空。
- error：无可信数据，显示结构化错误和 request_id。

## 4. 数据校验不变量

- 价格、复权、币种和交易日历必须在因子或回测前归一化。
- 回测必须记录数据区间、基准、再平衡频率、交易成本和缺失值处理。
- 宏观修订数据必须区分 value date 与可见日期；无 vintage 时明示限制。
- `source=demo` 或 `quality=synthetic` 不得用于宣称真实投资绩效。
- Service Worker 不缓存 `/api/`，公共 CORS 代理不得进入任何降级链。
