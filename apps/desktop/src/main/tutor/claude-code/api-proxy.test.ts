import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiProxy } from './api-proxy';
import { startMockApi, type MockApi } from './fixtures/mock-messages-api';

let api: MockApi;
let relay: ApiProxy;
let key: string | null;
let base: string;

beforeEach(async () => {
  api = await startMockApi('ok');
  key = 'sk-ant-real';
  relay = new ApiProxy({ apiKey: () => key, upstream: () => api.url + '/' });
  base = await relay.start();
});
afterEach(async () => {
  await relay.stop();
  await api.close();
});

const post = (path: string, headers: Record<string, string>, body = '{"stream":true}') =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

describe('the API relay', () => {
  it('forwards Messages requests with the real key in place of the turn token', async () => {
    const token = relay.mint();
    const res = await post('/v1/messages?beta=true', {
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'x',
      cookie: 'c=1',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toContain('message_stop');
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toMatchObject({
      path: '/v1/messages?beta=true',
      apiKey: 'sk-ant-real',
      authorization: null,
    });
  });

  it('takes the token as a bearer too, and forwards count_tokens', async () => {
    const token = relay.mint();
    const res = await post('/v1/messages/count_tokens', { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ input_tokens: 10 });
    expect(api.requests[0]!.apiKey).toBe('sk-ant-real');
    expect(api.requests[0]!.authorization).toBeNull();
  });

  it('refuses unknown, revoked and missing tokens without contacting the API', async () => {
    const token = relay.mint();
    relay.revoke(token);
    for (const h of [{ 'x-api-key': token }, { 'x-api-key': 'sk-ant-real' }, {}]) {
      const res = await post('/v1/messages', h);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        type: 'error',
        error: { type: 'authentication_error' },
      });
    }
    expect(api.requests).toEqual([]);
  });

  it('forwards only POST to the Messages endpoints', async () => {
    const token = relay.mint();
    for (const path of ['/v1/models', '/v1/files', '/v1/messages/batches', '/api/oauth']) {
      expect((await post(path, { 'x-api-key': token })).status).toBe(404);
    }
    const get = await fetch(`${base}/v1/messages`, { headers: { 'x-api-key': token } });
    expect(get.status).toBe(404);
    expect(api.requests).toEqual([]);
  });

  it('answers 401 when the app has no key', async () => {
    key = null;
    const res = await post('/v1/messages', { 'x-api-key': relay.mint() });
    expect(res.status).toBe(401);
    expect(api.requests).toEqual([]);
  });

  it('passes API errors through unchanged', async () => {
    const authApi = await startMockApi('auth');
    const r = new ApiProxy({ apiKey: () => 'sk-ant-bad', upstream: () => authApi.url });
    const url = await r.start();
    const res = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': r.mint(), 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { message: 'invalid x-api-key' } });
    await r.stop();
    await authApi.close();
  });

  it('reports an unreachable API as 502 without details', async () => {
    const r = new ApiProxy({ apiKey: () => 'sk-ant-x', upstream: () => 'http://127.0.0.1:9' });
    const url = await r.start();
    const res = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': r.mint() },
      body: '{}',
    });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant');
    await r.stop();
  });
});
