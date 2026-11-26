import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword, passwordProblem, randomToken } from '../../shared/password';
import { SAMPLE_GROUPS, SAMPLE_TEAMS, SAMPLE_ZONE, samplePoles } from '../../shared/sample';
import { DEFECT_CATEGORY_INFO, ROLES, type Role, type UserRow } from '../../shared/types';
import { type AppEnv, HttpError, auditStmt, bad, bumpRev, inZone, intParam, notFound, now, readJson, requirePerm } from '../lib';

const admin = new Hono<AppEnv>();

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

// =====================================================================
// Pengguna & role (Super Admin sahaja)
// =====================================================================
const USER_SELECT = `
SELECT u.id, u.username, u.name, u.role, u.zone_id, u.team_id, z.name AS zone_name, t.name AS team_name,
       u.active, u.must_change_password, u.created_at, u.last_login_at
FROM users u LEFT JOIN zones z ON z.id = u.zone_id LEFT JOIN teams t ON t.id = u.team_id`;

admin.get('/users', requirePerm('user.manage'), async (c) => {
  const rows = await c.env.DB.prepare(`${USER_SELECT} ORDER BY u.active DESC, u.role, u.name`).all<UserRow>();
  return c.json({ users: rows.results });
});

/** Sahkan gabungan role + zon + team. Super admin tiada zon; yang lain wajib ada zon; operator wajib ada team. */
async function resolveScope(db: D1Database, role: Role, zoneId: number | null, teamId: number | null) {
  if (role === 'super_admin') return { zone_id: null, team_id: null };
  if (!zoneId) throw bad('Sila pilih zon untuk pengguna ini');
  const zone = await db.prepare('SELECT id FROM zones WHERE id = ?').bind(zoneId).first();
  if (!zone) throw bad('Zon tidak sah');
  if (role === 'operator' && !teamId) throw bad('Operator mesti diberi team');
  if (teamId) {
    const team = await db.prepare('SELECT zone_id FROM teams WHERE id = ?').bind(teamId).first<{ zone_id: number }>();
    if (!team || team.zone_id !== zoneId) throw bad('Team tidak sah untuk zon ini');
  }
  return { zone_id: zoneId, team_id: role === 'operator' ? teamId : null };
}

const CreateUser = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'nama pengguna'),
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  zone_id: z.number().int().positive().nullish(),
  team_id: z.number().int().positive().nullish(),
  password: z.string().min(1).max(128),
});

admin.post('/users', requirePerm('user.manage'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const parsed = CreateUser.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Nama pengguna mesti 3-32 aksara (huruf kecil, nombor, titik, sengkang) dan nama penuh diperlukan');
  const b = parsed.data;
  const problem = passwordProblem(b.password);
  if (problem) throw bad(problem);
  const scope = await resolveScope(db, b.role, b.zone_id ?? null, b.team_id ?? null);
  try {
    // Kata laluan yang diberi admin adalah sementara: pengguna wajib tukar pada login pertama.
    const row = await db
      .prepare(
        `INSERT INTO users (username, name, password_hash, role, zone_id, team_id, active, must_change_password, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?) RETURNING id`,
      )
      .bind(b.username, b.name, await hashPassword(b.password), b.role, scope.zone_id, scope.team_id, now())
      .first<{ id: number }>();
    await auditStmt(db, u, 'user.create', 'user', row!.id, { username: b.username, role: b.role, ...scope }).run();
    return c.json({ id: row!.id }, 201);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'Nama pengguna sudah digunakan');
    throw e;
  }
});

const UpdateUser = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  zone_id: z.number().int().positive().nullable().optional(),
  team_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

