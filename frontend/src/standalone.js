/**
 * QuantEdge Standalone Module
 * 纯前端独立运行：Yahoo Finance API (vite proxy / allorigins 代理) + localStorage
 * 无需后端服务器，适用于 GitHub Pages 部署
 */

import { withCache, withStockDataCache } from "./lib/priceCache.js";

// 多代理链：Vercel 自建代理（同源/不被墙）→ 第三方代理（备选）
// 顺序按实测可靠性 + 中国大陆可用性排列
const CORS_PROXIES = [
  // 主：Vercel serverless function 代理（部署后 /api/yahoo 同源调用）
  { name: "vercel-self", build: (url) => {
    const u = new URL(url);
    const host = u.hostname.includes("query2") ? "query2" : "query1";
    return `/api/yahoo?host=${host}&path=${encodeURIComponent(u.pathname + u.search)}`;
  }, parse: (text) => JSON.parse(text) },
  // 备选：第三方公共 CORS 代理
  { name: "corsproxy.io", build: (url) => "https://corsproxy.io/?" + encodeURIComponent(url), parse: (text) => JSON.parse(text) },
  { name: "allorigins-raw", build: (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url), parse: (text) => JSON.parse(text) },
  { name: "allorigins", build: (url) => "https://api.allorigins.win/get?url=" + encodeURIComponent(url), parse: (text) => { const json = JSON.parse(text); if (!json.contents) throw new Error("Empty contents"); return JSON.parse(json.contents); } },
];
// 记录每个代理的最近失败次数，用于临时降权（内存级，刷新失效）
const _proxyFailCount = new Map();
const PROXY_FAIL_THRESHOLD = 3;
const CACHE_KEY = "quantedge_standalone_stocks";

// ─── 请求限流（避免 Yahoo 频率墙 / allorigins 被限）──────────
// 最大并发 + 同 URL 去重 + 最小启动间隔
const RL_MAX_CONCURRENT = 4;
const RL_MIN_GAP_MS = 60; // 每次启动之间的最小间隔
const _rlQueue = [];
let _rlActive = 0;
let _rlLastStart = 0;
const _rlInflight = new Map(); // url → Promise（短期去重）
function _rlKick() {
  while (_rlActive < RL_MAX_CONCURRENT && _rlQueue.length > 0) {
    const now = Date.now();
    const wait = Math.max(0, _rlLastStart + RL_MIN_GAP_MS - now);
    if (wait > 0) { setTimeout(_rlKick, wait); return; }
    const job = _rlQueue.shift();
    _rlActive++;
    _rlLastStart = Date.now();
    Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => {
      _rlActive--;
      _rlKick();
    });
  }
}
function rateLimit(fn) {
  return new Promise((resolve, reject) => {
    _rlQueue.push({ fn, resolve, reject });
    _rlKick();
  });
}
function rateLimitDedup(key, fn) {
  if (_rlInflight.has(key)) return _rlInflight.get(key);
  const p = rateLimit(fn).finally(() => {
    // 保留 200ms 让并发请求合并，之后清除
    setTimeout(() => _rlInflight.delete(key), 200);
  });
  _rlInflight.set(key, p);
  return p;
}

// ─── Yahoo Finance Crumb 认证 ──────────────────────────────
// Yahoo v10/quoteSummary 需要 crumb + cookie 认证
let _crumb = null;
let _crumbAt = 0;
let _crumbPromise = null;
const CRUMB_TTL = 20 * 60 * 1000; // 20 分钟

async function ensureYahooCrumb() {
  if (_crumb && Date.now() - _crumbAt < CRUMB_TTL) return _crumb;
  if (_crumbPromise) return _crumbPromise; // 防止并发重复请求
  _crumbPromise = (async () => {
    try {
      // 1. 触发 consent 页面获取初始 cookies（vite proxy 服务端自动捕获）
      await fetch('/yahoo-consent', { signal: AbortSignal.timeout(5000) }).catch(() => {});
      // 2. 获取 crumb（使用 step 1 的 cookies）
      const res = await fetch('/yahoo-api/v1/test/getcrumb', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length < 60 && !text.includes('<')) {
          _crumb = text;
          _crumbAt = Date.now();
          console.log('[QuantEdge] Yahoo crumb obtained');
          return _crumb;
        }
      }
    } catch (e) {
      console.warn('[QuantEdge] Crumb fetch failed:', e.message);
    }
    return null;
  })();
  const result = await _crumbPromise;
  _crumbPromise = null;
  return result;
}

