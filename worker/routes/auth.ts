import { Hono } from 'hono';
import { z } from 'zod';
import { DUMMY_HASH, hashPassword, passwordProblem, randomToken, sha256Hex, verifyPassword } from '../../shared/password';
import {
  type AppEnv, HttpError, auditStmt, bad, clearSessionCookie, clientIp, now, readJson, requireAuth,
  sessionExpiry, sessionToken, setSessionCookie, toSessionUser,
} from '../lib';

const auth = new Hono<AppEnv>();

const WINDOW_MS = 15 * 60_000;
const MAX_PER_USER_IP = 5;
const MAX_PER_IP = 30;

interface Attempt { key: string; count: number; window_start: number; locked_until: number }

async function assertNotLocked(db: D1Database, keys: string[]) {
  const t = Date.now();
  for (const key of keys) {
    const a = await db.prepare('SELECT * FROM login_attempts WHERE key = ?').bind(key).first<Attempt>();
    if (a && a.locked_until > t) {
      const mins = Math.ceil((a.locked_until - t) / 60_000);
      throw new HttpError(429, 'locked', `Terlalu banyak cubaan. Cuba lagi dalam ${mins} minit`);
    }
  }
}

async function recordFailure(db: D1Database, key: string, max: number) {
  const t = Date.now();
  const a = await db.prepare('SELECT * FROM login_attempts WHERE key = ?').bind(key).first<Attempt>();
  const fresh = !a || t - a.window_start > WINDOW_MS;
  const count = fresh ? 1 : a.count + 1;
  const windowStart = fresh ? t : a.window_start;
  const lockedUntil = count >= max ? t + WINDOW_MS : 0;
  await db
    .prepare(
      `INSERT INTO login_attempts (key, count, window_start, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, locked_until = excluded.locked_until`,
    )
    .bind(key, count, windowStart, lockedUntil)
    .run();
}

const LoginBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) });

auth.post('/login', async (c) => {
  const parsed = LoginBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Nama pengguna dan kata laluan diperlukan');
  const { username, password } = parsed.data;
  const db = c.env.DB;
  const ip = clientIp(c);
  const userKey = `u:${username.toLowerCase()}|${ip}`;
  const ipKey = `ip:${ip}`;
  await assertNotLocked(db, [userKey, ipKey]);

  const row = await db
    .prepare('SELECT id, username, name, role, zone_id, team_id, must_change_password, password_hash, active FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: number; username: string; name: string; role: any; zone_id: number | null; team_id: number | null; must_change_password: number; password_hash: string; active: number }>();
  // Sentiasa jalankan PBKDF2 walaupun pengguna tak wujud, supaya masa respons tak bocorkan nama pengguna.
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) {
    await recordFailure(db, userKey, MAX_PER_USER_IP);
    await recordFailure(db, ipKey, MAX_PER_IP);
    throw new HttpError(401, 'invalid_login', 'Nama pengguna atau kata laluan salah');
  }

  const token = randomToken();
  const t = now();
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), row.id, t, sessionExpiry()),
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(t, row.id),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(userKey),
    auditStmt(db, row, 'login', 'user', row.id),
  ]);
  setSessionCookie(c, token);
  return c.json({ user: toSessionUser(row) });
});

auth.post('/logout', async (c) => {
  const token = sessionToken(c);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));

const PasswordBody = z.object({ current: z.string().min(1).max(128), next: z.string().min(1).max(128) });

auth.post('/password', requireAuth, async (c) => {
  const parsed = PasswordBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Kata laluan semasa dan baharu diperlukan');
  const { current, next } = parsed.data;
  const u = c.get('user');
  const db = c.env.DB;
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) throw bad('Kata laluan semasa salah');
  const problem = passwordProblem(next);
  if (problem) throw bad(problem);
  if (next === current) throw bad('Kata laluan baharu mesti berbeza');

  // Semua sesi lama dibatalkan; sesi baharu dikeluarkan untuk peranti ini.
  const token = randomToken();
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(await hashPassword(next), u.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), u.id, now(), sessionExpiry()),
    auditStmt(db, u, 'password.change', 'user', u.id),
  ]);
  setSessionCookie(c, token);
  return c.json({ user: { ...u, must_change_password: false } });
});

export default auth;
