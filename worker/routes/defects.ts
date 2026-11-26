import { Hono } from 'hono';
import { z } from 'zod';
import { DEFECT_ACTIONS, type DefectAction, recomputePoleSql } from '../../shared/stages';
import { DEFECT_STATUS, TASK_TYPES, TASK_TYPE_LABEL, type DefectRow, type DefectStatus, type SessionUser, type TaskType } from '../../shared/types';
import {
  type AppEnv, HttpError, auditStmt, bad, bumpRev, eventStmt, forbidden, inZone, intParam, notFound, now, readJson,
  requirePerm, zoneScope,
} from '../lib';

const defects = new Hono<AppEnv>();

const BOARD_SELECT = `
SELECT d.id, d.pole_id, d.zone_id, d.category, d.task_type, d.severity, d.description, d.status,
       d.assigned_team_id, t.name AS team_name, d.reported_by_name, d.reported_at, d.started_at,
       d.completed_by, d.completed_by_name, d.completed_at, d.verified_by_name, d.verified_at,
       p.no_tiang_rondaan, p.street, p.team_id AS pole_team_id, s.name AS substation_name
FROM defects d
JOIN poles p ON p.id = d.pole_id
JOIN substations s ON s.id = p.substation_id
LEFT JOIN teams t ON t.id = d.assigned_team_id`;

// ---- Papan tugasan: empat lajur status ----
defects.get('/board', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const sc = zoneScope(u, 'd.zone_id');
  const where = ['p.deleted_at IS NULL', sc.sql];
  const args: unknown[] = [...sc.args];
  if (q.task_type && (TASK_TYPES as readonly string[]).includes(q.task_type)) {
    where.push('d.task_type = ?');
    args.push(q.task_type);
  }
  if (q.team_id) {
    where.push('d.assigned_team_id = ?');
    args.push(intParam(q.team_id, 'team_id'));
  }
  const w = where.join(' AND ');
  const db = c.env.DB;
  const per = 40;
  const order = "CASE d.severity WHEN 'tinggi' THEN 0 WHEN 'sederhana' THEN 1 ELSE 2 END";
  const res = await db.batch([
    db.prepare(`SELECT d.status, COUNT(*) AS n FROM defects d JOIN poles p ON p.id = d.pole_id WHERE ${w} GROUP BY d.status`).bind(...args),
    ...DEFECT_STATUS.map((s) =>
      db
        .prepare(
          `${BOARD_SELECT} WHERE ${w} AND d.status = ? ORDER BY ${s === 'disahkan' ? 'd.verified_at DESC' : `${order}, d.reported_at DESC`} LIMIT ?`,
        )
        .bind(...args, s, per),
    ),
  ]);
  const counts = Object.fromEntries(DEFECT_STATUS.map((s) => [s, 0])) as Record<DefectStatus, number>;
  for (const r of res[0].results as { status: DefectStatus; n: number }[]) counts[r.status] = r.n;
  const columns = Object.fromEntries(DEFECT_STATUS.map((s, i) => [s, res[i + 1].results as DefectRow[]])) as Record<DefectStatus, DefectRow[]>;
  return c.json({ counts, columns });
});

interface DefectCtx {
  id: number; pole_id: number; zone_id: number; status: DefectStatus; task_type: TaskType;
  assigned_team_id: number | null; completed_by: number | null; category: string;
}
async function loadDefect(db: D1Database, u: SessionUser, id: number): Promise<DefectCtx> {
  const d = await db
    .prepare(
      `SELECT d.id, d.pole_id, d.zone_id, d.status, d.task_type, d.assigned_team_id, d.completed_by, d.category
       FROM defects d JOIN poles p ON p.id = d.pole_id WHERE d.id = ? AND p.deleted_at IS NULL`,
    )
    .bind(id)
    .first<DefectCtx>();
  if (!d || !inZone(u, d.zone_id)) throw notFound('Defect tidak dijumpai');
  return d;
}

/** Operator hanya boleh kerjakan defect yang diagih kepada team sendiri. */
export function canWorkDefect(u: SessionUser, d: { zone_id: number; assigned_team_id: number | null }): boolean {
  if (u.role === 'super_admin') return true;
  if (!inZone(u, d.zone_id)) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'operator') return u.team_id !== null && d.assigned_team_id === u.team_id;
  return false;
}

// ---- Agih kepada team / tukar jenis tugasan (admin) ----
const AssignBody = z.object({ team_id: z.number().int().positive().nullable(), task_type: z.enum(TASK_TYPES).optional() });

