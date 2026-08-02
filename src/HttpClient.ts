import type { LiveApiClient, LiveApiMethod, LiveApiRequest, LiveApiResponse } from './types.js';

interface LiveApiOptions {
  baseUrl: string;
  accessToken: string;
  liveId: string | number;
  fetch?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string, query: LiveApiRequest['query']): string {
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(baseUrl);
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : 'http://live-room-sdk.local';
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`, origin);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

function actionPath(path: string, liveId: string | number): string {
  return `${path.replace(/\/$/, '')}/${liveId}`;
}

function isFormPayload(data: unknown): data is FormData | URLSearchParams {
  return (
    (typeof FormData !== 'undefined' && data instanceof FormData)
    || (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams)
  );
}

export function createLiveApi(options: LiveApiOptions): LiveApiClient {
  const request = async <T>(method: LiveApiMethod, path: string, input: LiveApiRequest = {}): Promise<LiveApiResponse<T>> => {
    const requestFetch = options.fetch ?? globalThis.fetch;
    if (!requestFetch) {
      throw new Error('当前运行环境未提供 fetch');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Authori-zation': `Bearer ${options.accessToken}`,
      ...input.headers,
    };
    const init: RequestInit = { method, headers };
    if (input.signal) {
      init.signal = input.signal;
    }
    if (input.data !== undefined) {
      init.body = isFormPayload(input.data) ? input.data : JSON.stringify(input.data);
      if (!isFormPayload(input.data)) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await requestFetch(buildUrl(options.baseUrl, path, input.query), init);
    const text = await response.text();
    let data: LiveApiResponse<T>;
    try {
      data = JSON.parse(text) as LiveApiResponse<T>;
    } catch {
      throw new Error(`直播接口未返回 JSON：${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(data.message ?? data.msg ?? `直播接口请求失败 (${response.status})`);
    }

    return data;
  };

  return {
    request,
    get: (path, query) => query ? request('GET', path, { query }) : request('GET', path),
    post: (path, data) => request('POST', path, { data }),
    put: (path, data) => request('PUT', path, { data }),
    del: (path, data) => request('DELETE', path, { data }),
    getAction: (path, query) => query
      ? request('GET', actionPath(path, options.liveId), { query })
      : request('GET', actionPath(path, options.liveId)),
    postAction: (path, data) => request('POST', actionPath(path, options.liveId), { data }),
  };
}
