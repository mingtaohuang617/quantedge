import { proxyToBackend } from '../_lib/backendProxy.js';

export const config = { maxDuration: 60 };

export default function handler(req, res) {
  return proxyToBackend(req, res, 'smart-beta/snapshot');
}
