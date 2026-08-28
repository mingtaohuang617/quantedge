import crypto from 'node:crypto';
import { clearSessionCookie, requireOrigin, requireSession, sendError } from '../_lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }
  if (!requireOrigin(req, res)) return;
  if (!requireSession(req, res, { csrf: true })) return;
  const requestId = crypto.randomUUID();
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    data: { logged_out: true },
    meta: {
      as_of: new Date().toISOString(),
      source: 'quantedge-auth',
      cache_status: 'bypass',
      stale: false,
      quality: 'verified',
      schema_version: '1.0',
      request_id: requestId,
    },
  });
}
