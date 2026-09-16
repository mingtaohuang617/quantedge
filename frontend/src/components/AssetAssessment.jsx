import React from 'react';
import { useLang } from '../i18n.jsx';

const names = { expenseRatio: '年费率', medianSpread30d: '30 日买卖价差中位数', dailyTrackingError: '每日跟踪误差' };
const paths = { up: '每天上涨 1%', down: '每天下跌 1%', round_trip: '上涨后回到原点' };
const reasons = { missing: '缺少有效观测', expired: '费率减免已到期，需重新核验', stale: '观测已过期', not_yet_available: '评价时点尚不可得', invalid: '数据口径未通过校验' };
const issues = { official_index_daily_series_required: '尚缺官方基准每日收益序列', nav_total_return_daily_series_required: '尚缺经过公司行动核验的每日净值总回报序列', issuer_fetch_or_schema_failure: '发行商数据获取或字段校验失败', tracking_alignment_or_action_review_required: '跟踪序列或公司行动需要复核' };
const feeBasis = { gross: '总费率', net: '减免后净费率', prospectus: '招募说明书费率' };
export default function AssetAssessment({ stock }) {
  const { t } = useLang();
  const assessment = stock.assetAssessment;
  if (!assessment) return null;
  const product = assessment.product;
  return <div data-testid="asset-assessment" className="mt-3 space-y-3">
    <p>{t('产品质量、底层资产与价格趋势分别判断，不合成买入评分。')}</p>
    {product && <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[[t('产品质量'), product.score], [t('底层资产质量'), assessment.underlying?.qualityScore], [t('产品价格趋势'), stock.timingScore]].map(([label, value]) => <div key={label} className="rounded-lg border p-2" style={{ borderColor: 'var(--line)' }}>
          <div>{label}</div><div className="text-xl font-mono mt-1">{value ?? '—'}<span className="text-xs"> / 100</span></div>
        </div>)}
      </div>
      <p>{t('产品数据覆盖 {n}%；三项齐全才计算产品质量。', { n: product.coverage })}</p>
      <p>{t('产品评价截至')}：{product.asOf || t('未知')} · {t('行情趋势沿用其独立日期')}</p>
      <ul className="space-y-1">
        {Object.entries(product.fields).map(([key, entry]) => <li key={key} className="break-words">{t(names[key])}：{entry ? <>
          {Number(entry.value.toFixed(2))} {entry.unit === 'bps' ? 'bps' : '%'} · {entry.asOf} · <a href={entry.source} target="_blank" rel="noopener noreferrer" className="underline">{t('来源')}</a>
          {entry.basis && <span> · {t(feeBasis[entry.basis] || entry.basis)}</span>}
          {entry.validThrough && <span> · {t('减免截至')} {entry.validThrough}</span>}
        </> : t(reasons[product.reasons?.[key]] || '缺少有效观测')}</li>)}
      </ul>
      {product.fields.dailyTrackingError && <div className="space-y-1">
        <p>{t('跟踪窗口')}：{product.fields.dailyTrackingError.windowStart} — {product.fields.dailyTrackingError.asOf} · {product.fields.dailyTrackingError.observations} {t('个交易日')}</p>
        <p>{t('日均跟踪偏离')}：{product.fields.dailyTrackingError.meanDifferenceBps?.toFixed(2) ?? '—'} bps · {t('最大绝对偏离')}：{product.fields.dailyTrackingError.maxAbsDifferenceBps?.toFixed(2) ?? '—'} bps</p>
        <p>{t('标准差不包含持续偏离的方向；产品分不代表持有收益。')}</p>
        {product.fields.dailyTrackingError.benchmarkSource && <a href={product.fields.dailyTrackingError.benchmarkSource} target="_blank" rel="noopener noreferrer" className="underline">{t('基准行情来源')}</a>}
      </div>}
      {(stock.productDataIssues || []).map(issue => <p key={issue} style={{ color: 'var(--warn)' }}>{t(issues[issue] || '数据口径未通过校验')}</p>)}
      {stock.classificationSource && <p>{stock.issuer} · {stock.underlyingSymbol || stock.benchmark} · <a className="underline" href={stock.classificationSource} target="_blank" rel="noopener noreferrer">{t('产品身份来源')}</a></p>}
      <p>{assessment.underlying ? `${assessment.underlying.ticker} · ${assessment.underlying.priceAsOf || t('未知')}` : t('底层资产尚未关联有效独立数据；不借用 ETF 自身指标。')}</p>
      <p>{t('产品质量为实验性执行指标，阈值尚未经过样本外验证。')}</p>
    </>}
    {assessment.mode === 'crypto_research' && <>
      <p>{t('产品价格趋势')}：{stock.timingScore ?? '—'} / 100</p>
      <p>{t('加密资产独立研究：流动性、供给与解锁、网络使用、安全性。')}</p>
      <p>{t('链上与供给数据尚未接入；暂不生成基本面分或综合排名。稳定币需另行评估储备与赎回。')}</p>
    </>}
    {assessment.scenarios.length > 0 && <details>
      <summary className="cursor-pointer">{t('每日重置的持有路径情景')}</summary>
      <p className="my-2">{t('假设每日固定杠杆，未计费用、融资与跟踪偏离；不是回测或预测。往返路径为上涨 1% 后下跌约 0.9901%。')}</p>
      <table className="w-full text-left text-xs"><thead><tr>{['假设路径', '天数', '底层收益', '产品收益'].map(label => <th key={label} className="py-1">{t(label)}</th>)}</tr></thead>
        <tbody>{assessment.scenarios.map(row => <tr key={`${row.path}-${row.days}`}><td className="py-1">{t(paths[row.path])}</td><td>{row.days}</td><td>{row.benchmarkReturn}%</td><td>{row.productReturn}%</td></tr>)}</tbody>
      </table>
    </details>}
  </div>;
}
