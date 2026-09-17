import policy from './validation-policy.json' with { type: 'json' };

export function scoreValidation(stock) {
  const requirements = policy.requirements[stock.assetType];
  return {
    contractVersion: policy.version, reviewedAt: policy.reviewedAt,
    predictiveStatus: requirements ? policy.predictiveStatus : 'unsupported',
    calculationStatus: stock.score != null ? 'composite_available' : stock.timingScore != null || stock.assetAssessment?.product?.score != null ? 'components_only' : 'insufficient_data',
    classificationStatus: stock.assetType === 'stock' ? 'not_reviewed' : stock.classificationSource ? 'source_linked' : 'needs_review',
    requirements: requirements || ['dedicated_model'],
    historicalValidationRequired: true, weightChangeAllowed: policy.weightChangeAllowed,
  };
}
