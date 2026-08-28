import crypto from 'node:crypto';
import { getSession, requireOrigin, sendError } from '../_lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'method_not_allowed', 'Only GET is allowed');
  }
  if (!requireOrigin(req, res)) return;
  const session = getSession(req);
  if (!session) return sendError(res, 401, 'authentication_required', 'Session is missing or expired');
  const requestId = crypto.randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    data: {
      user: {
        id: session.sub,
        name: session.name,
        plan: session.plan,
        workspace_id: session.workspace_id,
        joinedAt: new Date(session.iat * 1000).toISOString(),
      },
      csrf_token: session.csrf,
      expires_at: new Date(session.exp * 1000).toISOString(),
    },
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