admin.patch('/users/:id', requirePerm('user.manage'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const id = intParam(c.req.param('id'));
  const parsed = UpdateUser.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Data pengguna tidak sah');
  const b = parsed.data;
  const target = await db.prepare('SELECT id, name, role, zone_id, team_id, active FROM users WHERE id = ?').bind(id).first<{ id: number; name: string; role: Role; zone_id: number | null; team_id: number | null; active: number }>();
  if (!target) throw notFound('Pengguna tidak dijumpai');

  const role = b.role ?? target.role;
  const active = b.active === undefined ? target.active : b.active ? 1 : 0;
  const scope = await resolveScope(db, role, b.zone_id === undefined ? target.zone_id : b.zone_id, b.team_id === undefined ? target.team_id : b.team_id);
  const name = b.name ?? target.name;

  // Sistem mesti sentiasa ada sekurang-kurangnya seorang Super Admin aktif. Semakan dibuat dalam
  // UPDATE yang sama (atomik), jadi dua permintaan serentak tak boleh sama-sama lulus.
  const losesSuper = target.role === 'super_admin' && target.active === 1 && (role !== 'super_admin' || active === 0);
  const guard = losesSuper ? " AND (SELECT COUNT(*) FROM users o WHERE o.role = 'super_admin' AND o.active = 1 AND o.id != users.id) >= 1" : '';
  const res = await db
    .prepare(`UPDATE users SET name = ?, role = ?, zone_id = ?, team_id = ?, active = ? WHERE id = ?${guard}`)
    .bind(name, role, scope.zone_id, scope.team_id, active, id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'last_super_admin', 'Mesti ada sekurang-kurangnya seorang Super Admin yang aktif');

  const accessChanged = role !== target.role || active !== target.active || scope.zone_id !== target.zone_id || scope.team_id !== target.team_id;
  const stmts = [auditStmt(db, u, 'user.update', 'user', id, { name, role, ...scope, active })];
  // Bila akses berubah, semua sesi pengguna itu dibatalkan supaya kebenaran lama tak kekal.
  if (accessChanged) stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await db.batch(stmts);
  return c.json({ ok: true });
});

const ResetBody = z.object({ password: z.string().min(1).max(128) });

admin.post('/users/:id/reset-password', requirePerm('user.manage'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const id = intParam(c.req.param('id'));
  const parsed = ResetBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Kata laluan diperlukan');
  const problem = passwordProblem(parsed.data.password);
  if (problem) throw bad(problem);
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) throw notFound('Pengguna tidak dijumpai');
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').bind(await hashPassword(parsed.data.password), id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    auditStmt(db, u, 'user.reset_password', 'user', id),
  ]);
  return c.json({ ok: true });
});

// =====================================================================
// Data induk: zon (super admin), team & pencawang (admin dalam zon sendiri)
// =====================================================================
const NameBody = z.object({ name: z.string().trim().min(2).max(60) });

admin.post('/zones', requirePerm('user.manage'), async (c) => {
  const u = c.get('user');
  const parsed = NameBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Nama zon diperlukan');
  try {
    const row = await c.env.DB.prepare('INSERT INTO zones (name, created_at) VALUES (?, ?) RETURNING id').bind(parsed.data.name.toUpperCase(), now()).first<{ id: number }>();
    await auditStmt(c.env.DB, u, 'zone.create', 'zone', row!.id, { name: parsed.data.name }).run();
    return c.json({ id: row!.id }, 201);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'Zon ini sudah wujud');
    throw e;
  }
});

const TeamBody = z.object({ zone_id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(40) });

admin.post('/teams', requirePerm('master.manage'), async (c) => {
  const u = c.get('user');
  const parsed = TeamBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Nama team diperlukan');
  const zoneId = u.role === 'super_admin' ? parsed.data.zone_id : u.zone_id;
  if (!zoneId) throw bad('Sila pilih zon');
  const zone = await c.env.DB.prepare('SELECT id FROM zones WHERE id = ?').bind(zoneId).first();
  if (!zone) throw bad('Zon tidak sah');
  try {
    const row = await c.env.DB.prepare('INSERT INTO teams (zone_id, name, created_at) VALUES (?, ?, ?) RETURNING id').bind(zoneId, parsed.data.name.toUpperCase(), now()).first<{ id: number }>();
    await auditStmt(c.env.DB, u, 'team.create', 'team', row!.id, { zone_id: zoneId, name: parsed.data.name }).run();
    return c.json({ id: row!.id }, 201);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'Team ini sudah wujud dalam zon tersebut');
    throw e;
  }
});

