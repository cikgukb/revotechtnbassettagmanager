import { Hono } from 'hono';
import { z } from 'zod';
import { newTagCode, randomToken } from '../../shared/password';
import { recomputePoleSql } from '../../shared/stages';
import {
  DEFECT_CATEGORIES, DEFECT_CATEGORY_INFO, POLE_STATUS, SEVERITIES,
  type DefectRow, type GeoRow, type PhotoRow, type PoleProfile, type PoleRow, type StageEvent,
} from '../../shared/types';
import {
  type AppEnv, HttpError, auditStmt, bad, bumpRev, canWritePole, eventStmt, forbidden, inZone, intParam, notFound, now,
  readJson, requirePerm, zoneScope,
} from '../lib';

const poles = new Hono<AppEnv>();

export const POLE_SELECT = `
SELECT p.id, p.tag_code, p.zone_id, p.substation_id, p.team_id, p.no_tiang_rondaan, p.no_tiang_lama, p.street,
       p.pole_type, p.material, p.height_m, p.install_year, p.lat, p.lng, p.prev_pole_id, p.status,
       p.open_defects, p.total_defects, p.last_rondaan_at, p.photo_id, p.notes, p.created_by_name, p.created_at, p.updated_at,
       s.name AS substation_name, s.code AS substation_code, s.functional_location,
       z.name AS zone_name, t.name AS team_name
FROM poles p
JOIN substations s ON s.id = p.substation_id
JOIN zones z ON z.id = p.zone_id
LEFT JOIN teams t ON t.id = p.team_id`;

export const DEFECT_SELECT = `
SELECT d.id, d.pole_id, d.zone_id, d.category, d.task_type, d.severity, d.description, d.status,
       d.assigned_team_id, t.name AS team_name, d.reported_by_name, d.reported_at, d.started_at,
       d.completed_by, d.completed_by_name, d.completed_at, d.verified_by_name, d.verified_at
FROM defects d LEFT JOIN teams t ON t.id = d.assigned_team_id`;

/** Muat tiang dalam skop pengguna; di luar skop dilayan seperti tidak wujud (404). */
export async function loadPole(db: D1Database, u: AppEnv['Variables']['user'], id: number) {
  const pole = await db
    .prepare('SELECT id, zone_id, team_id, substation_id, no_tiang_rondaan, photo_id, tag_code FROM poles WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: number; zone_id: number; team_id: number | null; substation_id: number; no_tiang_rondaan: string; photo_id: number | null; tag_code: string }>();
  if (!pole || !inZone(u, pole.zone_id)) throw notFound('Tiang tidak dijumpai');
  return pole;
}

// ---- Data peta (padat) ----
poles.get('/geo', async (c) => {
  const u = c.get('user');
  const sc = zoneScope(u);
  const db = c.env.DB;
  const [rows, rev] = await Promise.all([
    db
      .prepare(`SELECT id, lat, lng, status, no_tiang_rondaan, substation_id, prev_pole_id, team_id FROM poles WHERE deleted_at IS NULL AND ${sc.sql}`)
      .bind(...sc.args)
      .raw<[number, number, number, string, string, number, number | null, number | null]>(),
    db.prepare(`SELECT COALESCE(SUM(rev), 0) AS rev FROM zones WHERE ${zoneScope(u, 'id').sql}`).bind(...sc.args).first<{ rev: number }>(),
  ]);
  const idx = Object.fromEntries(POLE_STATUS.map((s, i) => [s, i]));
  const out: GeoRow[] = rows.map((r) => [r[0], r[1], r[2], idx[r[3]] ?? 0, r[4], r[5], r[6], r[7]]);
  return c.json({ rev: rev?.rev ?? 0, poles: out });
});

// ---- Senarai (jadual) ----
poles.get('/', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const sc = zoneScope(u, 'p.zone_id');
  const where = ['p.deleted_at IS NULL', sc.sql];
  const args: unknown[] = [...sc.args];
  if (q.q?.trim()) {
    const like = `%${q.q.trim()}%`;
    where.push('(p.no_tiang_rondaan LIKE ? OR p.no_tiang_lama LIKE ? OR p.tag_code LIKE ? OR p.street LIKE ? OR s.name LIKE ? OR s.code LIKE ?)');
    args.push(like, like, like, like, like, like);
  }
  if (q.status && (POLE_STATUS as readonly string[]).includes(q.status)) {
    where.push('p.status = ?');
    args.push(q.status);
  }
  if (q.problem === '1') where.push("p.status IN ('defect', 'sedang', 'selesai')");
  if (q.substation_id) {
    where.push('p.substation_id = ?');
    args.push(intParam(q.substation_id, 'substation_id'));
  }
  if (q.team_id) {
    where.push('p.team_id = ?');
    args.push(intParam(q.team_id, 'team_id'));
  }
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const w = where.join(' AND ');
  const db = c.env.DB;
  const [total, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM poles p JOIN substations s ON s.id = p.substation_id WHERE ${w}`).bind(...args).first<{ n: number }>(),
    db.prepare(`${POLE_SELECT} WHERE ${w} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<PoleRow>(),
  ]);
  return c.json({ total: total?.n ?? 0, rows: rows.results });
});