// ─── Yahoo Finance 请求（vite proxy → 多个 CORS 代理链式降级）──────
async function _yahooFetchRaw(url, timeout) {
  const path = url
    .replace("https://query1.finance.yahoo.com", "")
    .replace("https://query2.finance.yahoo.com", "");
  // 优先 vite dev proxy（服务端维护 cookie 会话，仅本地 dev 可用）
  // 生产环境 /yahoo-api 会被 SPA fallback 返回 HTML，故检查 content-type
  try {
    const localRes = await fetch(`/yahoo-api${path}`, { signal: AbortSignal.timeout(Math.min(timeout, 5000)) });
    const ct = localRes.headers.get('content-type') || '';
    if (localRes.ok && ct.includes('application/json')) return await localRes.json();
  } catch { /* vite proxy unavailable — fall through */ }
  // 按可靠性顺序尝试 CORS 代理，失败则切下一个
  const proxies = [...CORS_PROXIES].sort((a, b) => (_proxyFailCount.get(a.name) || 0) - (_proxyFailCount.get(b.name) || 0));
  let lastErr;
  for (const proxy of proxies) {
    try {
      const proxyUrl = proxy.build(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = proxy.parse(text);
      // 成功：重置失败计数
      _proxyFailCount.set(proxy.name, 0);
      return data;
    } catch (e) {
      lastErr = e;
      _proxyFailCount.set(proxy.name, (_proxyFailCount.get(proxy.name) || 0) + 1);
    }
  }
  throw lastErr || new Error("All CORS proxies failed");
}
async function yahooFetch(url, timeout = 12000) {
  return rateLimitDedup(`fetch:${url}`, () => _yahooFetchRaw(url, timeout));
}

// ─── 中文股票名称映射 ──────────────────────────────────────
export const STOCK_CN_NAMES = {
  // ── 半导体 ──
  NVDA: "英伟达", AMD: "超威半导体", AVGO: "博通", QCOM: "高通", TXN: "德州仪器",
  AMAT: "应用材料", LRCX: "拉姆研究", KLAC: "科磊", MRVL: "美满电子", NXPI: "恩智浦",
  ADI: "亚德诺", MCHP: "微芯科技", ON: "安森美", GFS: "格芯", MU: "美光科技",
  ASML: "阿斯麦", SNPS: "新思科技", CDNS: "楷登电子", ARM: "ARM控股",
  SMCI: "超微电脑", DRAM: "信韵存储ETF", SNDK: "西部数据",
  // ── 软件 & 云计算 ──
  MSFT: "微软", ADBE: "Adobe", INTU: "财捷", CRM: "赛富时",
  PANW: "派拓网络", CRWD: "CrowdStrike", ZS: "Zscaler", FTNT: "飞塔网络",
  WDAY: "Workday", TEAM: "Atlassian", DDOG: "Datadog", MDB: "MongoDB",
  SPLK: "Splunk", ROP: "罗珀科技", ADP: "自动数据处理", PAYX: "Paychex",
  VRSK: "韦里斯克", ANSS: "ANSYS", CPRT: "科帕特", PLTR: "帕兰提尔", MSTR: "微策略",
  // ── 互联网 & 平台 ──
  GOOGL: "谷歌", GOOG: "谷歌", META: "Meta", AMZN: "亚马逊", NFLX: "奈飞",
  BKNG: "缤客", ABNB: "爱彼迎", MELI: "美客多", PYPL: "PayPal",
  DASH: "DoorDash", TTD: "交易柜台", COIN: "Coinbase", RDDT: "Reddit",
  HOOD: "Robinhood", APP: "AppLovin",
  // ── 硬件 & 汽车 ──
  AAPL: "苹果", TSLA: "特斯拉",
  // ── 通信 ──
  TMUS: "T-Mobile美国", CSCO: "思科",
  // ── 医疗健康 ──
  ISRG: "直觉外科", AMGN: "安进", GILD: "吉利德", VRTX: "福泰制药",
  REGN: "再生元", BIIB: "百健", ILMN: "因美纳", DXCM: "德康医疗",
  IDXX: "爱德士", AZN: "阿斯利康", GEHC: "通用医疗",
  // ── 消费 ──
  COST: "好市多", SBUX: "星巴克", MAR: "万豪国际", ORLY: "奥莱利汽配",
  ROST: "罗斯百货", LULU: "露露柠檬", DLTR: "达乐树",
  PEP: "百事可乐", MDLZ: "亿滋国际", KHC: "卡夫亨氏", MNST: "怪物饮料", WMT: "沃尔玛",
  KO: "可口可乐", PG: "宝洁", JNJ: "强生",
  // ── 半导体（补充）──
  TSM: "台积电",
  // ── 航天（补充）──
  LUNR: "直觉机器",
  // ── 债券 ETF ──
  TLT: "20+年美债ETF",
  // ── 工业 ──
  CTAS: "信达思", FAST: "快扣", PCAR: "帕卡", ODFL: "欧德物流",
  CTSH: "高知特", CDW: "CDW",
  // ── 能源 & 公用事业 ──
  CEG: "星座能源", FANG: "钻石背能源", BKR: "贝克休斯",
  AEP: "美国电力", XEL: "埃克塞尔能源", EXC: "爱克斯龙",
  // ── 其他 ──
  CCEP: "可口可乐欧洲", SIRI: "SiriusXM", EA: "艺电", WBD: "华纳探索", LIN: "林德",
  RKLB: "火箭实验室", LITE: "光迅科技", AAOI: "应用光电",
  // ── ETF ──
  QQQ: "纳指100ETF", SPY: "标普500ETF", IWM: "罗素2000ETF",
  IGV: "软件ETF", SMH: "半导体ETF", MARS: "航天ETF", UFO: "航天ETF",
  EWY: "韩国ETF", IYZ: "通信ETF", TQQQ: "纳指3倍多",
  ARKK: "方舟创新ETF", CWEB: "中概互联ETF", YINN: "中国3倍多",
  UGL: "黄金2倍多", SCO: "原油2倍空", KORU: "韩国3倍多",
  BABX: "债券ETF", SOXL: "半导体3倍多", SOXS: "半导体3倍空",
  RKLX: "火箭实验室2倍多", SNXX: "西部数据2倍多",
  // ── 港股（已有） ──
  "00005.HK": "汇丰控股", "00700.HK": "腾讯控股",
  "09988.HK": "阿里巴巴", "01276.HK": "恒瑞医药",
  "03486.HK": "亚洲半导体ETF", "07552.HK": "恒科反向2倍ETF",
  "07747.HK": "三星电子杠杆2倍", "03986.HK": "兆易创新",
  "07234.HK": "创业板杠杆2倍ETF", "07200.HK": "恒指杠杆2倍ETF",
  "07299.HK": "黄金期货杠杆2倍ETF", "07709.HK": "海力士杠杆2倍ETF",
  // ── 恒生科技指数成分股 ──
  "03690.HK": "美团", "09999.HK": "网易", "09618.HK": "京东集团",
  "01024.HK": "快手", "09888.HK": "百度", "00981.HK": "中芯国际",
  "09626.HK": "哔哩哔哩", "01810.HK": "小米集团", "02382.HK": "舜宇光学",
  "09961.HK": "携程集团", "01347.HK": "华虹半导体", "02015.HK": "理想汽车",
  "09868.HK": "小鹏汽车", "06690.HK": "海尔智家", "01211.HK": "比亚迪",
  "02269.HK": "药明生物", "00268.HK": "金蝶国际", "00241.HK": "阿里健康",
  // ── 恒生指数成分股 ──
  "00941.HK": "中国移动", "01299.HK": "友邦保险", "00388.HK": "香港交易所",
  "02318.HK": "中国平安", "00939.HK": "建设银行", "01398.HK": "工商银行",
  "03988.HK": "中国银行", "03968.HK": "招商银行", "00883.HK": "中海油",
  "02628.HK": "中国人寿", "00027.HK": "银河娱乐", "02020.HK": "安踏体育",
  "00175.HK": "吉利汽车", "00066.HK": "港铁公司", "09633.HK": "农夫山泉",
  "00016.HK": "新鸿基地产", "02388.HK": "中银香港",
};

// ─── 中文公司简介映射 ──────────────────────────────────────
export const STOCK_CN_DESCS = {
  // ── 半导体 ──
  NVDA: "全球领先的GPU和AI芯片设计公司，产品广泛用于数据中心、游戏、自动驾驶和AI训练推理。",
  AMD: "设计和销售高性能CPU、GPU及数据中心加速芯片，是英特尔和英伟达的主要竞争对手。",
  AVGO: "全球领先的半导体和基础设施软件公司，产品覆盖网络、存储、无线通信和企业软件。",
  QCOM: "移动通信芯片巨头，设计骁龙系列处理器并拥有大量无线通信专利授权业务。",
  TXN: "全球最大的模拟芯片制造商之一，产品广泛应用于工业、汽车和消费电子领域。",
  AMAT: "全球最大的半导体设备制造商之一，为芯片制造提供薄膜沉积、刻蚀和检测设备。",
  LRCX: "半导体设备公司，专注于晶圆加工中的刻蚀和沉积设备，服务于先进制程芯片制造。",
  KLAC: "半导体设备和良率管理方案提供商，专注于晶圆检测和量测设备。",
  MRVL: "设计数据中心、企业网络和运营商基础设施所用的半导体解决方案。",
  NXPI: "汽车和物联网半导体龙头，产品用于车载系统、安全支付和智能连接。",
  ADI: "高性能模拟、混合信号和数字信号处理芯片设计公司，服务工业和汽车市场。",
  MCHP: "设计和制造微控制器、模拟芯片和闪存产品，广泛用于嵌入式控制系统。",
  ON: "功率半导体和传感器芯片供应商，产品聚焦汽车电动化和新能源应用。",
  GFS: "全球第三大晶圆代工厂，提供成熟制程芯片制造服务，总部位于美国。",
  MU: "全球领先的存储芯片制造商，生产DRAM和NAND闪存，服务数据中心和移动设备。",
  ASML: "全球唯一的EUV光刻机制造商，掌握最先进的半导体制造核心设备技术。",
  SNPS: "EDA（电子设计自动化）软件龙头，为芯片设计提供仿真、验证和IP核工具。",
  CDNS: "EDA软件和IP核供应商，帮助工程师设计和验证复杂的集成电路和系统。",
  ARM: "全球最广泛使用的芯片架构设计公司，其指令集应用于绝大多数智能手机处理器。",
  SMCI: "高性能服务器和存储解决方案提供商，专注于AI和数据中心基础设施。",
  DRAM: "跟踪亚洲半导体和存储芯片行业表现的交易所交易基金。",
  SNDK: "西部数据旗下闪存品牌，生产SSD固态硬盘、存储卡和U盘等消费级和企业级存储产品。",
  // ── 软件 & 云计算 ──
  MSFT: "全球最大的软件公司，拥有Windows、Office、Azure云计算和AI助手Copilot等核心产品。",
  ADBE: "创意和文档软件巨头，旗下拥有Photoshop、Illustrator、Acrobat等行业标准工具。",
  INTU: "财务软件公司，旗下TurboTax、QuickBooks和Mailchimp服务中小企业和个人用户。",
  CRM: "全球最大的CRM（客户关系管理）云平台，帮助企业管理销售、服务和营销流程。",
  PANW: "全球领先的网络安全公司，提供防火墙、云安全和AI驱动的威胁检测解决方案。",
  CRWD: "云原生端点安全平台，利用AI技术提供实时威胁检测和响应服务。",
  ZS: "云安全公司，提供零信任网络访问平台，帮助企业安全连接用户和应用。",
  FTNT: "网络安全公司，以FortiGate防火墙和安全织网架构著称，服务全球企业客户。",
  WDAY: "企业级人力资源和财务管理云平台，帮助大型企业管理人事和财务流程。",
  TEAM: "协作软件公司，旗下Jira和Confluence是软件开发团队的核心工具。",
  DDOG: "云监控和安全分析平台，帮助企业实时监控应用性能、日志和基础设施。",
  MDB: "NoSQL数据库公司，MongoDB是全球最流行的文档型数据库之一。",
  SPLK: "机器数据分析和安全信息平台，帮助企业从日志和事件数据中获取运营洞察。",
  ROP: "工业技术集团，通过收购策略构建了多元化的垂直软件和技术产品组合。",
  ADP: "全球最大的薪资和人力资源外包服务商，为企业提供工资单和人事管理方案。",
  PAYX: "薪资处理和人力资源服务公司，主要服务中小型企业客户。",
  VRSK: "数据分析和风险评估公司，为保险、金融和能源行业提供决策支持工具。",
  ANSS: "工程仿真软件公司，产品用于航空航天、汽车和电子产品的虚拟测试。",
  CPRT: "全球最大的在线车辆拍卖平台，专注于事故车和保险回收车辆。",
  PLTR: "大数据分析和AI平台公司，为政府和企业提供数据整合与智能决策方案。",
  MSTR: "企业分析软件公司，同时是全球持有比特币最多的上市公司之一。",
  // ── 互联网 & 平台 ──
  GOOGL: "全球最大的搜索引擎和在线广告公司，旗下拥有Google搜索、YouTube、Android和云计算业务。",
  GOOG: "Alphabet C类股票，与GOOGL为同一公司（谷歌母公司），但无投票权。",
  META: "全球最大的社交媒体公司，旗下拥有Facebook、Instagram、WhatsApp和元宇宙平台。",
  AMZN: "全球最大的电商平台和云计算服务商，AWS是全球领先的云基础设施平台。",
  NFLX: "全球最大的流媒体平台，提供电影、剧集等原创和授权内容的订阅服务。",
  BKNG: "全球最大的在线旅游预订平台，旗下拥有Booking.com、Priceline等品牌。",
  ABNB: "全球最大的短租民宿平台，连接房东和旅客，覆盖全球220多个国家和地区。",
  MELI: "拉丁美洲最大的电商和金融科技平台，覆盖巴西、阿根廷和墨西哥等主要市场。",
  PYPL: "全球领先的数字支付平台，提供在线支付、转账和商家收款服务。",
  DASH: "美国领先的本地即时配送平台，提供餐饮外卖和日用品配送服务。",
  TTD: "程序化广告技术平台，帮助广告主通过AI在多渠道精准投放数字广告。",
  COIN: "美国最大的合规加密货币交易平台，提供比特币、以太坊等数字资产交易服务。",
  RDDT: "全球最大的社区论坛平台，用户在各主题板块分享内容和讨论。",
  HOOD: "免佣金股票和加密货币交易平台，以简洁的移动端体验著称。",
  APP: "移动广告和应用变现平台，利用AI技术帮助应用开发者获客和提升收入。",
  // ── 硬件 & 汽车 ──
  AAPL: "全球市值最大的科技公司，设计和销售iPhone、Mac、iPad等消费电子产品及服务生态。",
  TSLA: "全球领先的电动汽车和清洁能源公司，同时涉足自动驾驶、储能和AI机器人。",
  // ── 通信 ──
  TMUS: "美国第二大无线运营商，以5G网络覆盖和价格竞争力著称。",
  CSCO: "全球最大的网络设备制造商，提供路由器、交换机和网络安全产品。",
  // ── 医疗健康 ──
  ISRG: "手术机器人龙头，其达芬奇系统广泛应用于微创手术，全球装机量领先。",
  AMGN: "全球最大的生物技术公司之一，专注于肿瘤、心血管和骨科领域的创新药物。",
  GILD: "生物制药公司，在抗病毒药物领域处于领先地位，乙肝和HIV治疗药物全球领先。",
  VRTX: "专注于囊性纤维化等罕见病治疗的生物制药公司，拥有该领域垄断性药物组合。",
  REGN: "生物制药公司，以抗体药物技术平台著称，产品覆盖眼科和免疫炎症领域。",
  BIIB: "专注于神经科学的生物技术公司，开发治疗阿尔茨海默症和多发性硬化症的药物。",
  ILMN: "基因测序设备和试剂的全球领导者，其平台产生了全球约80%的基因组数据。",
  DXCM: "连续血糖监测设备制造商，帮助糖尿病患者实时追踪血糖水平。",
  IDXX: "宠物诊断检测设备和服务的全球领导者，产品覆盖兽医诊所和实验室。",
  AZN: "全球领先的制药公司，专注于肿瘤、心血管和呼吸领域的创新药物研发。",
  GEHC: "通用电气旗下医疗科技公司，提供医学影像、超声和患者监护设备。",
  // ── 消费 ──
  COST: "全球最大的会员制仓储超市，以低价大包装商品和高会员续费率著称。",
  SBUX: "全球最大的连锁咖啡品牌，在全球运营超过3.5万家门店。",
  MAR: "全球最大的酒店集团，旗下拥有万豪、喜来登、丽思卡尔顿等30多个酒店品牌。",
  ORLY: "美国领先的汽车零部件零售商，专注于售后维修配件市场。",
  ROST: "美国折扣服装零售连锁，以低于百货公司的价格销售品牌服饰。",
  LULU: "高端运动休闲服饰品牌，以瑜伽裤等产品著称，定位运动时尚生活方式。",
  DLTR: "美国折扣零售连锁，以低价日用品和家居用品服务价格敏感型消费者。",
  PEP: "全球第二大食品饮料公司，旗下拥有百事可乐、乐事薯片和桂格等品牌。",
  MDLZ: "全球零食巨头，旗下拥有奥利奥、吉百利、妙卡等知名品牌。",
  KHC: "北美食品巨头，旗下拥有亨氏番茄酱、卡夫芝士和Oscar Mayer等品牌。",
  MNST: "能量饮料公司，Monster能量饮料是全球最畅销的功能饮料之一。",
  WMT: "全球最大的零售企业，在美国和全球运营超过1万家实体门店及电商平台。",
  // ── 工业 ──
  CTAS: "企业制服和工作场所服务提供商，为各行业客户提供工装租赁和清洁服务。",
  FAST: "工业紧固件和安全用品分销商，通过自动售货机和门店网络服务制造业客户。",
  PCAR: "卡车制造商，旗下Peterbilt和Kenworth是北美重卡行业的领先品牌。",
  ODFL: "美国领先的零担货运公司，以高服务质量和运营效率在行业中著称。",
  CTSH: "全球IT服务和咨询公司，为企业提供数字化转型、云计算和软件开发服务。",
  CDW: "美国领先的IT解决方案分销商，为企业和政府客户提供硬件、软件和服务。",
  // ── 能源 & 公用事业 ──
  CEG: "美国最大的无碳能源发电商，运营全美最大的核电站机组群。",
  FANG: "Permian盆地领先的石油天然气勘探开发公司，以高效低成本著称。",
  BKR: "全球领先的油田服务和设备公司，为石油天然气行业提供钻井和技术服务。",
  AEP: "美国大型电力公用事业公司，为11个州的超过500万客户提供电力服务。",
  XEL: "美国清洁能源领先的公用事业公司，大力投资风电和太阳能发电。",
  EXC: "美国最大的公用事业控股公司之一，运营发电和配电业务。",
  // ── 其他 ──
  CCEP: "可口可乐在西欧的装瓶和分销合作伙伴，覆盖英国、法国和德国等市场。",
  SIRI: "北美卫星广播和音频流媒体公司，提供音乐、体育和新闻订阅内容。",
  EA: "全球领先的电子游戏发行商，旗下拥有FIFA/EA Sports FC、Apex Legends等知名游戏。",
  WBD: "全球娱乐传媒公司，旗下拥有HBO、CNN、Discovery等内容品牌和流媒体平台。",
  LIN: "全球最大的工业气体公司，为制造业、医疗和电子行业供应氧气、氮气等工业气体。",
  RKLB: "商业航天公司，研发和运营Electron小型运载火箭，提供卫星发射和太空系统服务。",
  LITE: "光通信器件制造商，为数据中心和电信网络提供激光器和光收发模块。",
  AAOI: "光通信技术公司，设计和制造用于数据中心互联的高速光收发器。",
  // ── ETF ──
  QQQ: "跟踪纳斯达克100指数的ETF，覆盖美国最大的100家非金融科技公司。",
  SPY: "跟踪标普500指数的ETF，是全球规模最大、流动性最强的股票型基金。",
  IWM: "跟踪罗素2000小盘股指数的ETF，反映美国小市值公司的整体表现。",
  IGV: "跟踪北美软件行业的ETF，持仓包括微软、Adobe、CRM等软件龙头。",
  SMH: "跟踪半导体行业的ETF，涵盖英伟达、台积电、ASML等全球芯片巨头。",
  MARS: "主动管理型航天主题ETF，投资于太空探索、卫星和航天技术公司。",
  UFO: "跟踪全球航天和太空经济公司的ETF。",
  EWY: "跟踪韩国股市的ETF，主要持仓为三星电子、SK海力士等韩国蓝筹股。",
  IYZ: "跟踪美国通信行业的ETF，覆盖电信运营商和通信设备公司。",
  TQQQ: "纳斯达克100指数的3倍杠杆ETF，适合短线交易，波动极大。",
  ARKK: "方舟投资旗下主动管理创新主题ETF，聚焦颠覆性科技和生物技术公司。",
  CWEB: "跟踪中国互联网公司的2倍杠杆ETF，持仓包括腾讯、阿里巴巴、美团等。",
  YINN: "中国大盘股3倍杠杆ETF，跟踪富时中国50指数的日度表现。",
  UGL: "黄金价格2倍杠杆ETF，追踪黄金现货价格的两倍日度收益。",
  SCO: "原油价格2倍反向ETF，适合看空原油价格时使用。",
  KORU: "韩国股市3倍杠杆ETF，跟踪MSCI韩国指数的日度表现。",
  BABX: "跟踪中国国债和政策性金融债的ETF。",
  SOXL: "半导体行业3倍杠杆ETF，波动极大，适合短线方向性交易。",
  SOXS: "半导体行业3倍反向ETF，适合看空半导体板块时使用。",
  RKLX: "Rocket Lab（火箭实验室）每日2倍杠杆ETF，跟踪RKLB股价的两倍日度表现。",
  SNXX: "西部数据（SNDK）每日2倍杠杆ETF，跟踪SNDK股价的两倍日度表现。",
  // ── 港股（已有） ──
  "00005.HK": "汇丰控股是全球最大的银行和金融服务机构之一，总部位于伦敦，业务遍及全球60多个国家。",
  "00700.HK": "中国最大的互联网公司之一，旗下拥有微信、QQ社交平台，以及游戏、云计算和金融科技业务。",
  "09988.HK": "中国最大的电商平台，旗下拥有淘宝、天猫和国际站，同时经营阿里云和蚂蚁金服。",
  "01276.HK": "中国领先的创新药企业，专注于抗肿瘤、麻醉和自身免疫领域的药物研发和销售。",
  "03486.HK": "跟踪亚洲半导体精选指数的ETF，覆盖中国大陆、韩国和中国台湾的芯片企业。",
  "07552.HK": "恒生科技指数每日反向（-2倍）产品，适合看空港股科技板块时使用。",
  "07747.HK": "三星电子每日2倍杠杆产品，跟踪三星电子股票的两倍日度表现。",
  "03986.HK": "中国领先的存储芯片和微控制器设计公司，产品涵盖NOR Flash和32位MCU。",
  "07234.HK": "深圳创业板指数每日2倍杠杆产品，适合看多中国科创板块时使用。",
  "07200.HK": "恒生指数每日2倍杠杆产品，适合看多港股蓝筹时使用。",
  "07299.HK": "黄金期货每日2倍杠杆产品，跟踪伦敦金价的两倍日度表现。",
  "07709.HK": "SK海力士每日2倍杠杆产品，跟踪韩国存储芯片巨头SK海力士的股价表现。",
  // ── 恒生科技指数成分股 ──
  "03690.HK": "中国最大的本地生活服务平台，提供外卖、到店、酒旅和社区团购等业务。",
  "09999.HK": "中国领先的互联网科技公司，核心业务包括网络游戏、音乐和在线教育。",
  "09618.HK": "中国第二大电商平台，以自营模式和物流网络著称，同时拓展即时零售业务。",
  "01024.HK": "中国领先的短视频社交平台，快手App月活跃用户超过6亿。",
  "09888.HK": "中国最大的搜索引擎公司，同时大力投入AI大模型和自动驾驶技术。",
  "00981.HK": "中国大陆技术最先进的晶圆代工企业，提供14nm及以上制程的芯片制造服务。",
  "09626.HK": "中国领先的年轻人文化社区和视频平台，以弹幕互动和ACG内容著称。",
  "01810.HK": "中国消费电子和智能家居生态龙头，产品涵盖手机、IoT设备和互联网服务。",
  "02382.HK": "全球领先的光学镜头和光电产品制造商，广泛应用于手机摄像头和车载光学。",
  "09961.HK": "中国最大的在线旅游平台，提供酒店预订、机票和旅游度假产品服务。",
  "01347.HK": "中国第二大晶圆代工企业，专注于功率器件和嵌入式存储等特色工艺。",
  "02015.HK": "中国领先的新能源汽车公司，以增程式电动SUV和纯电车型为主打产品。",
  "09868.HK": "中国新能源汽车公司，专注于智能电动汽车的研发、制造和销售。",
  "06690.HK": "中国家电行业龙头，旗下拥有海尔、卡萨帝和GE Appliances等品牌。",
  "01211.HK": "全球最大的新能源汽车制造商，同时是动力电池和光伏领域的领先企业。",
  "02269.HK": "全球领先的生物药CDMO企业，为制药公司提供生物制剂的合同研发和生产服务。",
  "00268.HK": "中国领先的企业管理云服务商，提供ERP、财务和人力资源等SaaS产品。",
  "00241.HK": "阿里巴巴旗下医疗健康平台，提供在线医药零售和互联网医疗服务。",
  // ── 恒生指数成分股 ──
  "00941.HK": "中国最大的电信运营商，拥有全球最多的移动用户数，同时运营云计算和数据中心业务。",
  "01299.HK": "亚太地区最大的独立上市人寿保险集团，业务覆盖18个市场。",
  "00388.HK": "香港交易及结算所有限公司，运营香港股票、期货和商品交易市场。",
  "02318.HK": "中国最大的综合金融服务集团之一，业务涵盖保险、银行、投资和科技。",
  "00939.HK": "中国四大国有商业银行之一，资产规模全球前列，网点遍及全国。",
  "01398.HK": "全球资产规模最大的商业银行，中国四大国有银行之首。",
  "03988.HK": "中国四大国有银行之一，也是中国国际化程度最高的商业银行。",
  "03968.HK": "中国领先的零售银行，以金融科技和财富管理能力著称，被誉为'零售之王'。",
  "00883.HK": "中国最大的海上油气生产商，在全球多个海域开展油气勘探和开发业务。",
  "02628.HK": "中国最大的人寿保险公司，拥有庞大的销售网络和客户群体。",
  "00027.HK": "澳门领先的博彩和娱乐度假村运营商，旗下拥有银河综合度假城等物业。",
  "02020.HK": "中国领先的体育用品集团，旗下拥有安踏、FILA和始祖鸟等多个运动品牌。",
  "00175.HK": "中国领先的民营汽车制造商，产品涵盖燃油车和新能源汽车，旗下拥有极氪品牌。",
  "00066.HK": "香港铁路有限公司，运营香港地铁和轻铁系统，同时在全球多个城市经营铁路。",
  "09633.HK": "中国最大的包装饮用水和饮料公司，旗下农夫山泉和东方树叶是知名品牌。",
  "00016.HK": "香港最大的地产发展商之一，业务涵盖住宅、商业地产和酒店。",
  "02388.HK": "中国银行在香港的全资子公司，是香港主要的发钞银行和商业银行之一。",
};

/** 通过 vite dev proxy 或 allorigins 获取 Yahoo Finance chart 数据 */
async function _yahooChartFetchRaw(path, timeout) {
  // 1. 优先 vite dev proxy（本地开发无 CORS 问题）
  // 生产环境 /yahoo-api 会被 SPA fallback 返回 HTML，故检查 content-type
  try {
    const res = await fetch(`/yahoo-api${path}`, { signal: AbortSignal.timeout(timeout) });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return await res.json();
  } catch { /* vite proxy 不可用，降级 */ }
  // 2. 降级 CORS 代理链（vercel-self → 第三方）
  //    直接调 _yahooFetchRaw，绕开 yahooFetch 的 rateLimit —— 当前已在 chart: 槽位内，
  //    再申请 fetch: 槽位会与外层互锁（两者共享同一个 4 并发队列）
  return await _yahooFetchRaw(`https://query1.finance.yahoo.com${path}`, timeout);
}
async function yahooChartFetch(path, timeout = 12000) {
  return rateLimitDedup(`chart:${path}`, () => _yahooChartFetchRaw(path, timeout));
}

// ─── 行业分类：英文→中文映射 + 个股行业兜底表 ────────────
const SECTOR_EN_TO_CN = {
  Technology: "科技", "Consumer Cyclical": "消费/周期",
  "Consumer Defensive": "消费/必需品", "Financial Services": "金融",
  Healthcare: "医疗健康", Industrials: "工业", Energy: "能源",
  "Basic Materials": "基础材料", "Communication Services": "通信服务",
  "Real Estate": "房地产", Utilities: "公用事业",
};

// 个股行业映射（GICS 标准分类，中文）— 当 Yahoo Finance API 未返回行业时使用
const TICKER_SECTOR_MAP = {
  // ── 半导体 ──
  NVDA: "半导体", AMD: "半导体", AVGO: "半导体", QCOM: "半导体", TXN: "半导体",
  AMAT: "半导体", LRCX: "半导体", KLAC: "半导体", MRVL: "半导体", NXPI: "半导体",
  ADI: "半导体", MCHP: "半导体", ON: "半导体", GFS: "半导体", MU: "半导体",
  ASML: "半导体", SNPS: "半导体/EDA", CDNS: "半导体/EDA", ARM: "半导体",
  SMCI: "半导体/服务器", SOXL: "半导体/杠杆", SOXS: "半导体/反向",
  DRAM: "存储/ETF", SNDK: "存储/NAND",

  // ── 软件 & 云计算 ──
  MSFT: "软件/云计算", ADBE: "软件/创意", INTU: "软件/财务",
  CRM: "软件/CRM", PANW: "软件/网络安全", CRWD: "软件/网络安全",
  ZS: "软件/网络安全", FTNT: "软件/网络安全", WDAY: "软件/HR",
  SNPS: "半导体/EDA", TEAM: "软件/协作", DDOG: "软件/可观测性",
  MDB: "软件/数据库", SPLK: "软件/数据分析", ROP: "软件/工业",
  ADP: "软件/人力资源", PAYX: "软件/人力资源", VRSK: "软件/数据分析",
  ANSS: "软件/仿真", CPRT: "软件/拍卖",

  // ── 互联网 & 平台 ──
  GOOGL: "互联网/搜索", GOOG: "互联网/搜索", META: "互联网/社交",
  AMZN: "电商/云计算", NFLX: "互联网/流媒体", BKNG: "互联网/旅游",
  ABNB: "互联网/旅游", MELI: "电商/拉美", PYPL: "互联网/支付",
  DASH: "互联网/外卖", TTD: "互联网/广告", COIN: "互联网/加密货币",
  RDDT: "互联网/社区", HOOD: "互联网/券商", PLTR: "软件/大数据",
  APP: "互联网/移动广告", MSTR: "软件/比特币",

  // ── 硬件 & 消费电子 ──
  AAPL: "科技/消费电子", TSLA: "汽车/新能源",

  // ── 通信 ──
  TMUS: "通信/运营商", CSCO: "通信/网络设备",

  // ── 医疗健康 ──
  ISRG: "医疗/器械", AMGN: "医疗/生物科技", GILD: "医疗/生物科技",
  VRTX: "医疗/生物科技", REGN: "医疗/生物科技", BIIB: "医疗/生物科技",
  ILMN: "医疗/基因测序", DXCM: "医疗/器械", IDXX: "医疗/诊断",
  AZN: "医疗/制药", GEHC: "医疗/器械",

  // ── 消费/周期 ──
  COST: "零售/会员仓储", SBUX: "餐饮/咖啡", MAR: "酒店/旅游",
  ORLY: "零售/汽配", ROST: "零售/折扣", LULU: "零售/运动服饰",
  DLTR: "零售/折扣",

  // ── 消费/必需品 ──
  PEP: "消费/饮料", MDLZ: "消费/食品", KHC: "消费/食品",
  MNST: "消费/饮料", WMT: "零售/综合",

  // ── 工业 ──
  CTAS: "工业/制服租赁", FAST: "工业/紧固件", PCAR: "工业/重卡",
  ODFL: "工业/物流", CTSH: "科技/IT服务", CDW: "科技/IT分销",
  CEG: "能源/核电",

  // ── 能源 ──
  FANG: "能源/油气", BKR: "能源/油服",

  // ── 公用事业 ──
  AEP: "公用事业/电力", XEL: "公用事业/电力", EXC: "公用事业/电力",

  // ── 食品饮料 ──
  CCEP: "消费/饮料分销",

  // ── 金融 ──
  SIRI: "传媒/广播",

  // ── 娱乐 ──
  EA: "娱乐/游戏", WBD: "传媒/流媒体", LIN: "基础材料/工业气体",

  // ── ETF ──
  QQQ: "ETF/纳指100", SPY: "ETF/标普500", IWM: "ETF/罗素2000",
  IGV: "ETF/软件", SMH: "ETF/半导体", MARS: "ETF/航天",
  UFO: "ETF/航天", EWY: "ETF/韩国", IYZ: "ETF/通信",
  TQQQ: "ETF/纳指3倍杠杆", ARKK: "ETF/创新", CWEB: "ETF/中概互联网",
  YINN: "ETF/中国3倍杠杆", UGL: "ETF/黄金2倍杠杆", SCO: "ETF/原油反向",
  KORU: "ETF/韩国3倍杠杆", BABX: "ETF/债券",

  // ── 港股（已有） ──
  "00005.HK": "银行/金融", "00700.HK": "互联网/社交",
  "09988.HK": "电商/云计算", "01276.HK": "医疗/制药",
  "03486.HK": "ETF/半导体", "07552.HK": "ETF/恒科反向",
  "07747.HK": "ETF/三星杠杆", "03986.HK": "半导体/存储",
  "07234.HK": "ETF/创业板杠杆", "07200.HK": "ETF/恒指杠杆",
  "07299.HK": "ETF/黄金杠杆", "07709.HK": "ETF/海力士杠杆",
  // ── 恒生科技指数 ──
  "03690.HK": "互联网/本地生活", "09999.HK": "互联网/游戏", "09618.HK": "电商/物流",
  "01024.HK": "互联网/短视频", "09888.HK": "互联网/AI", "00981.HK": "半导体/晶圆代工",
  "09626.HK": "互联网/视频", "01810.HK": "消费电子/IoT", "02382.HK": "光学/精密制造",
  "09961.HK": "互联网/旅游", "01347.HK": "半导体/晶圆代工", "02015.HK": "新能源车",
  "09868.HK": "新能源车", "06690.HK": "家电/智能制造", "01211.HK": "新能源车/电池",
  "02269.HK": "医疗/生物科技", "00268.HK": "软件/企业服务", "00241.HK": "医疗/互联网",
  // ── 恒生指数 ──
  "00941.HK": "电信/运营商", "01299.HK": "保险/寿险", "00388.HK": "金融/交易所",
  "02318.HK": "保险/综合金融", "00939.HK": "银行/国有", "01398.HK": "银行/国有",
  "03988.HK": "银行/国有", "03968.HK": "银行/零售", "00883.HK": "能源/石油",
  "02628.HK": "保险/寿险", "00027.HK": "消费/博彩", "02020.HK": "消费/运动品牌",
  "00175.HK": "汽车/整车", "00066.HK": "公用事业/交通", "09633.HK": "消费/饮料",
  "00016.HK": "地产/开发", "02388.HK": "银行/零售",

  // ── 其他 ──
  RKLB: "航天/火箭", RKLX: "航天/杠杆", LITE: "光通信/激光",
  AAOI: "光通信/激光", SNXX: "存储/杠杆",
};

/** 解析行业：个股映射表（最精确）→ Yahoo 英文翻译 → 兜底 */
export function resolveSector(ticker, yahooSector, isETF) {
  // 1. 个股映射表（手工策划，最精确）
  if (TICKER_SECTOR_MAP[ticker]) return TICKER_SECTOR_MAP[ticker];
  // 2. Yahoo API 返回了标准英文行业 → 翻译
  if (yahooSector && SECTOR_EN_TO_CN[yahooSector]) return SECTOR_EN_TO_CN[yahooSector];
  // 3. 兜底
  return isETF ? "ETF" : "未知";
}

// ─── Yahoo Finance range → 请求参数映射 ──────────────────
const RANGE_CONFIG = {
  "1D": { range: "1d",  interval: "5m" },
  "5D": { range: "5d",  interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
  "1Y": { range: "1y",  interval: "1d" },
  "5Y": { range: "5y",  interval: "1wk" },
  "ALL": { range: "max", interval: "1mo" },
};

// ─── 日期格式化工具 ──────────────────────────────────────
function formatDateKey(timestamp, rangeKey) {
  const d = new Date(timestamp * 1000);
  switch (rangeKey) {
    case "1D":
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    case "5D":
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    case "5Y":
    case "ALL":
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    default: // 1M, 6M, YTD, 1Y
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
}

// ─── 内部：单次 Yahoo 拉取 + 解析 ──────────────────────────
async function _fetchOneRange(yfSym, rangeKey) {
  const cfg = RANGE_CONFIG[rangeKey];
  if (!cfg) return [];
  const path = `/v8/finance/chart/${yfSym}?interval=${cfg.interval}&range=${cfg.range}`;
  const data = await yahooChartFetch(path, 15000);
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const history = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const m = formatDateKey(timestamps[i], rangeKey);
    if (history.length > 0 && history[history.length - 1].m === m) {
      history[history.length - 1].p = +(closes[i].toFixed(2));
    } else {
      history.push({ m, p: +(closes[i].toFixed(2)) });
    }
  }
  return history;
}

// ─── 从 1Y 数据本地切片到短周期（YTD/6M/1M）─────────────
// 用于：Yahoo 对小盘 ETF 直接 range=ytd 经常返回空，但 range=1y 几乎都有
function _sliceFrom1Y(history1Y, targetRange) {
  if (!history1Y || history1Y.length === 0) return [];
  const today = new Date();
  let cutoff;
  if (targetRange === 'YTD') {
    cutoff = new Date(today.getFullYear(), 0, 1); // 当年 1 月 1 日
  } else if (targetRange === '6M') {
    cutoff = new Date(today.getTime() - 183 * 86400000);
  } else if (targetRange === '1M') {
    cutoff = new Date(today.getTime() - 31 * 86400000);
  } else {
    return [...history1Y];
  }
  // history 元素是 {m: "MM/DD", p: ...}，1Y 取的就是 MM/DD 格式
  // 需要根据当前年份判断 — 1Y 跨年，cutoff 之前的全删
  // 简化策略：1Y 数据是按时间排序的，找到第一个 MM/DD >= cutoff 的位置
  const cutMonth = cutoff.getMonth() + 1;
  const cutDay = cutoff.getDate();
  // 因为 1Y 数据跨越前一年到今年，"MM/DD" 字符串排序不稳定
  // 兜底：直接按比例切。targetRange=YTD 大约取后 N 天，N 估算
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 1)) / 86400000);
  const days1Y = 365;
  const ratio = targetRange === '1M' ? 31 / days1Y
              : targetRange === '6M' ? 183 / days1Y
              : dayOfYear / days1Y; // YTD
  const startIdx = Math.max(0, Math.floor(history1Y.length * (1 - ratio)));
  return history1Y.slice(startIdx);
}

