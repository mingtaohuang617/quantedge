/**
 * QuantEdge i18n — 中英文国际化
 * 架构：中文文本作为 key，英文翻译作为 value
 * 中文模式直接穿透，英文模式查表
 */
import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const LangContext = createContext();
const LANG_KEY = 'quantedge_lang';

// ─── English Translation Dictionary ─────────────────────────
const EN = {
  // ── Auth Page ──
  '综合量化投资平台': 'Quantitative Investment Platform',
  '输入邀请码': 'Enter Invite Code',
  '本平台为内测阶段，需凭邀请码访问': 'This platform is in beta. An invite code is required.',
  '请输入邀请码': 'Enter invite code',
  '验证中...': 'Verifying...',
  '进入平台': 'Enter Platform',
  '邀请码无效，请检查后重试': 'Invalid invite code. Please try again.',
  '隐私政策': 'Privacy Policy',
  '服务条款': 'Terms of Service',

  // ── Navigation ──
  '量化评分': 'Quant Scoring',
  '组合回测': 'Portfolio Backtest',
  '实时监控': 'Live Monitor',
  '投资日志': 'Investment Journal',

  // ── UserProfile Panel ──
  '账户信息': 'Account Info',
  '天': 'days',
  '标的': 'Securities',
  '日志': 'Journal',
  '缓存': 'Cache',
  '偏好设置': 'Preferences',
  '深色模式': 'Dark Mode',
  '语言': 'Language',
  '简体中文': 'Simplified Chinese',
  '数据源': 'Data Source',
  '在线': 'Online',
  '离线': 'Offline',
  '最近更新': 'Last Updated',
  'API 直连': 'API Direct',
  '独立模式 · 本地缓存': 'Standalone · Local Cache',
  '数据管理': 'Data Management',
  '导出数据': 'Export Data',
  '标的列表 + 投资日志 → JSON': 'Securities + Journal → JSON',
  '清除缓存': 'Clear Cache',
  '确认清除？再次点击执行': 'Confirm? Click again to clear',
  '清除本地缓存数据': 'Clear local cache',
  '关于': 'About',
  '版本': 'Version',
  '许可': 'License',
  'Early Access · 邀请制': 'Early Access · Invite Only',
  '联系': 'Contact',
  '退出登录': 'Log Out',

  // ── Common / Shared ──
  '全部': 'All',
  '美股': 'US',
  '港股': 'HK',
  '个股': 'Stocks',
  'ETF': 'ETF',
  '杠杆': 'Leveraged',
  '搜索中...': 'Searching...',
  '添加': 'Add',
  '查看': 'View',
  '删除': 'Delete',
  '取消': 'Cancel',
  '刷新': 'Refresh',
  '刷新中...': 'Refreshing...',
  '已添加': 'Added',
  '未找到匹配标的': 'No matching securities',
  '未找到匹配的标的': 'No matching securities found',
  '未找到匹配结果，请尝试其他关键词': 'No results found. Try different keywords.',
  '个标的': 'securities',
  '评分': 'Score',
  '涨跌': 'Change',
  '代码': 'Ticker',
  '价格': 'Price',
  '收益率': 'Return',
  '未知': 'Unknown',
  '数据不足': 'Insufficient Data',

  // ── Scoring Dashboard ──
  '近期财报': 'Upcoming Earnings',
  '今天': 'Today',
  '明天': 'Tomorrow',
  '日内': 'Intraday',
  '动量': 'Momentum',
  '查看详情': 'View Details',
  '删除标的': 'Remove Security',
  '搜索标的 / 代码 / 板块...': 'Search securities / ticker / sector...',
  '因子权重配置': 'Factor Weight Config',
  '合计': 'Total',
  '基本面': 'Fundamentals',
  'PE⁻¹ + ROE + EPS质量': 'PE⁻¹ + ROE + EPS Quality',
  '技术面': 'Technical',
  'RSI均值回归 + 动量 + β风险': 'RSI Reversion + Momentum + β Risk',
  '成长性': 'Growth',
  '营收增速 + 利润率扩张': 'Revenue Growth + Margin Expansion',
  '应用权重并重新评分': 'Apply & Rescore',
  '清除筛选': 'Clear Filters',
  '快速添加标的': 'Quick Add Security',
  '输入代码或名称搜索...': 'Search by ticker or name...',
  '返回列表': 'Back to List',

  // ── Time Ranges ──
  '分时': 'Intraday',
  '五日': '5D',
  '月': '1M',
  '6月': '6M',
  '今年': 'YTD',
  '1年': '1Y',
  '5年': '5Y',

  // ── Price Chart & Detail ──
  '区间收益': 'Period Return',
  'ETF 评估雷达': 'ETF Assessment Radar',
  '多因子雷达': 'Multi-factor Radar',
  '52周价格区间': '52-Week Price Range',
  '52周低': '52W Low',
  '52周高': '52W High',
  '超买': 'Overbought',
  '超卖': 'Oversold',
  '中性': 'Neutral',
  '评分拆解': 'Score Breakdown',
  '成本效率': 'Cost Efficiency',
  '流动性': 'Liquidity',
  '动量趋势': 'Momentum Trend',
  '风险分散': 'Risk Diversification',

  // ── Radar Factors ──
  '费率优势': 'Fee Advantage',
  '折溢价': 'Premium/Discount',
  '规模(AUM)': 'AUM Scale',
  '集中度风险': 'Concentration Risk',
  'PE估值': 'PE Valuation',

  // ── ETF Detail ──
  'ETF 核心指标': 'ETF Key Metrics',
  '成本与费用': 'Cost & Fees',
  '总费率 (ER)': 'Expense Ratio (ER)',
  '年化波动磨损': 'Annualized Decay',
  '折溢价率': 'Premium/Discount',
  '溢价': 'Premium',
  '折价': 'Discount',
  '平价': 'Par',
  '跟踪效果': 'Tracking',
  '标的指数': 'Benchmark Index',
  '跟踪误差': 'Tracking Error',
  'N/A (主动管理)': 'N/A (Active)',
  '流动性与规模': 'Liquidity & Scale',
  '日均成交': 'Avg Daily Volume',
  '买卖价差': 'Bid-Ask Spread',
  '定性信息': 'Qualitative Info',
  '基金管理人': 'Fund Manager',
  '分红政策': 'Dividend Policy',
  '成立日期': 'Inception Date',
  '52周区间': '52W Range',

  // ── Stock Core Metrics ──
  '核心指标 · 真实数据': 'Core Metrics · Real Data',
  '营收增长': 'Revenue Growth',
  '利润率': 'Profit Margin',
  '年营收': 'Annual Revenue',
  '市值': 'Market Cap',
  '下次财报': 'Next Earnings',

  // ── Holdings Distribution ──
  '持仓分布': 'Holdings Distribution',
  '只': '',
  '集中度': 'Concentration',
  '年': 'yr',

  // ── Backtest Page ──
  '组合构建器': 'Portfolio Builder',
  '等权分配': 'Equal Weight',
  '搜索代码或名称添加标的...': 'Search ticker or name to add...',
  '回测参数': 'Backtest Parameters',
  '初始资金': 'Initial Capital',
  '交易成本 (bps)': 'Trading Cost (bps)',
  '无成本': 'No Cost',
  '基准对比': 'Benchmark',
  '纳斯达克 (QQQ)': 'NASDAQ (QQQ)',
  '韩国 (EWY)': 'Korea (EWY)',
  '回测周期': 'Backtest Period',
  '1月': '1M',
  '自定义': 'Custom',
  '至': 'to',
  '起始日期不早于所有标的数据起点，结束日期不晚于今天': 'Start date from earliest data; end date up to today',
  '再平衡策略': 'Rebalancing Strategy',
  '不再平衡': 'No Rebalancing',
  '季度再平衡': 'Quarterly',
  '年度再平衡': 'Annual',
  '每季度初自动调回初始比例 (1月/4月/7月/10月)': 'Auto-rebalance to initial weights quarterly (Jan/Apr/Jul/Oct)',
  '每年1月初自动调回初始比例': 'Auto-rebalance to initial weights in January',
  '持有不动，权重随市场漂移': 'Hold and let weights drift with market',
  '计算中...': 'Calculating...',
  '运行回测': 'Run Backtest',
  '配置可视化': 'Allocation Visualization',
  '构建组合后自动运行回测': 'Backtest runs automatically after building portfolio',
  '资产相关性矩阵': 'Asset Correlation Matrix',
  '运行回测后显示': 'Shown after running backtest',

  // ── Backtest Results ──
  '回测结果': 'Backtest Results',
  '近1月': '1M',
  '近6月': '6M',
  '年初至今': 'YTD',
  '近1年': '1Y',
  '近5年': '5Y',
  '全部历史': 'All History',
  '总收益': 'Total Return',
  '年化收益': 'Annualized',
  '超额 α': 'Excess α',
  '终值': 'Final Value',
  '夏普': 'Sharpe',
  '最大回撤': 'Max Drawdown',
  '组合净值曲线': 'Portfolio NAV Curve',
  '组合': 'Portfolio',
  '个股贡献': 'Stock Contribution',
  '年度收益分布': 'Annual Return Distribution',
  '月度收益分布': 'Monthly Return Distribution',
  '年收益': 'Annual Return',
  '月收益': 'Monthly Return',
  'Underwater 曲线': 'Underwater Curve',
  '组合回撤': 'Portfolio Drawdown',
  '回撤': 'Drawdown',

  // ── Risk Metrics ──
  '风险指标': 'Risk Metrics',
  '卡玛比率': 'Calmar Ratio',
  '风险调整后收益': 'Risk-Adjusted Return',
  '索提诺比率': 'Sortino Ratio',
  '下行风险调整': 'Downside Risk Adjusted',
  '胜率': 'Win Rate',
  '年化波动率': 'Annualized Volatility',
  '最大回撤天数': 'Max DD Duration',
  '基准收益': 'Benchmark Return',
  '基准最大回撤': 'Benchmark Max DD',
  '负相关': 'Negative',
  '无相关': 'None',
  '正相关': 'Positive',

  // ── Stress Test ──
  '压力测试 · 极端场景模拟': 'Stress Test · Extreme Scenarios',
  'COVID-19 崩盘': 'COVID-19 Crash',
  '全球疫情引发流动性危机': 'Global pandemic triggered liquidity crisis',
  '2022 加息风暴': '2022 Rate Hike Storm',
  '美联储激进加息，成长股暴跌': 'Fed aggressive hikes crushed growth stocks',
  '2018 Q4 暴跌': '2018 Q4 Crash',
  '贸易战+加息预期恶化': 'Trade war + tightening expectations',
  '2008 金融危机': '2008 Financial Crisis',
  '雷曼倒闭引发全球金融海啸': 'Lehman collapse triggered global financial tsunami',

  // ── Position Management ──
  '仓位管理建议': 'Position Management',
  'Kelly 公式': 'Kelly Formula',
  '胜率 (p)': 'Win Rate (p)',
  '盈亏比 (b)': 'Profit/Loss Ratio (b)',
  'Full Kelly 仓位': 'Full Kelly Position',
  'Half Kelly (建议)': 'Half Kelly (Recommended)',
  'f* = (p×b − q) / b，Half Kelly 降低破产风险': 'f* = (p×b − q) / b, Half Kelly reduces ruin risk',
  '风险平价权重 vs 当前': 'Risk Parity vs Current',
  '按波动率倒数分配，使每个标的对组合风险贡献相等': 'Weighted by inverse volatility for equal risk contribution',

  // ── Backtest Disclaimer ──
  '回测偏差声明': 'Backtest Bias Disclaimer',
  '前视偏差': 'Look-Ahead Bias',
  '当前标的池基于今日可知信息选取，回测期间部分标的可能尚未上市或不在关注范围内': 'Current universe selected with today\'s info; some securities may not have existed during backtest',
  '生存者偏差': 'Survivorship Bias',
  '标的池不包含已退市或被收购的股票，可能高估策略表现': 'Universe excludes delisted/acquired stocks, may overestimate performance',
  '交易成本': 'Trading Cost',
  '复权处理': 'Adjustment Method',
  '使用 Yahoo Finance 后复权价格，分红再投资假设可能与实际不符': 'Uses Yahoo adjusted-close; dividend reinvestment may differ from reality',
  '过往表现不代表未来收益。回测结果仅供研究参考，不构成投资建议。': 'Past performance does not guarantee future results. For research only, not investment advice.',

  // ── Monitor Page ──
  '市场情绪指数': 'Market Sentiment Index',
  '极度贪婪': 'Extreme Greed',
  '贪婪': 'Greed',
  '中性偏贪': 'Neutral-Greedy',
  '恐惧': 'Fear',
  '极度恐惧': 'Extreme Fear',
  '关注板块表现 (今日)': 'Sector Performance (Today)',
  '板块-ETF 映射': 'Sector-ETF Mapping',
  '智能预警': 'Smart Alerts',
  '实时数据流': 'Real-time Feed',
  '评级': 'Rating',
  '技术': 'Technical',
  '新闻': 'News',
  '标的实时概览': 'Real-time Overview',
  '预警规则': 'Alert Rules',

  // ── Journal Page ──
  '新增看好标的': 'Add Watched Security',
  '搜索代码或名称 (如 AAPL, 腾讯)...': 'Search ticker or name (e.g., AAPL, TSLA)...',
  '投资论点 (为什么看好这个标的？)...': 'Investment Thesis (Why are you bullish?)...',
  '标签 (用逗号分隔, 如: AI, 半导体, 催化剂)': 'Tags (comma separated, e.g.: AI, Semis, Catalyst)',
  '获取价格...': 'Getting price...',
  '记录 (自动锚定当前价)': 'Record (Auto-lock price)',
  '投资论点': 'Investment Thesis',
  '自记录': 'Since Record',
  '锚定价格': 'Anchor Price',
  '当前价格': 'Current Price',
  '行业PE对标': 'Sector PE Comparison',
  '关联 ETF & 关键日期': 'Related ETF & Key Dates',
  '该板块暂无精确对应ETF': 'No exact ETF match for this sector',
  '关键日期追踪': 'Key Dates',
  '记录天数': 'Days Since Record',

  // ── Ticker Manager ──
  '添加失败': 'Add failed',
  '已删除': 'Removed',
  '删除失败': 'Remove failed',
  '添加中': 'Adding...',
  '数据来源': 'Data source',
  '标的管理': 'Securities Manager',
  'API 在线': 'API Online',
  'API 离线 — 使用静态数据': 'API Offline — Using static data',
  '搜索添加': 'Search & Add',
  '管理': 'Manage',
  '刷新全部': 'Refresh All',
  'API 服务未启动': 'API Service Not Started',
  '请在终端中运行以下命令启动后端：': 'Run the following command to start the backend:',
  '启动后即可搜索和添加任意股票/ETF': 'After starting, you can search and add any stock/ETF',
  '输入代码或名称搜索... (如 AAPL, TSLA, 0700.HK)': 'Search by ticker or name... (e.g., AAPL, TSLA, 0700.HK)',
  '搜索': 'Search',
  '搜索全球股票和 ETF': 'Search global stocks and ETFs',
  '支持美股 (AAPL, TSLA)、港股 (0700.HK, 9988.HK)': 'Supports US (AAPL, TSLA), HK (0700.HK, 9988.HK)',
  '支持 ETF (SPY, QQQ, ARKK) 和杠杆 ETF (TQQQ, SOXL)': 'Supports ETFs (SPY, QQQ, ARKK) and leveraged (TQQQ, SOXL)',
  '数据来源: Yahoo Finance API': 'Data source: Yahoo Finance API',

  // ── Header / Footer ──
  '综合量化投资平台 · 真实数据': 'Quantitative Investment Platform · Real Data',
  '真实数据': 'Real Data',
  '切换浅色': 'Light Mode',
  '切换深色': 'Dark Mode',
  '切换浅色模式': 'Switch to Light Mode',
  '切换深色模式': 'Switch to Dark Mode',
  '共': 'Total',

  // ── Dynamic Templates (use with params) ──
  '{n}个标的': '{n} securities',
  '共{n}个标的': '{n} securities total',
  '已选: {s}': 'Selected: {s}',
  '管理 ({n})': 'Manage ({n})',
  '确定删除 {ticker} 的投资记录？': 'Delete investment record for {ticker}?',
  '记录于 {date}': 'Recorded on {date}',
  '锚定 {currency}{price}': 'Anchored {currency}{price}',
  '{n}只 · Top3集中度 {pct}%': '{n} holdings · Top3 concentration {pct}%',
  '基于 {n} 个标的的真实价格历史 · 支持多时间维度': 'Based on {n} securities\' real price history · Multiple timeframes',
  '仅模拟固定手续费 ({bps} bps)，未含滑点和市场冲击成本': 'Simulates fixed fees only ({bps} bps), excludes slippage & market impact',
  '再平衡 {n} 次': 'Rebalanced {n} times',
  '最长回撤 {n} 天': 'Max drawdown duration {n} days',
  '组合 {pct}%': 'Portfolio {pct}%',

  // ── Sector names (for Monitor) ──
  '存储': 'Storage',
  '存储/NAND': 'Storage/NAND',
  '半导体/AI': 'Semiconductors/AI',
  '航天/国防': 'Aerospace/Defense',
  '银行/金融': 'Banking/Finance',

  // ── Monitor alert rules ──
  'RSI超买': 'RSI Overbought',
  '评分突变': 'Score Mutation',
  '排名变化': 'Rank Change',
  '波动磨损': 'Volatility Decay',
  '财报预警': 'Earnings Alert',

  // ── Backtest extra ──
  '权重': 'Weight',
  '基于组合 Beta ({beta}) × 波动率比率 × 历史基准跌幅估算，实际表现可能偏离': 'Estimated via portfolio Beta ({beta}) × volatility ratio × historical benchmark drawdown; actual results may differ',

  // ── Standalone mode messages ──
  '独立模式添加失败': 'Standalone add failed',
};

// ─── Language Context & Provider ────────────────────────────
export function LangProvider({ children }) {
  const [lang, setLangRaw] = useState(() => localStorage.getItem(LANG_KEY) || 'zh');

  const setLang = useCallback((l) => {
    setLangRaw(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  const t = useCallback((text, params) => {
    if (!text) return '';
    let result = lang === 'en' ? (EN[text] || text) : text;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replaceAll(`{${k}}`, String(v));
      });
    }
    return result;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