defects.post('/:id/assign', requirePerm('defect.assign'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const d = await loadDefect(db, u, intParam(c.req.param('id')));
  const parsed = AssignBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Data agihan tidak sah');
  const { team_id, task_type } = parsed.data;
  if (d.status === 'disahkan') throw new HttpError(409, 'closed', 'Defect ini sudah ditutup');
  let teamName = 'tiada team';
  if (team_id !== null) {
    const t = await db.prepare('SELECT zone_id, name FROM teams WHERE id = ?').bind(team_id).first<{ zone_id: number; name: string }>();
    if (!t || t.zone_id !== d.zone_id) throw bad('Team tidak sah untuk zon ini');
    teamName = `team ${t.name}`;
  }
  const type = task_type ?? d.task_type;
  const res = await db.batch([
    eventStmt(db, { pole_id: d.pole_id, zone_id: d.zone_id, defect_id: d.id, stage: 'AGIH', user: u, note: `Diagih kepada ${teamName} (${TASK_TYPE_LABEL[type]})` }),
    db.prepare('UPDATE defects SET assigned_team_id = ?, task_type = ? WHERE id = ?').bind(team_id, type, d.id),
    db.prepare('UPDATE poles SET updated_at = ? WHERE id = ?').bind(now(), d.pole_id),
    bumpRev(db, d.zone_id),
    auditStmt(db, u, 'defect.assign', 'defect', d.id, { team_id, task_type: type }),
  ]);
  return c.json({ event_id: (res[0].results[0] as { id: number }).id });
});

// ---- Peralihan status: mula / siap / sahkan / tolak ----
async function transition(c: any, action: DefectAction, note: string | null) {
  const u: SessionUser = c.get('user');
  const db: D1Database = c.env.DB;
  const d = await loadDefect(db, u, intParam(c.req.param('id')));
  const tr = DEFECT_ACTIONS[action];
  if (d.status !== tr.from) throw new HttpError(409, 'bad_transition', 'Status defect sudah berubah. Muat semula dan cuba lagi');

  if (action === 'start' || action === 'complete') {
    if (!canWorkDefect(u, d)) throw forbidden('Tugasan ini bukan untuk team anda');
  } else if (u.role !== 'super_admin' && d.completed_by === u.id) {
    // Pengasingan tugas: orang yang siapkan kerja tak boleh sahkan kerja sendiri.
    throw forbidden('Anda tidak boleh sahkan kerja yang anda sendiri siapkan');
  }

  const t = now();
  const sets: Record<DefectAction, { sql: string; args: unknown[] }> = {
    start: { sql: "status = 'sedang', started_by = ?, started_at = ?", args: [u.id, t] },
    complete: { sql: "status = 'selesai', completed_by = ?, completed_by_name = ?, completed_at = ?", args: [u.id, u.name, t] },
    verify: { sql: "status = 'disahkan', verified_by = ?, verified_by_name = ?, verified_at = ?", args: [u.id, u.name, t] },
    reject: { sql: "status = 'sedang', completed_by = NULL, completed_by_name = NULL, completed_at = NULL", args: [] },
  };
  const s = sets[action];
  const res = await db.batch([
    eventStmt(db, { pole_id: d.pole_id, zone_id: d.zone_id, defect_id: d.id, stage: tr.stage, user: u, note, at: t }),
    db.prepare(`UPDATE defects SET ${s.sql} WHERE id = ? AND status = ?`).bind(...s.args, d.id, tr.from),
    db.prepare(recomputePoleSql('id = ?2')).bind(t, d.pole_id),
    bumpRev(db, d.zone_id),
    auditStmt(db, u, `defect.${action}`, 'defect', d.id, note ? { note } : undefined),
  ]);
  return c.json({ event_id: (res[0].results[0] as { id: number }).id, status: tr.to });
}

const NoteBody = z.object({ note: z.string().trim().max(1000).nullish() });
async function readNote(c: any): Promise<string | null> {
  const parsed = NoteBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Catatan tidak sah');
  return parsed.data.note || null;
}

defects.post('/:id/start', requirePerm('defect.work'), async (c) => transition(c, 'start', await readNote(c)));
defects.post('/:id/complete', requirePerm('defect.work'), async (c) => transition(c, 'complete', await readNote(c)));
defects.post('/:id/verify', requirePerm('defect.verify'), async (c) => transition(c, 'verify', await readNote(c)));
defects.post('/:id/reject', requirePerm('defect.verify'), async (c) => {
  const note = await readNote(c);
  if (!note) throw bad('Sila nyatakan sebab ditolak');
  return transition(c, 'reject', note);
});

export default defects;
