// Klien API: semua panggilan guna kuki sesi (same-origin). Ralat dibaling sebagai ApiError.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (code: 'unauthenticated' | 'must_change_password') => void;
let authHandler: Handler | null = null;
export const onAuthProblem = (h: Handler) => {
  authHandler = h;
};

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'network', 'Tiada sambungan. Semak internet dan cuba lagi');
  }
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const code = data?.error ?? 'error';
    if (res.status === 401 && path !== '/auth/login') authHandler?.('unauthenticated');
    if (code === 'must_change_password') authHandler?.('must_change_password');
    throw new ApiError(res.status, code, data?.message ?? `Ralat (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, undefined, form),
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Ralat tidak dijangka');
