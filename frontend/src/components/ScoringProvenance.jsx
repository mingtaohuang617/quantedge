import React from 'react';
import { ASSET_LABELS } from '../lib/scoring.js';
import { useLang } from '../i18n.jsx';
import AssetAssessment from './AssetAssessment.jsx';

export default function ScoringProvenance({ stock, weights }) {
  const { t } = useLang();
  if (!stock) return null;
  const m = stock.scoring;
  const ready = stock.score != null;
  const counts = Object.values(m?.factorPeerCounts || {});
  const pending = m?.status === 'separate_dimensions' ? t('分项研究，不合成总分') : m?.status === 'unsupported' ? t('该资产专属模型尚未启用') : t('关键数据或同类样本不足');
  const age = m?.priceAsOf ? Math.floor((Date.now() - Date.parse(m.priceAsOf)) / 86400000) : null;
  const unknown = t('未知');
  return <section data-testid="scoring-provenance" className="rounded-xl border p-3 my-3 text-xs" style={{ color: 'var(--fg-1)', borderColor: 'var(--line)', background: 'var(--surface-1)' }} aria-label={t('评分依据')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold" style={{ color: 'var(--fg-0)' }}>{t(ASSET_LABELS[stock.assetType] || '待分类')} · {ready ? t('评分依据') : stock.assetAssessment ? pending : `${t('暂不评分')} · ${pending}`}</span>
      <span>{t('数据覆盖 {n}%', { n: m?.coverage ?? 0 })}</span>
    </div>
    {ready && <p data-testid="score-equation" className="mt-2 font-mono">{stock.qualityScore ?? '—'} × {weights?.quality ?? 60}% ＋ {stock.timingScore ?? '—'} × {weights?.timing ?? 40}% ＝ {stock.score}</p>}
    {!stock.assetAssessment && <p className="mt-2">{t('质量覆盖 {q}% · 趋势覆盖 {v}%', { q: m?.qualityCoverage ?? 0, v: m?.timingCoverage ?? 0 })}</p>}
    <AssetAssessment stock={stock} />
    <p className="mt-1">{t('多月趋势描述，非买点或上涨概率')}</p>
    <p data-testid="scoring-validation-status" className="mt-2" style={{ color: 'var(--warn)' }}>{t('验证状态：实验性研究，尚未通过完整样本外验证。')}</p>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
      <div><dt className="inline">{t('评分行情截至')}：</dt><dd className="inline">{m?.priceAsOf || unknown}</dd></div>
      {stock.assetType === 'stock' && <div><dt className="inline">{t('财报期')}：</dt><dd className="inline">{m?.financialPeriod || unknown}</dd></div>}
      {stock.assetType === 'stock' && <div><dt className="inline">{t('财报发布日')}：</dt><dd className="inline">{m?.financialPublishedAt || unknown}</dd></div>}
      <div><dt className="inline">{t('同类动量样本')}：</dt><dd className="inline">{m?.momentumPeers ?? 0}</dd></div>
    </dl>
    {age > 10 && <p className="mt-2" style={{ color: 'var(--warn)' }}>{t('评分使用 {n} 天前的行情，请刷新后参考', { n: age })}</p>}
    <details className="mt-2">
      <summary className="cursor-pointer" style={{ color: 'var(--indigo-2)' }}>{t('查看模型与数据限制')}</summary>
      <p className="mt-2 break-words">v{m?.version || unknown} · {m?.peerGroup || t('同类范围未知')}</p>
      <p className="mt-1">{t('数据覆盖率表示可计算的输入比例，不是准确率或上涨概率。')}</p>
      {m?.validation?.classificationStatus === 'needs_review' && <p className="mt-1" style={{ color: 'var(--warn)' }}>{t('资产分类尚缺一手来源核验。')}</p>}
      {counts.length > 0 && <p className="mt-1">{t('基本面各因子有效样本 {min}–{max} 个；不足 8 个不使用同类分位。', { min: Math.min(...counts), max: Math.max(...counts) })}</p>}
      {stock.leverageMultiple !== 1 && <p className="mt-1">{t('杠杆')} {stock.leverageMultiple ?? unknown} · {t(stock.direction === 'inverse' ? '反向' : '正向')} · {stock.underlyingSymbol || stock.benchmark || t('待核验')}</p>}
      {m?.qualityDeduction > 0 && <p className="mt-1">{t('杠杆封顶与波动磨损合计扣减 {n} 分', { n: m.qualityDeduction })}</p>}
      {(m?.warnings || []).map(w => <p className="mt-1" style={{ color: 'var(--warn)' }} key={w}>{t(w)}</p>)}
      {!stock.assetAssessment && <p className="mt-1">{t('缺失项不补中性分；有效分项重新分配权重。仅在同类资产中解释排名，旧版本评分变化不接续。')}</p>}
    </details>
  </section>;
}
