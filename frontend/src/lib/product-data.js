import registry from './product-registry.json' with { type: 'json' };
import snapshot from './product-observations.json' with { type: 'json' };

// Explicitly dated current research observations, independent of the price snapshot.
export function productEnrichment(stock) {
  const config = registry[stock.ticker];
  if (!config) return {};
  const record = snapshot.products[stock.ticker];
  return { ...config.metadata, classificationSource: config.source,
    ...(record && record.productDataAsOf >= (stock.productDataAsOf || '') ? record : {}) };
}
