// API client for the built-in panel. Panel auth endpoints live under
// /panel/api/auth; management endpoints are mirrored under
// /panel/api/{v0,v8}/management with panel session auth.

export const PANEL_API = '/panel/api';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export function mgmtUrl(path: string): string {
  return `${PANEL_API}/v0/management${path}`;
}

export function mgmtV8Url(path: string): string {
  return `${PANEL_API}/v8/management${path}`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('panel:unauthorized'));
    throw new ApiError(401, 'authentication required');
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      const errField = obj.error ?? obj.message;
      if (typeof errField === 'string') message = errField;
      else if (errField != null) message = JSON.stringify(errField);
    } else if (typeof body === 'string' && body.trim()) {
      message = body.trim();
    }
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

async function request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const h: Record<string, string> = { ...(headers ?? {}) };
  const init: RequestInit = { method, headers: h };
  if (body !== undefined) {
    if (typeof body === 'string') {
      init.body = body;
      if (!h['Content-Type']) h['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      init.body = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  return handleResponse<T>(res);
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  raw: request,
};

// ---- panel auth ----

export interface AuthState {
  available: boolean;
  remote_allowed?: boolean;
  local_client?: boolean;
  setup_required?: boolean;
  authenticated?: boolean;
  session_remaining_seconds?: number;
  error?: string;
}

export const authApi = {
  state: () => api.get<AuthState>(`${PANEL_API}/auth/state`),
  setup: (password: string) => api.post<{ authenticated: boolean }>(`${PANEL_API}/auth/setup`, { password }),
  login: (password: string) => api.post<{ authenticated: boolean }>(`${PANEL_API}/auth/login`, { password }),
  logout: () => api.post<{ status: string }>(`${PANEL_API}/auth/logout`),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.put<{ status?: string }>(`${PANEL_API}/auth/password`, { old_password: oldPassword, new_password: newPassword }),
};

// ---- management helpers ----

export const mgmt = {
  get: <T>(path: string) => api.get<T>(mgmtUrl(path)),
  put: <T>(path: string, body: unknown) => api.put<T>(mgmtUrl(path), body),
  patch: <T>(path: string, body: unknown) => api.patch<T>(mgmtUrl(path), body),
  post: <T>(path: string, body?: unknown) => api.post<T>(mgmtUrl(path), body),
  del: <T>(path: string, body?: unknown) => api.del<T>(mgmtUrl(path), body),
};

export const mgmtV8 = {
  get: <T>(path: string) => api.get<T>(mgmtV8Url(path)),
  put: <T>(path: string, body: unknown) => api.put<T>(mgmtV8Url(path), body),
  patch: <T>(path: string, body: unknown) => api.patch<T>(mgmtV8Url(path), body),
  post: <T>(path: string, body?: unknown) => api.post<T>(mgmtV8Url(path), body),
  del: <T>(path: string, body?: unknown) => api.del<T>(mgmtV8Url(path), body),
};
