import { request } from '@playwright/test';
import { BASE, PASSWORD } from './helpers';

/** Jana data contoh sekali sebelum semua ujian (sebagai Super Admin, melalui API sebenar). */
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const login = await ctx.post('/api/auth/login', { data: { username: 'superadmin', password: PASSWORD } });
  if (!login.ok()) throw new Error(`Login superadmin gagal: ${login.status()}`);
  for (let step = 0; ; step++) {
    const res = await ctx.post('/api/admin/sample', { data: { step } });
    if (res.status() === 409) break; // sudah wujud
    if (!res.ok()) throw new Error(`Jana data contoh gagal pada langkah ${step}: ${res.status()} ${await res.text()}`);
    if ((await res.json()).done) break;
  }
  await ctx.dispose();
}