const SubBody = z.object({
  zone_id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(1).max(40),
  functional_location: z.string().trim().max(80).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

admin.post('/substations', requirePerm('master.manage'), async (c) => {
  const u = c.get('user');
  const parsed = SubBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Nama dan kod pencawang diperlukan');
  const b = parsed.data;
  const zoneId = u.role === 'super_admin' ? b.zone_id : u.zone_id;
  if (!zoneId) throw bad('Sila pilih zon');
  const zone = await c.env.DB.prepare('SELECT id FROM zones WHERE id = ?').bind(zoneId).first();
  if (!zone) throw bad('Zon tidak sah');
  try {
    const row = await c.env.DB.prepare('INSERT INTO substations (zone_id, name, code, functional_location, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(zoneId, b.name.toUpperCase(), b.code.toUpperCase(), b.functional_location ?? null, b.lat ?? null, b.lng ?? null, now())
      .first<{ id: number }>();
    await auditStmt(c.env.DB, u, 'substation.create', 'substation', row!.id, { name: b.name, code: b.code }).run();
    return c.json({ id: row!.id }, 201);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'Kod pencawang ini sudah wujud dalam zon tersebut');
    throw e;
  }
});

admin.patch('/substations/:id', requirePerm('master.manage'), async (c) => {
  const u = c.get('user');
  const id = intParam(c.req.param('id'));
  const parsed = SubBody.omit({ zone_id: true }).partial().safeParse(await readJson(c));
  if (!parsed.success) throw bad('Data pencawang tidak sah');
  const sub = await c.env.DB.prepare('SELECT zone_id FROM substations WHERE id = ?').bind(id).first<{ zone_id: number }>();
  if (!sub || !inZone(u, sub.zone_id)) throw notFound('Pencawang tidak dijumpai');
  const b = parsed.data as Record<string, unknown>;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of ['name', 'code', 'functional_location', 'lat', 'lng']) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      args.push(typeof b[k] === 'string' && k !== 'functional_location' ? (b[k] as string).toUpperCase() : (b[k] ?? null));
    }
  }
  if (!sets.length) throw bad('Tiada perubahan');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE substations SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id),
      bumpRev(c.env.DB, sub.zone_id),
      auditStmt(c.env.DB, u, 'substation.update', 'substation', id, b),
    ]);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'Kod pencawang ini sudah wujud dalam zon tersebut');
    throw e;
  }
  return c.json({ ok: true });
});

// =====================================================================
// Audit log (Super Admin sahaja)
// =====================================================================
admin.get('/audit', requirePerm('audit.view'), async (c) => {
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.before) {
    where.push('id < ?');
    args.push(intParam(q.before, 'before'));
  }
  if (q.action?.trim()) {
    where.push('action LIKE ?');
    args.push(`${q.action.trim()}%`);
  }
  const rows = await c.env.DB.prepare(`SELECT id, actor_id, actor_name, action, entity, entity_id, detail, at FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
    .bind(...args, limit)
    .all();
  return c.json({ rows: rows.results });
});

// =====================================================================
// Data contoh (Super Admin sahaja). Dijana berperingkat: satu pencawang setiap panggilan,
// supaya setiap permintaan ringan dan kekal dalam had Workers/D1.
// =====================================================================
const SampleBody = z.object({ step: z.number().int().min(0).max(SAMPLE_GROUPS.length) });

/** Sisip banyak baris dengan beberapa pernyataan INSERT berbilang-baris (maks 100 parameter setiap satu). */
function bulkInsert(db: D1Database, table: string, cols: string[], rows: unknown[][]): D1PreparedStatement[] {
  const per = Math.max(1, Math.floor(100 / cols.length));
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const ph = `(${cols.map(() => '?').join(', ')})`;
    out.push(db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => ph).join(', ')}`).bind(...chunk.flat()));
  }
  return out;
}

