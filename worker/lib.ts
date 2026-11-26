import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { can, type Perm, type Role, type SessionUser } from '../shared/types';
import { sha256Hex } from '../shared/password';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
}
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
export type Ctx = Context<AppEnv>;

export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const bad = (message: string) => new HttpError(400, 'bad_request', message);
export const notFound = (message = 'Rekod tidak dijumpai') => new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Anda tiada kebenaran untuk tindakan ini') => new HttpError(403, 'forbidden', message);

export async function readJson(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw bad('Badan permintaan bukan JSON yang sah');
  }
}

export function intParam(value: string | undefined, name = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Parameter ${name} tidak sah`);
  return n;
}

// ---------- Sesi ----------
const SESSION_DAYS = 7;
const cookieName = (c: Ctx) => (new URL(c.req.url).protocol === 'https:' ? '__Host-sid' : 'sid');

export function setSessionCookie(c: Ctx, token: string) {
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}
export function clearSessionCookie(c: Ctx) {
  const secure = new URL(c.req.url).protocol === 'https:';
  deleteCookie(c, cookieName(c), { path: '/', secure });
}
export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
export const sessionToken = (c: Ctx) => getCookie(c, cookieName(c));

interface UserDbRow {
  id: number; username: string; name: string; role: Role;
  zone_id: number | null; team_id: number | null; must_change_password: number;
}
export const toSessionUser = (r: UserDbRow): SessionUser => ({
  id: r.id,
  username: r.username,
  name: r.name,
  role: r.role,
  zone_id: r.zone_id,
  team_id: r.team_id,
  must_change_password: !!r.must_change_password,
});

/**
 * Pertahanan CSRF: sesi guna kuki, jadi setiap permintaan yang mengubah data mesti datang
 * dari origin kita sendiri. SameSite sahaja tak cukup kerana subdomain *.workers.dev lain
 * dikira "same-site".
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('origin');
    const host = c.req.header('host');
    let ok = false;
    if (origin) {
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
    } else {
      ok = c.req.header('sec-fetch-site') === 'same-origin';
    }
    if (!ok) throw new HttpError(403, 'bad_origin', 'Permintaan ditolak (origin tidak sah)');
  }
  await next();
};

// Laluan yang masih dibenarkan semasa pengguna wajib tukar kata laluan.
const PASSWORD_GATE_ALLOW = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);

/** Muat pengguna dari sesi. Role dibaca dari DB setiap kali, jadi perubahan role berkuat kuasa serta-merta. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = sessionToken(c);
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sila log masuk');
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role, u.zone_id, u.team_id, u.must_change_password
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(await sha256Hex(token), now())
    .first<UserDbRow>();
  if (!row) {
    clearSessionCookie(c);
    throw new HttpError(401, 'unauthenticated', 'Sesi tamat. Sila log masuk semula');
  }
  const user = toSessionUser(row);
  if (user.must_change_password && !PASSWORD_GATE_ALLOW.has(new URL(c.req.url).pathname)) {
    throw new HttpError(403, 'must_change_password', 'Sila tukar kata laluan dahulu');
  }
  c.set('user', user);
  await next();
};

export function requirePerm(perm: Perm): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!can(c.get('user').role, perm)) throw forbidden();
    await next();
  };
}

// ---------- Skop zon / team ----------
/** Klausa SQL yang mengehadkan baris kepada zon pengguna. Super admin nampak semua. */
export function zoneScope(u: SessionUser, column = 'zone_id'): { sql: string; args: unknown[] } {
  if (u.role === 'super_admin') return { sql: '1 = 1', args: [] };
  return { sql: `${column} = ?`, args: [u.zone_id ?? -1] };
}
export const inZone = (u: SessionUser, zoneId: number) => u.role === 'super_admin' || (u.zone_id !== null && u.zone_id === zoneId);

/** Bolehkah pengguna ubah tiang ini? Operator hanya untuk tiang team sendiri. */
export function canWritePole(u: SessionUser, pole: { zone_id: number; team_id: number | null }): boolean {
  if (u.role === 'super_admin') return true;
  if (!inZone(u, pole.zone_id)) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'operator') return u.team_id !== null && pole.team_id === u.team_id;
  return false;
}

// ---------- Pembantu batch ----------
export function auditStmt(
  db: D1Database,
  u: Pick<SessionUser, 'id' | 'name'> | null,
  action: string,
  entity: string | null,
  entityId: string | number | null,
  detail?: unknown,
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit_log (actor_id, actor_name, action, entity, entity_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(u?.id ?? null, u?.name ?? null, action, entity, entityId === null ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail), now());
}

/** Naikkan nombor semakan zon; klien hanya muat semula data peta bila nombor ini berubah. */
export const bumpRev = (db: D1Database, zoneId: number) => db.prepare('UPDATE zones SET rev = rev + 1 WHERE id = ?').bind(zoneId);

export function eventStmt(
  db: D1Database,
  e: { pole_id: number; zone_id: number; defect_id?: number | null; stage: string; user: Pick<SessionUser, 'id' | 'name'>; note?: string | null; at?: string },
): D1PreparedStatement {
  return db
    .prepare('INSERT INTO stage_events (pole_id, zone_id, defect_id, stage, actor_id, actor_name, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(e.pole_id, e.zone_id, e.defect_id ?? null, e.stage, e.user.id, e.user.name, e.note ?? null, e.at ?? now());
}

export const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? 'local';
