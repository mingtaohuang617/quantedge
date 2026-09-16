// Dated issuer evidence, not an inference from a failed quote request.
// Retain the platform code; never manufacture current bars for ceased trading.
export const DAILY_INACTIVE = Object.freeze({
  EA: Object.freeze({
    reason: 'ceased_trading',
    effective_at: '2026-08-04',
    verified_at: '2026-09-16',
    source: 'https://www.ea.com/amp/news/ea-announces-completion-of-acquisition',
  }),
});