admin.post('/sample', requirePerm('sample.manage'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const parsed = SampleBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Langkah tidak sah');
  const { step } = parsed.data;
  const total = SAMPLE_GROUPS.length;
  const t = now();

  if (step === 0) {
    const exists = await db.prepare('SELECT COUNT(*) AS n FROM substations WHERE is_sample = 1').first<{ n: number }>();
    if (exists?.n) throw new HttpError(409, 'exists', 'Data contoh sudah wujud. Padam dahulu sebelum jana semula');
    await db.prepare('INSERT INTO zones (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').bind(SAMPLE_ZONE, t).run();
    const zone = await db.prepare('SELECT id FROM zones WHERE name = ?').bind(SAMPLE_ZONE).first<{ id: number }>();
    const stmts = SAMPLE_TEAMS.map((name) => db.prepare('INSERT INTO teams (zone_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(zone_id, name) DO NOTHING').bind(zone!.id, name, t));
    for (const g of SAMPLE_GROUPS) {
      stmts.push(
        db.prepare('INSERT INTO substations (zone_id, name, code, functional_location, lat, lng, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(zone_id, code) DO NOTHING')
          .bind(zone!.id, g.name, g.code, g.fl, g.lat, g.lng, t),
      );
    }
    stmts.push(auditStmt(db, u, 'sample.create', 'zone', zone!.id));
    await db.batch(stmts);
    return c.json({ step, total, done: false });
  }

  const gi = step - 1;
  const g = SAMPLE_GROUPS[gi];
  const zone = await db.prepare('SELECT id FROM zones WHERE name = ?').bind(SAMPLE_ZONE).first<{ id: number }>();
  if (!zone) throw bad('Jalankan langkah 0 dahulu');
  const sub = await db.prepare('SELECT id FROM substations WHERE zone_id = ? AND code = ? AND is_sample = 1').bind(zone.id, g.code).first<{ id: number }>();
  if (!sub) throw bad('Jalankan langkah 0 dahulu');
  const already = await db.prepare('SELECT COUNT(*) AS n FROM poles WHERE substation_id = ?').bind(sub.id).first<{ n: number }>();
  if (already?.n) return c.json({ step, total, done: step >= total, skipped: true });
  const team = await db.prepare('SELECT id FROM teams WHERE zone_id = ? AND name = ?').bind(zone.id, g.team).first<{ id: number }>();
  const [maxPole, maxDefect] = await db.batch([db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM poles'), db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM defects')]);
  const poleBase = (maxPole.results[0] as { m: number }).m + 1;
  let defectId = (maxDefect.results[0] as { m: number }).m;

  const operator = `Operator ${g.team} (contoh)`;
  const adminName = 'Admin (contoh)';
  const poleRows: unknown[][] = [];
  const defectRows: unknown[][] = [];
  const eventRows: unknown[][] = [];
  const list = samplePoles(gi, Date.now());
  list.forEach((p, i) => {
    const id = poleBase + i;
    const statuses = p.defects.map((d) => d.status);
    const status = statuses.includes('belum') ? 'defect' : statuses.includes('sedang') ? 'sedang' : statuses.includes('selesai') ? 'selesai' : p.rondaanAt ? 'ok' : 'baru';
    const open = statuses.filter((s) => s !== 'disahkan').length;
    const last = [p.rondaanAt, ...p.defects.flatMap((d) => [d.startedAt, d.completedAt, d.verifiedAt])].filter(Boolean).sort().pop() ?? p.createdAt;
    poleRows.push([
      id, `RV-C${String(gi + 1)}${String(i + 1).padStart(4, '0')}${randomToken(2).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 2)}`, zone.id, sub.id, team?.id ?? null,
      p.no, p.lama, p.street, p.type, p.material, p.height, p.year, p.lat, p.lng, p.prev >= 0 ? poleBase + p.prev : null,
      status, open, p.defects.length, p.rondaanAt, operator, p.createdAt, last,
    ]);
    eventRows.push([id, zone.id, null, 'DAFTAR', operator, null, p.createdAt]);
    if (p.rondaanAt) eventRows.push([id, zone.id, null, 'RONDAAN', operator, null, p.rondaanAt]);
    for (const d of p.defects) {
      defectId++;
      const info = DEFECT_CATEGORY_INFO[d.category];
      defectRows.push([
        defectId, `contoh-${defectId}-${randomToken(6)}`, id, zone.id, d.category, info.task, d.severity, d.status, team?.id ?? null,
        operator, d.reportedAt, d.startedAt ?? null, d.completedAt ? operator : null, d.completedAt ?? null, d.verifiedAt ? adminName : null, d.verifiedAt ?? null,
      ]);
      eventRows.push([id, zone.id, defectId, 'DEFECT', operator, info.label, d.reportedAt]);
      if (d.startedAt) eventRows.push([id, zone.id, defectId, 'SEDANG', operator, null, d.startedAt]);
      if (d.completedAt) eventRows.push([id, zone.id, defectId, 'SELESAI', operator, null, d.completedAt]);
      if (d.verifiedAt) eventRows.push([id, zone.id, defectId, 'DISAHKAN', adminName, null, d.verifiedAt]);
    }
  });

  const stmts = [
    ...bulkInsert(db, 'poles', ['id', 'tag_code', 'zone_id', 'substation_id', 'team_id', 'no_tiang_rondaan', 'no_tiang_lama', 'street', 'pole_type', 'material', 'height_m', 'install_year',
      'lat', 'lng', 'prev_pole_id', 'status', 'open_defects', 'total_defects', 'last_rondaan_at', 'created_by_name', 'created_at', 'updated_at'], poleRows),
    db.prepare('UPDATE poles SET is_sample = 1 WHERE substation_id = ?').bind(sub.id),
    ...bulkInsert(db, 'defects', ['id', 'ref', 'pole_id', 'zone_id', 'category', 'task_type', 'severity', 'status', 'assigned_team_id',
      'reported_by_name', 'reported_at', 'started_at', 'completed_by_name', 'completed_at', 'verified_by_name', 'verified_at'], defectRows),
    db.prepare('UPDATE defects SET is_sample = 1 WHERE pole_id >= ? AND pole_id < ?').bind(poleBase, poleBase + list.length),
    ...bulkInsert(db, 'stage_events', ['pole_id', 'zone_id', 'defect_id', 'stage', 'actor_name', 'note', 'at'], eventRows),
    bumpRev(db, zone.id),
  ];
  for (let k = 0; k < stmts.length; k += 60) await db.batch(stmts.slice(k, k + 60));
  return c.json({ step, total, done: step >= total, poles: list.length });
});