// ---- Carian mengikut kod tag (imbasan QR) ----
poles.get('/tag/:code', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT id, zone_id FROM poles WHERE tag_code = ? AND deleted_at IS NULL')
    .bind(c.req.param('code').toUpperCase())
    .first<{ id: number; zone_id: number }>();
  if (!row || !inZone(u, row.zone_id)) throw notFound('Tag tidak dijumpai');
  return c.json({ id: row.id });
});

// ---- Profil penuh ----
poles.get('/:id', async (c) => {
  const u = c.get('user');
  const id = intParam(c.req.param('id'));
  await loadPole(c.env.DB, u, id);
  const db = c.env.DB;
  const [pole, defects, events, photos] = await db.batch([
    db.prepare(`${POLE_SELECT} WHERE p.id = ?`).bind(id),
    db.prepare(`${DEFECT_SELECT} WHERE d.pole_id = ? ORDER BY d.reported_at DESC, d.id DESC`).bind(id),
    db.prepare('SELECT id, pole_id, defect_id, stage, actor_name, note, at FROM stage_events WHERE pole_id = ? ORDER BY at DESC, id DESC LIMIT 200').bind(id),
    db.prepare('SELECT id, pole_id, defect_id, stage_event_id, kind, uploaded_by_name, created_at FROM photos WHERE pole_id = ? ORDER BY id DESC').bind(id),
  ]);
  const profile: PoleProfile = {
    pole: pole.results[0] as PoleRow,
    defects: defects.results as DefectRow[],
    events: events.results as StageEvent[],
    photos: photos.results as PhotoRow[],
  };
  return c.json(profile);
});

const text = (max: number) => z.string().trim().max(max).nullish();
const PoleBody = z.object({
  substation_id: z.number().int().positive(),
  no_tiang_rondaan: z.string().trim().min(1).max(40),
  no_tiang_lama: text(40),
  street: text(120),
  pole_type: text(40),
  material: text(40),
  height_m: z.number().min(1).max(60).nullish(),
  install_year: z.number().int().min(1950).max(2100).nullish(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  team_id: z.number().int().positive().nullish(),
  prev_pole_id: z.number().int().positive().nullish(),
  notes: text(1000),
});

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return `Medan ${i.path.join('.') || 'data'} tidak sah`;
};

async function checkTeam(db: D1Database, teamId: number, zoneId: number) {
  const t = await db.prepare('SELECT zone_id FROM teams WHERE id = ?').bind(teamId).first<{ zone_id: number }>();
  if (!t || t.zone_id !== zoneId) throw bad('Team tidak sah untuk zon ini');
}
async function checkPrev(db: D1Database, prevId: number, zoneId: number) {
  const p = await db.prepare('SELECT zone_id FROM poles WHERE id = ? AND deleted_at IS NULL').bind(prevId).first<{ zone_id: number }>();
  if (!p || p.zone_id !== zoneId) throw bad('Tiang sebelum tidak sah');
}