// ─── 获取单个范围的价格数据（内部实现，不经过缓存）──────────
async function _fetchRangePricesNoCache(yfSym, rangeKey) {
  const direct = await _fetchOneRange(yfSym, rangeKey);
  // 短周期（YTD/1M/6M）若 Yahoo 直接返回空 → 兜底拉 1Y 切片
  // Yahoo 对小盘 ETF 的 range=ytd 经常返回 []，但 range=1y 几乎全有
  if (direct.length >= 2) return direct;
  if (rangeKey === 'YTD' || rangeKey === '1M' || rangeKey === '6M') {
    try {
      const oneYear = await _fetchOneRange(yfSym, '1Y');
      if (oneYear.length >= 2) {
        const sliced = _sliceFrom1Y(oneYear, rangeKey);
        if (sliced.length >= 2) {
          console.info(`[Yahoo Fallback] ${yfSym} ${rangeKey} 直拉空 → 切自 1Y (${sliced.length} 点)`);
          return sliced;
        }
      }
    } catch (e) { /* 兜底失败也只能返回原 direct（空） */ }
  }
  return direct;
}

// ─── 带 IndexedDB 缓存的范围价格（向后兼容签名：返回 array）──
// 三段式：fresh-idb → network → stale-idb 兜底
// 调用方不需要关心 source 时直接用本函数。需要诊断 stale 时用 fetchRangePricesEx。
export async function fetchRangePrices(yfSym, rangeKey) {
  const { points, source, error } = await withCache(yfSym, rangeKey, () =>
    _fetchRangePricesNoCache(yfSym, rangeKey)
  );
  if (source === "stale-idb") {
    console.warn(`[Cache] ${yfSym} ${rangeKey} 用了 stale 缓存数据 (${error})`);
  }
  return points;
}