admin.delete('/sample', requirePerm('sample.manage'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const keys = await db.prepare('SELECT ph.r2_key, ph.thumb_key FROM photos ph JOIN poles p ON p.id = ph.pole_id WHERE p.is_sample = 1').all<{ r2_key: string; thumb_key: string | null }>();
  const zones = await db.prepare('SELECT DISTINCT zone_id FROM poles WHERE is_sample = 1').all<{ zone_id: number }>();
  const sel = '(SELECT id FROM poles WHERE is_sample = 1)';
  const res = await db.batch([
    db.prepare(`DELETE FROM photos WHERE pole_id IN ${sel}`),
    db.prepare(`DELETE FROM stage_events WHERE pole_id IN ${sel}`),
    db.prepare(`DELETE FROM defects WHERE pole_id IN ${sel}`),
    db.prepare('DELETE FROM poles WHERE is_sample = 1'),
    // Pencawang contoh dikekalkan jika pengguna sudah daftar tiang sebenar di bawahnya.
    db.prepare('DELETE FROM substations WHERE is_sample = 1 AND NOT EXISTS (SELECT 1 FROM poles p WHERE p.substation_id = substations.id)'),
    ...zones.results.map((z) => bumpRev(db, z.zone_id)),
    auditStmt(db, u, 'sample.delete', null, null),
  ]);
  const all = keys.results.flatMap((k) => (k.thumb_key ? [k.r2_key, k.thumb_key] : [k.r2_key]));
  for (let i = 0; i < all.length; i += 500) await c.env.PHOTOS.delete(all.slice(i, i + 500));
  return c.json({ ok: true, poles: res[3].meta.changes });
});

export default admin;
