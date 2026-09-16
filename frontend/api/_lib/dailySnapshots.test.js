import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSession } from './auth.js';
import handler from './dailySnapshots.js';
const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}});
const request = (authenticated=true) => ({method:'GET',headers:{origin:'http://localhost:5173',cookie:authenticated?`__Host-qe_session=${createSession().token}`:''}});
beforeEach(()=>vi.stubEnv('QUANTEDGE_SESSION_SECRET','test-daily-session-secret-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
it('does not expose bundled market snapshots without an authenticated same-origin session',async()=>{
  const load=vi.fn();const unauth=response();await handler(request(false),unauth,load);expect(unauth.statusCode).toBe(401);
  const forbidden=request();forbidden.headers.origin='https://evil.test';const res=response();await handler(forbidden,res,load);expect(res.statusCode).toBe(403);expect(load).not.toHaveBeenCalled();
});
it('returns a private daily snapshot with its original timestamp',async()=>{
  const data={timeframe:'1D',generated_at:'2026-09-16T11:00:00Z',rows:[]};const res=response();await handler(request(),res,async()=>data);
  expect(res.body.data).toEqual(data);expect(res.headers['Cache-Control']).toContain('no-store');
});
it('reports missing or invalid snapshots without leaking internal paths',async()=>{
  const res=response();await handler(request(),res,async()=>{throw Error('/secret/path');});expect(res.statusCode).toBe(503);expect(JSON.stringify(res.body)).not.toContain('/secret/path');
  const invalid=response();await handler(request(),invalid,async()=>({timeframe:'60',rows:[]}));expect(invalid.statusCode).toBe(503);
});
it('does not accept snapshot writes',async()=>{
  const session=createSession();const req={method:'POST',headers:{origin:'http://localhost:5173',cookie:`__Host-qe_session=${session.token}`,'x-csrf-token':session.payload.csrf}};
  const load=vi.fn();const res=response();await handler(req,res,load);expect(res.statusCode).toBe(405);expect(load).not.toHaveBeenCalled();
});