// ─── 暴露缓存来源信息的 Ex 版本（BacktestEngine 用） ────────
// 返回: { points, source: 'fresh-idb'|'network'|'stale-idb'|'empty', error? }
export async function fetchRangePricesEx(yfSym, rangeKey) {
  return await withCache(yfSym, rangeKey, () =>
    _fetchRangePricesNoCache(yfSym, rangeKey)
  );
}

// ─── 搜索标的 ──────────────────────────────────────────
export async function searchTickers(query) {
  const results = [];
  const q = query.trim();
  if (!q) return results;

  // 1. Try Yahoo Finance search API
  try {
    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`
    );
    for (const quote of (data?.quotes || [])) {
      const symbol = quote.symbol || "";
      // Yahoo 后缀 → 内部 market 代码
      const market = symbol.endsWith(".HK") ? "HK"
        : symbol.endsWith(".SS") ? "SH"
        : symbol.endsWith(".SZ") ? "SZ"
        : (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) ? "KR"
        : symbol.endsWith(".T") ? "JP"
        : "US";
      const currency = { HK:"HKD", SH:"CNY", SZ:"CNY", KR:"KRW", JP:"JPY", US:"USD" }[market] || "USD";
      results.push({
        symbol: symbol.endsWith(".HK") ? symbol.replace(".HK", "").padStart(5, "0") + ".HK" : symbol,
        name: quote.shortname || quote.longname || symbol,
        market,
        currency,
        type: quote.quoteType === "ETF" ? "etf" : "stock",
        exchange: quote.exchange || "",
      });
    }
  } catch { /* ignore */ }

  // 2. Also try direct symbol match
  if (results.length === 0) {
    const directSymbols = [q.toUpperCase()];
    if (!q.includes(".")) directSymbols.push(q.toUpperCase() + ".HK");

    for (const sym of directSymbols) {
      try {
        const yfSym = sym.endsWith(".HK")
          ? sym.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK"
          : sym;
        const data = await yahooChartFetch(
          `/v8/finance/chart/${yfSym}?interval=1d&range=1d`, 10000
        );
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const displaySym = sym.endsWith(".HK")
            ? sym.replace(".HK", "").padStart(5, "0") + ".HK" : sym;
          results.push({
            symbol: displaySym,
            name: meta.shortName || meta.symbol || displaySym,
            market: sym.endsWith(".HK") ? "HK" : "US",
            currency: meta.currency || "USD",
            type: meta.instrumentType === "ETF" ? "etf" : "stock",
            price: +(meta.regularMarketPrice.toFixed(2)),
          });
        }
      } catch { /* ignore */ }
    }
  }

  return results;
}

// ─── 获取单个标的完整数据（多时间范围）──────────────────
// 外层包 IndexedDB 缓存（withStockDataCache），TTL 1h；网络挂时返回 stale。
export async function fetchStockData(ticker) {
  const { data, source, error } = await withStockDataCache(ticker, () =>
    _fetchStockDataNoCache(ticker)
  );
  if (source === "stale-idb") {
    console.warn(`[Cache] ${ticker} stockData 用了 stale 缓存 (${error})`);
  }
  if (!data) throw new Error(`No data for ${ticker}`);
  return data;
}

// 内部：实际拉取 Yahoo + 解析 + 算分（不经过缓存）
async function _fetchStockDataNoCache(ticker) {
  // Determine Yahoo symbol
  let yfSym = ticker;
  if (ticker.endsWith(".HK")) {
    yfSym = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
  }

  // 1. 先获取 1Y 日线数据（核心数据，用于基本面计算）
  const path1Y = `/v8/finance/chart/${yfSym}?interval=1d&range=1y`;
  const data = await yahooChartFetch(path1Y, 15000);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  // Current price — 使用 chartPreviousClose 作为降级值
  const price = +(meta.regularMarketPrice?.toFixed(2) || 0);
  const prevClose = +(meta.previousClose?.toFixed(2) || meta.chartPreviousClose?.toFixed(2) || 0);
  const rawChange = prevClose > 0 ? +((price - prevClose) / prevClose * 100).toFixed(2) : 0;
  const change = isFinite(rawChange) ? rawChange : 0;
  const currency = meta.currency || "USD";

  // Build 1Y price history（不降采样，保留全部日线数据）
  const priceHistory1Y = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const m = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    if (priceHistory1Y.length > 0 && priceHistory1Y[priceHistory1Y.length - 1].m === m) {
      priceHistory1Y[priceHistory1Y.length - 1].p = +(closes[i].toFixed(2));
    } else {
      priceHistory1Y.push({ m, p: +(closes[i].toFixed(2)) });
    }
  }

  // 从 1Y 数据中截取 6M / 1M 子集
  const halfLen = Math.floor(priceHistory1Y.length / 2);
  const priceHistory6M = priceHistory1Y.slice(Math.max(0, halfLen));
  const monthLen = Math.floor(priceHistory1Y.length / 12);
  const priceHistory1M = priceHistory1Y.slice(Math.max(0, priceHistory1Y.length - Math.max(monthLen, 20)));

  // YTD: 从今年1月第一个交易日开始
  // 思路：从结尾倒推，跳过非1月，遇到1月就持续向前更新 ytdStart，直到遇到非1月（即上一年12月）就停止
  // 这样得到的是"最近一段连续1月段的最早那天"——即今年1月第一个交易日
  let ytdStart = -1;
  for (let i = priceHistory1Y.length - 1; i >= 0; i--) {
    if (priceHistory1Y[i].m.startsWith("01/")) {
      ytdStart = i;
    } else if (ytdStart !== -1) {
      break; // 已经走过整个1月段，停止
    }
  }
  const priceHistoryYTD = ytdStart >= 0 ? priceHistory1Y.slice(ytdStart) : [...priceHistory1Y];

  // Compute RSI & Momentum
  const validCloses = closes.filter(c => c != null);
  const rsi = calcRSI(validCloses);
  const momentum = calcMomentum(validCloses);

  // 2. 并行获取 5Y 和 ALL 范围（长周期数据）
  const priceRanges = {
    "1M": priceHistory1M,
    "6M": priceHistory6M,
    "YTD": priceHistoryYTD,
    "1Y": priceHistory1Y,
  };

  // 获取 crumb 用于 quoteSummary 认证
  const crumb = await ensureYahooCrumb();
  const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';

  // 并行获取 5Y + ALL + quoteSummary + 中文描述（四个请求互不依赖，一起发）
  const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${yfSym}?modules=summaryProfile,defaultKeyStatistics,financialData,price,summaryDetail,calendarEvents${crumbParam}`;
  const cnProfileUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${yfSym}?modules=summaryProfile&lang=zh-Hant${crumbParam}`;
  const [prices5Y, pricesALL, summaryResult, cnProfileResult] = await Promise.allSettled([
    fetchRangePrices(yfSym, "5Y"),
    fetchRangePrices(yfSym, "ALL"),
    yahooFetch(summaryUrl, 10000),
    yahooFetch(cnProfileUrl, 8000),
  ]);
  if (prices5Y.status === "fulfilled" && prices5Y.value.length >= 2) {
    priceRanges["5Y"] = prices5Y.value;
  }
  if (pricesALL.status === "fulfilled" && pricesALL.value.length >= 2) {
    priceRanges["ALL"] = pricesALL.value;
  }

  // Parse fundamentals from quote summary
  let pe = null, roe = null, revenueGrowth = null, profitMargin = null;
  let marketCap = null, ebitda = null, revenue = null, eps = null, beta = null;
  let week52High = meta.fiftyTwoWeekHigh || null;
  let week52Low = meta.fiftyTwoWeekLow || null;
  let avgVolume = null;
  let shortName = meta.shortName || meta.symbol || ticker;
  let sector = "";
  let description = "";
  let isETF = meta.instrumentType === "ETF";
  let quoteType = meta.instrumentType || "EQUITY";
  let nextEarningsDate = null;

  try {
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    // 检查 Yahoo API 层面的错误（如 Invalid Crumb）
    if (summary?.quoteSummary?.error) {
      const errMsg = summary.quoteSummary.error.description || 'Unknown';
      console.warn(`[QuantEdge] ${ticker} quoteSummary error: ${errMsg}`);
      if (errMsg.includes('Crumb')) { _crumb = null; _crumbAt = 0; }
    }
    const result2 = summary?.quoteSummary?.result?.[0];
    if (result2) {
      const fin = result2.financialData || {};
      const stats = result2.defaultKeyStatistics || {};
      const profile = result2.summaryProfile || {};
      const priceData = result2.price || {};
      const detail = result2.summaryDetail || {};
      const calendar = result2.calendarEvents || {};

      // PE — 多路径取值
      pe = detail.trailingPE?.raw ? +(detail.trailingPE.raw.toFixed(2)) : null;
      if (!pe && priceData.trailingPE?.raw) pe = +(priceData.trailingPE.raw.toFixed(2));
      if (!pe && stats.trailingPE?.raw) pe = +(stats.trailingPE.raw.toFixed(2));

      roe = fin.returnOnEquity?.raw ? +(fin.returnOnEquity.raw * 100).toFixed(1) : null;
      revenueGrowth = fin.revenueGrowth?.raw ? +(fin.revenueGrowth.raw * 100).toFixed(1) : null;
      profitMargin = fin.profitMargins?.raw ? +(fin.profitMargins.raw * 100).toFixed(1) : null;
      ebitda = fin.ebitda?.raw || null;
      revenue = fin.totalRevenue?.raw || null;
      eps = stats.trailingEps?.raw ?? (fin.earningsPerShare?.raw || null);
      beta = (stats.beta?.raw ?? detail.beta?.raw) ? +((stats.beta?.raw ?? detail.beta?.raw).toFixed(2)) : null;
      marketCap = priceData.marketCap?.raw || detail.marketCap?.raw || null;
      avgVolume = detail.averageVolume?.raw || detail.averageDailyVolume10Day?.raw || null;
      sector = profile.sector || "";
      description = (profile.longBusinessSummary || "").slice(0, 300);
      shortName = priceData.shortName || shortName;
      isETF = (priceData.quoteType === "ETF" || priceData.quoteType === "MUTUALFUND") || isETF;

      // 52周高低 — summaryDetail 可能比 chart meta 更准确
      if (detail.fiftyTwoWeekHigh?.raw) week52High = detail.fiftyTwoWeekHigh.raw;
      if (detail.fiftyTwoWeekLow?.raw) week52Low = detail.fiftyTwoWeekLow.raw;

      // 下次财报日期
      const earningsDates = calendar.earnings?.earningsDate || [];
      if (earningsDates.length > 0 && earningsDates[0]?.raw) {
        const ed = new Date(earningsDates[0].raw * 1000);
        nextEarningsDate = `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}`;
      }
    } else {
      console.warn(`[QuantEdge] ${ticker} quoteSummary returned no data (crumb may be missing)`);
    }
  } catch (e) {
    console.warn(`[QuantEdge] ${ticker} fundamentals parse error:`, e.message);
  }

  // 解析中文描述（来自 Yahoo Finance 中文 locale）
  let descriptionCN = "";
  let nameCN = STOCK_CN_NAMES[ticker] || "";
  try {
    const cnSummary = cnProfileResult.status === "fulfilled" ? cnProfileResult.value : null;
    const cnResult = cnSummary?.quoteSummary?.result?.[0];
    if (cnResult?.summaryProfile?.longBusinessSummary) {
      descriptionCN = cnResult.summaryProfile.longBusinessSummary.slice(0, 300);
    }
  } catch { /* Chinese profile fetch failed — ok */ }

  // Compute score
  const { score, subScores } = isETF
    ? calcETFScore({ momentum })
    : calcStockScore({ pe, roe, revenueGrowth, profitMargin, momentum, rsi });

  // Sector 解析（优先映射表 → Yahoo API → 兜底）
  const sectorCN = resolveSector(ticker, sector, isETF);

  const stockData = {
    ticker,
    name: shortName,
    nameCN,
    market: ticker.endsWith(".HK") ? "HK" : "US",
    sector: sectorCN,
    currency,
    price,
    change,
    score,
    subScores,
    isETF,
    pe, roe, momentum, rsi,
    revenueGrowth, profitMargin,
    ebitda: fmtBig(ebitda),
    marketCap: fmtBig(marketCap),
    revenue: fmtBig(revenue),
    eps: typeof eps === "number" ? +eps.toFixed(2) : null,
    beta,
    week52High, week52Low,
    avgVolume: fmtBig(avgVolume),
    nextEarnings: nextEarningsDate,
    priceHistory: priceHistory1Y,
    priceRanges,
    description,
    descriptionCN,
    _fetchedAt: Date.now(),
  };

  // 3. 运行数据质量检查
  const dqReport = validateStockData(stockData);
  stockData._dataQuality = dqReport;
  if (dqReport.issues.length > 0) {
    console.warn(`[DQ] ${ticker} 数据质量问题:`, dqReport.issues.map(i => i.msg));
  }

  return stockData;
}

// ─── 基准指数价格数据获取（单范围）──────────────────────
export async function fetchBenchmarkPrices(ticker, range = "1Y") {
  let yfSym = ticker;
  if (ticker.endsWith(".HK")) {
    yfSym = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
  }
  return await fetchRangePrices(yfSym, range);
}

// ═══════════════════════════════════════════════════════════
//  数据质量检查系统 (Data Quality Validation)
//  六维度：完整性、准确性、一致性、及时性、有效性、唯一性
// ═══════════════════════════════════════════════════════════

/**
 * 验证单个标的的数据质量
 * @param {object} stk - 标的数据对象
 * @returns {{ score: number, grade: string, issues: Array<{dim: string, severity: string, msg: string}> }}
 */
export function validateStockData(stk) {
  const issues = [];
  const scores = { completeness: 100, accuracy: 100, consistency: 100, timeliness: 100, validity: 100, uniqueness: 100 };

  if (!stk || !stk.ticker) {
    return { score: 0, grade: "F", issues: [{ dim: "validity", severity: "critical", msg: "无效的数据对象" }], scores };
  }

  // ── 1. 完整性 (Completeness) ──
  // 检查必要字段是否缺失
  const requiredFields = ["ticker", "name", "price", "priceHistory", "priceRanges"];
  for (const f of requiredFields) {
    if (stk[f] == null || stk[f] === "") {
      issues.push({ dim: "completeness", severity: "critical", msg: `缺少必要字段: ${f}` });
      scores.completeness -= 20;
    }
  }

  // 检查价格范围覆盖率
  const expectedRanges = ["1M", "6M", "YTD", "1Y", "5Y", "ALL"];
  const pr = stk.priceRanges || {};
  const missingRanges = expectedRanges.filter(r => !pr[r] || pr[r].length < 2);
  if (missingRanges.length > 0) {
    const sev = missingRanges.length >= 4 ? "high" : missingRanges.length >= 2 ? "medium" : "low";
    issues.push({ dim: "completeness", severity: sev, msg: `缺少时间范围数据: ${missingRanges.join(", ")}` });
    scores.completeness -= missingRanges.length * 8;
  }

  // 检查各范围的数据点数是否合理
  const minPointsExpected = { "1M": 15, "6M": 80, "YTD": 20, "1Y": 180, "5Y": 100, "ALL": 20 };
  for (const [range, minPts] of Object.entries(minPointsExpected)) {
    const pts = pr[range]?.length || 0;
    if (pts > 0 && pts < minPts) {
      issues.push({ dim: "completeness", severity: "medium",
        msg: `${range} 数据点不足: ${pts}个 (预期≥${minPts})` });
      scores.completeness -= 5;
    }
  }

  // 检查价格数据中的空值
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    const nullCount = arr.filter(p => p.p == null || p.m == null).length;
    if (nullCount > 0) {
      issues.push({ dim: "completeness", severity: "high",
        msg: `${range} 存在 ${nullCount} 条空值记录` });
      scores.completeness -= nullCount * 3;
    }
  }

  // ── 2. 准确性 (Accuracy) ──
  // 检查价格异常值
  if (stk.price != null) {
    if (stk.price <= 0) {
      issues.push({ dim: "accuracy", severity: "critical", msg: `当前价格异常: $${stk.price}` });
      scores.accuracy -= 30;
    }
    if (stk.price > 1e6) {
      issues.push({ dim: "accuracy", severity: "high", msg: `价格异常偏高: $${stk.price}` });
      scores.accuracy -= 15;
    }
  }

  // 检查涨跌幅合理性
  if (stk.change != null && Math.abs(stk.change) > 50) {
    issues.push({ dim: "accuracy", severity: "medium",
      msg: `日涨跌幅异常: ${stk.change}% (超过±50%)` });
    scores.accuracy -= 10;
  }

  // 检查历史价格中的跳变（前后差异>50%视为异常）
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr) || arr.length < 3) continue;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].p > 0 && arr[i - 1].p > 0) {
        const pctChange = Math.abs(arr[i].p - arr[i - 1].p) / arr[i - 1].p;
        if (pctChange > 0.5 && !["5Y", "ALL"].includes(range)) {
          issues.push({ dim: "accuracy", severity: "medium",
            msg: `${range} 第${i}点价格跳变: ${arr[i - 1].p}→${arr[i].p} (${(pctChange * 100).toFixed(0)}%)` });
          scores.accuracy -= 5;
          break; // 只报告第一个
        }
      }
    }
  }

  // 52周高低验证
  if (stk.week52High && stk.week52Low) {
    if (stk.week52Low > stk.week52High) {
      issues.push({ dim: "accuracy", severity: "high", msg: `52周低>52周高: ${stk.week52Low} > ${stk.week52High}` });
      scores.accuracy -= 15;
    }
    if (stk.price > stk.week52High * 1.1 || stk.price < stk.week52Low * 0.9) {
      issues.push({ dim: "accuracy", severity: "low",
        msg: `当前价格超出52周范围: $${stk.price} (${stk.week52Low}-${stk.week52High})` });
      scores.accuracy -= 5;
    }
  }

  // ── 3. 一致性 (Consistency) ──
  // 检查不同范围数据的最新价格是否一致
  const latestPrices = {};
  for (const [range, arr] of Object.entries(pr)) {
    if (Array.isArray(arr) && arr.length > 0) {
      latestPrices[range] = arr[arr.length - 1].p;
    }
  }
  const priceValues = Object.values(latestPrices);
  if (priceValues.length >= 2) {
    const maxP = Math.max(...priceValues);
    const minP = Math.min(...priceValues);
    if (maxP > 0 && (maxP - minP) / maxP > 0.05) {
      issues.push({ dim: "consistency", severity: "medium",
        msg: `各范围最新价格不一致: ${Object.entries(latestPrices).map(([k, v]) => `${k}=$${v}`).join(", ")}` });
      scores.consistency -= 15;
    }
  }

  // 检查日期格式一致性
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const fmt = arr[0].m;
    const isLong = fmt.length >= 6 && fmt.indexOf("/") >= 4; // YYYY/MM
    const isShort = fmt.match(/^\d{2}\//); // MM/DD
    const isIntraday = fmt.includes(":"); // HH:MM or MM/DD HH:MM
    // 确保同一范围内格式统一
    for (let i = 1; i < arr.length; i++) {
      const curLong = arr[i].m.length >= 6 && arr[i].m.indexOf("/") >= 4;
      const curIntraday = arr[i].m.includes(":");
      if (curLong !== isLong || curIntraday !== isIntraday) {
        issues.push({ dim: "consistency", severity: "high",
          msg: `${range} 日期格式不一致: "${fmt}" vs "${arr[i].m}"` });
        scores.consistency -= 10;
        break;
      }
    }
  }

  // ── 4. 及时性 (Timeliness) ──
  if (stk._fetchedAt) {
    const ageHours = (Date.now() - stk._fetchedAt) / 3600000;
    if (ageHours > 24) {
      issues.push({ dim: "timeliness", severity: "medium",
        msg: `数据已过期: ${Math.round(ageHours)}小时前获取` });
      scores.timeliness -= Math.min(30, Math.round(ageHours / 2));
    }
  } else {
    issues.push({ dim: "timeliness", severity: "low", msg: "缺少数据获取时间戳" });
    scores.timeliness -= 10;
  }

  // 检查最新数据点是否在合理时间范围内
  const pr1Y = pr["1Y"] || pr["6M"] || stk.priceHistory;
  if (Array.isArray(pr1Y) && pr1Y.length > 0) {
    const lastDate = pr1Y[pr1Y.length - 1].m;
    const now = new Date();
    const curMM = String(now.getMonth() + 1).padStart(2, "0");
    const curDD = String(now.getDate()).padStart(2, "0");
    // 简单检查：最新数据点的月份是否为当前月或上个月
    if (lastDate.match(/^\d{2}\//)) {
      const dateMM = lastDate.substring(0, 2);
      const prevMM = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0");
      if (dateMM !== curMM && dateMM !== prevMM) {
        issues.push({ dim: "timeliness", severity: "high",
          msg: `最新数据点过旧: ${lastDate} (当前 ${curMM}/${curDD})` });
        scores.timeliness -= 20;
      }
    }
  }

  // ── 5. 有效性 (Validity) ──
  // 检查 ticker 格式
  if (!/^[A-Z0-9.]+$/.test(stk.ticker)) {
    issues.push({ dim: "validity", severity: "high", msg: `Ticker 格式异常: ${stk.ticker}` });
    scores.validity -= 15;
  }

  // 检查 market 值
  if (!["US", "HK", "CN"].includes(stk.market)) {
    issues.push({ dim: "validity", severity: "medium", msg: `市场标识无效: ${stk.market}` });
    scores.validity -= 10;
  }

  // 检查评分范围
  if (stk.score != null && (stk.score < 0 || stk.score > 100)) {
    issues.push({ dim: "validity", severity: "high", msg: `评分超出有效范围: ${stk.score}` });
    scores.validity -= 15;
  }

  // 检查日期值域
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    for (const pt of arr) {
      if (typeof pt.m !== "string" || pt.m.length < 4) {
        issues.push({ dim: "validity", severity: "high", msg: `${range} 日期格式无效: "${pt.m}"` });
        scores.validity -= 10;
        break;
      }
      if (typeof pt.p !== "number" || isNaN(pt.p)) {
        issues.push({ dim: "validity", severity: "high", msg: `${range} 价格值无效: ${pt.p}` });
        scores.validity -= 10;
        break;
      }
    }
  }

  // ── 6. 唯一性 (Uniqueness) ──
  // 检查同一范围内的日期重复
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    const dates = new Set();
    let dupCount = 0;
    for (const pt of arr) {
      if (dates.has(pt.m)) dupCount++;
      dates.add(pt.m);
    }
    if (dupCount > 0) {
      issues.push({ dim: "uniqueness", severity: "medium",
        msg: `${range} 存在 ${dupCount} 条重复日期` });
      scores.uniqueness -= dupCount * 5;
    }
  }

  // 计算总分（各维度等权）
  for (const k of Object.keys(scores)) {
    scores[k] = Math.max(0, Math.min(100, scores[k]));
  }
  const totalScore = Math.round(
    Object.values(scores).reduce((s, v) => s + v, 0) / Object.keys(scores).length
  );

  const grade = totalScore >= 90 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : totalScore >= 40 ? "D" : "F";

  return { score: totalScore, grade, issues, scores };
}

/**
 * 批量验证所有标的数据质量
 * @param {Array} stocks - 标的数组
 * @returns {{ summary: object, details: Array }}
 */
export function validateAllStocks(stocks) {
  if (!Array.isArray(stocks)) return { summary: { total: 0 }, details: [] };

  const details = stocks.map(stk => ({
    ticker: stk.ticker,
    name: stk.name,
    ...validateStockData(stk),
  }));

  const total = details.length;
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  details.forEach(d => { grades[d.grade] = (grades[d.grade] || 0) + 1; });
  const avgScore = total > 0 ? Math.round(details.reduce((s, d) => s + d.score, 0) / total) : 0;

  // 按维度汇总问题
  const dimSummary = {};
  for (const d of details) {
    for (const issue of d.issues) {
      if (!dimSummary[issue.dim]) dimSummary[issue.dim] = { count: 0, critical: 0, high: 0 };
      dimSummary[issue.dim].count++;
      if (issue.severity === "critical") dimSummary[issue.dim].critical++;
      if (issue.severity === "high") dimSummary[issue.dim].high++;
    }
  }

  return {
    summary: { total, avgScore, grades, dimSummary },
    details: details.sort((a, b) => a.score - b.score), // 质量最差的排前面
  };
}

// ─── 评分逻辑 (移植自 backend/factors.py) ──────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  const last = deltas.slice(-period);
  let avgGain = 0, avgLoss = 0;
  for (const d of last) { if (d > 0) avgGain += d; else avgLoss -= d; }
  avgGain /= period; avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function calcMomentum(closes, period = 20) {
  if (closes.length < period + 1) return 50;
  const base = closes[closes.length - 1 - period];
  if (!base || base === 0) return 50;
  const ret = (closes[closes.length - 1] / base - 1) * 100;
  return +Math.max(0, Math.min(100, 50 + ret * 2.5)).toFixed(1);
}

function calcStockScore({ pe, roe, revenueGrowth, profitMargin, momentum, rsi }) {
  // PE score
  let peS = 20;
  if (pe != null && pe >= 0) {
    if (pe < 15) peS = 95; else if (pe < 25) peS = 80;
    else if (pe < 40) peS = 60; else if (pe < 80) peS = 40; else peS = 20;
  }
  // ROE score
  let roeS = 30;
  if (roe != null) {
    if (roe > 30) roeS = 95; else if (roe > 20) roeS = 80;
    else if (roe > 10) roeS = 60; else if (roe > 0) roeS = 40; else roeS = 15;
  }
  // Margin score
  let mS = 30;
  if (profitMargin != null) {
    if (profitMargin > 30) mS = 95; else if (profitMargin > 15) mS = 75;
    else if (profitMargin > 5) mS = 55; else if (profitMargin > 0) mS = 35; else mS = 15;
  }
  const fundamental = (peS + roeS + mS) / 3;

  // Technical
  let rsiS = 35;
  if (rsi >= 40 && rsi <= 60) rsiS = 70; else if (rsi >= 30 && rsi <= 70) rsiS = 55;
  const technical = (momentum + rsiS) / 2;

  // Growth
  let growth = 40;
  if (revenueGrowth != null) {
    if (revenueGrowth > 50) growth = 95; else if (revenueGrowth > 25) growth = 80;
    else if (revenueGrowth > 10) growth = 65; else if (revenueGrowth > 0) growth = 45; else growth = 20;
  }

  const score = +(fundamental * 0.4 + technical * 0.3 + growth * 0.3).toFixed(1);
  return {
    score: Math.max(0, Math.min(100, score)),
    subScores: {
      fundamental: +fundamental.toFixed(1),
      technical: +technical.toFixed(1),
      growth: +growth.toFixed(1),
    },
  };
}

function calcETFScore({ momentum }) {
  const score = +(50 * 0.4 + momentum * 0.35 + 50 * 0.25).toFixed(1);
  return {
    score: Math.max(0, Math.min(100, score)),
    subScores: { cost: 50, liquidity: 50, momentum: +momentum.toFixed(1), risk: 50 },
  };
}

function fmtBig(n) {
  if (n == null) return null;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ─── localStorage 持久化 ──────────────────────────────
export function loadStandaloneStocks() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveStandaloneStocks(stocks) {
  try {
    // Sanitize: |change| > 50% 极少是真实当日涨跌，通常是误把累计涨幅塞进了 change。
    // 遇到这种值归 0，等下一次 Yahoo 快速刷新重新填入。
    const sanitized = stocks.map(s => {
      if (typeof s?.change === "number" && Math.abs(s.change) > 50) {
        return { ...s, change: 0 };
      }
      return s;
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(sanitized));
  } catch { /* full */ }
}

// ─── 检查是否为独立模式 (无后端) ──────────────────────
export async function checkStandaloneMode() {
  try {
    const res = await fetch("/api/status", { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return !data?.status; // has backend
  } catch {
    return true; // no backend = standalone mode
  }
}