// ---- Daftar tiang ----
poles.post('/', requirePerm('pole.create'), async (c) => {
  const u = c.get('user');
  const parsed = PoleBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad(firstIssue(parsed.error));
  const b = parsed.data;
  const db = c.env.DB;
  const sub = await db.prepare('SELECT id, zone_id FROM substations WHERE id = ?').bind(b.substation_id).first<{ id: number; zone_id: number }>();
  if (!sub || !inZone(u, sub.zone_id)) throw notFound('Pencawang tidak dijumpai');

  // Operator sentiasa daftar atas nama team sendiri; nilai team dari klien diabaikan.
  let teamId: number | null;
  if (u.role === 'operator') {
    if (u.team_id === null) throw forbidden('Akaun operator ini belum diberi team');
    teamId = u.team_id;
  } else {
    teamId = b.team_id ?? null;
    if (teamId !== null) await checkTeam(db, teamId, sub.zone_id);
  }
  if (b.prev_pole_id) await checkPrev(db, b.prev_pole_id, sub.zone_id);

  const tag = newTagCode();
  const t = now();
  try {
    const res = await db.batch([
      db
        .prepare(
          `INSERT INTO poles (tag_code, zone_id, substation_id, team_id, no_tiang_rondaan, no_tiang_lama, street, pole_type, material,
             height_m, install_year, lat, lng, prev_pole_id, notes, created_by, created_by_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(tag, sub.zone_id, sub.id, teamId, b.no_tiang_rondaan, b.no_tiang_lama ?? null, b.street ?? null, b.pole_type ?? null,
          b.material ?? null, b.height_m ?? null, b.install_year ?? null, b.lat, b.lng, b.prev_pole_id ?? null, b.notes ?? null, u.id, u.name, t, t),
      db
        .prepare(
          `INSERT INTO stage_events (pole_id, zone_id, stage, actor_id, actor_name, note, at)
           VALUES ((SELECT id FROM poles WHERE tag_code = ?), ?, 'DAFTAR', ?, ?, NULL, ?)`,
        )
        .bind(tag, sub.zone_id, u.id, u.name, t),
      bumpRev(db, sub.zone_id),
    ]);
    const id = (res[0].results[0] as { id: number }).id;
    await auditStmt(db, u, 'pole.create', 'pole', id, { no: b.no_tiang_rondaan, tag }).run();
    return c.json({ id, tag_code: tag }, 201);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'No tiang ini sudah wujud untuk pencawang tersebut');
    throw e;
  }
});

// ---- Edit biodata (admin) ----
const EDITABLE = ['substation_id', 'no_tiang_rondaan', 'no_tiang_lama', 'street', 'pole_type', 'material', 'height_m', 'install_year', 'lat', 'lng', 'team_id', 'prev_pole_id', 'notes'] as const;

poles.patch('/:id', requirePerm('pole.edit'), async (c) => {
  const u = c.get('user');
  const id = intParam(c.req.param('id'));
  const db = c.env.DB;
  const pole = await loadPole(db, u, id);
  const parsed = PoleBody.partial().safeParse(await readJson(c));
  if (!parsed.success) throw bad(firstIssue(parsed.error));
  const b = parsed.data as Record<string, unknown>;

  let zoneId = pole.zone_id;
  if (typeof b.substation_id === 'number' && b.substation_id !== pole.substation_id) {
    const sub = await db.prepare('SELECT zone_id FROM substations WHERE id = ?').bind(b.substation_id).first<{ zone_id: number }>();
    if (!sub || !inZone(u, sub.zone_id)) throw notFound('Pencawang tidak dijumpai');
    zoneId = sub.zone_id;
  }
  if (typeof b.team_id === 'number') await checkTeam(db, b.team_id, zoneId);
  if (typeof b.prev_pole_id === 'number') {
    if (b.prev_pole_id === id) throw bad('Tiang sebelum tidak sah');
    await checkPrev(db, b.prev_pole_id, zoneId);
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in b && b[k] !== undefined) {
      sets.push(`${k} = ?`);
      args.push(b[k] ?? null);
      changed[k] = b[k] ?? null;
    }
  }
  if (!sets.length) throw bad('Tiada perubahan');
  const t = now();
  try {
    await db.batch([
      db.prepare(`UPDATE poles SET ${sets.join(', ')}, zone_id = ?, updated_at = ? WHERE id = ?`).bind(...args, zoneId, t, id),
      eventStmt(db, { pole_id: id, zone_id: zoneId, stage: 'KEMASKINI', user: u, at: t }),
      bumpRev(db, zoneId),
      auditStmt(db, u, 'pole.update', 'pole', id, changed),
    ]);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'duplicate', 'No tiang ini sudah wujud untuk pencawang tersebut');
    throw e;
  }
  return c.json({ ok: true });
});

// ---- Padam (soft delete) ----
poles.delete('/:id', requirePerm('pole.delete'), async (c) => {
  const u = c.get('user');
  const id = intParam(c.req.param('id'));
  const db = c.env.DB;
  const pole = await loadPole(db, u, id);
  const t = now();
  await db.batch([
    // No tiang ditukar supaya nombor yang sama boleh didaftar semula.
    db.prepare("UPDATE poles SET deleted_at = ?, updated_at = ?, no_tiang_rondaan = no_tiang_rondaan || ' #padam' || id WHERE id = ?").bind(t, t, id),
    db.prepare('UPDATE poles SET prev_pole_id = NULL WHERE prev_pole_id = ?').bind(id),
    bumpRev(db, pole.zone_id),
    auditStmt(db, u, 'pole.delete', 'pole', id, { no: pole.no_tiang_rondaan }),
  ]);
  return c.json({ ok: true });
});

// ---- Rondaan: rekod pemeriksaan + defect yang dijumpai ----
const RondaanBody = z.object({
  note: text(1000),
  defects: z
    .array(
      z.object({
        category: z.enum(DEFECT_CATEGORIES),
        severity: z.enum(SEVERITIES).default('sederhana'),
        description: text(500),
      }),
    )
    .max(10)
    .default([]),
});

poles.post('/:id/rondaan', requirePerm('rondaan.create'), async (c) => {
  const u = c.get('user');
  const id = intParam(c.req.param('id'));
  const db = c.env.DB;
  const pole = await loadPole(db, u, id);
  if (!canWritePole(u, pole)) throw forbidden('Tiang ini bukan di bawah team anda');
  const parsed = RondaanBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad(firstIssue(parsed.error));
  const { note, defects } = parsed.data;

  // Elak defect berganda: kategori yang masih terbuka pada tiang ini tidak dicipta semula.
  const open = await db.prepare("SELECT category FROM defects WHERE pole_id = ? AND status != 'disahkan'").bind(id).all<{ category: string }>();
  const openSet = new Set(open.results.map((r) => r.category));
  const seen = new Set<string>();
  const fresh = defects.filter((d) => !openSet.has(d.category) && !seen.has(d.category) && seen.add(d.category));

  const t = now();
  const stmts: D1PreparedStatement[] = [eventStmt(db, { pole_id: id, zone_id: pole.zone_id, stage: 'RONDAAN', user: u, note, at: t })];
  const refs: string[] = [];
  for (const d of fresh) {
    const ref = randomToken(12);
    refs.push(ref);
    const info = DEFECT_CATEGORY_INFO[d.category];
    stmts.push(
      db
        .prepare(
          `INSERT INTO defects (ref, pole_id, zone_id, category, task_type, severity, description, status, assigned_team_id, reported_by, reported_by_name, reported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'belum', ?, ?, ?, ?)`,
        )
        .bind(ref, id, pole.zone_id, d.category, info.task, d.severity, d.description ?? null, pole.team_id, u.id, u.name, t),
      db
        .prepare(
          `INSERT INTO stage_events (pole_id, zone_id, defect_id, stage, actor_id, actor_name, note, at)
           VALUES (?, ?, (SELECT id FROM defects WHERE ref = ?), 'DEFECT', ?, ?, ?, ?)`,
        )
        .bind(id, pole.zone_id, ref, u.id, u.name, info.label, t),
    );
  }
  stmts.push(
    db.prepare('UPDATE poles SET last_rondaan_at = ? WHERE id = ?').bind(t, id),
    db.prepare(recomputePoleSql('id = ?2')).bind(t, id),
    bumpRev(db, pole.zone_id),
    auditStmt(db, u, 'rondaan.create', 'pole', id, { defects: fresh.map((d) => d.category) }),
  );
  const res = await db.batch(stmts);
  const eventId = (res[0].results[0] as { id: number }).id;
  let defectIds: number[] = [];
  if (refs.length) {
    const rows = await db.prepare(`SELECT id FROM defects WHERE ref IN (${refs.map(() => '?').join(',')}) ORDER BY id`).bind(...refs).all<{ id: number }>();
    defectIds = rows.results.map((r) => r.id);
  }
  return c.json({ event_id: eventId, defect_ids: defectIds, skipped: defects.length - fresh.length }, 201);
});

export default poles;
