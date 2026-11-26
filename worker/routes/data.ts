import { Hono } from 'hono';
import { z } from 'zod';
import { newTagCode, randomToken } from '../../shared/password';
import { DEFECT_COLUMNS, toCsv } from '../../shared/savr';
import { recomputePoleSql } from '../../shared/stages';
import {
  DEFECT_CATEGORIES, DEFECT_CATEGORY_INFO, POLE_STATUS, POLE_STATUS_LABEL,
  type Meta, type PoleRow, type PoleStatus, type Stats,
} from '../../shared/types';
import { type AppEnv, auditStmt, bad, bumpRev, notFound, now, readJson, requirePerm, zoneScope } from '../lib';
import { POLE_SELECT } from './poles';

const data = new Hono<AppEnv>();

// ---- Data rujukan: zon, team, pencawang dalam skop pengguna ----
data.get('/meta', async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const byId = zoneScope(u, 'id');
  const byZone = zoneScope(u);
  const [zones, teams, subs] = await db.batch([
    db.prepare(`SELECT id, name FROM zones WHERE ${byId.sql} ORDER BY name`).bind(...byId.args),
    db.prepare(`SELECT id, zone_id, name FROM teams WHERE ${byZone.sql} ORDER BY name`).bind(...byZone.args),
    db.prepare(`SELECT id, zone_id, name, code, functional_location, lat, lng FROM substations WHERE ${byZone.sql} ORDER BY name`).bind(...byZone.args),
  ]);
  return c.json({ zones: zones.results, teams: teams.results, substations: subs.results } as Meta);
});

// ---- Nombor semakan: semakan murah (beberapa baris) yang klien tinjau setiap ~20 saat ----
data.get('/rev', async (c) => {
  const sc = zoneScope(c.get('user'), 'id');
  const row = await c.env.DB.prepare(`SELECT COALESCE(SUM(rev), 0) AS rev FROM zones WHERE ${sc.sql}`).bind(...sc.args).first<{ rev: number }>();
  return c.json({ rev: row?.rev ?? 0 });
});

// ---- Statistik dashboard ----
data.get('/stats', async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const p = zoneScope(u, 'p.zone_id');
  const d = zoneScope(u, 'd.zone_id');
  const s = zoneScope(u, 's.zone_id');
  const e = zoneScope(u, 'e.zone_id');
  const since = new Date(Date.now() - 13 * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10);
  const res = await db.batch([
    db.prepare(`SELECT p.status, COUNT(*) AS n FROM poles p WHERE p.deleted_at IS NULL AND ${p.sql} GROUP BY p.status`).bind(...p.args),
    db.prepare(`SELECT d.task_type, d.status, COUNT(*) AS n FROM defects d JOIN poles p ON p.id = d.pole_id WHERE p.deleted_at IS NULL AND ${d.sql} GROUP BY d.task_type, d.status`).bind(...d.args),
    db.prepare(`SELECT d.category, COUNT(*) AS n, SUM(d.status != 'disahkan') AS open FROM defects d JOIN poles p ON p.id = d.pole_id WHERE p.deleted_at IS NULL AND ${d.sql} GROUP BY d.category ORDER BY n DESC`).bind(...d.args),
    db.prepare(
      `SELECT p.team_id, COALESCE(t.name, 'Tiada team') AS team_name, COUNT(*) AS poles,
              SUM(p.last_rondaan_at IS NOT NULL) AS dironda, SUM(p.open_defects) AS open_defects,
              SUM(p.total_defects - p.open_defects) AS closed_defects
       FROM poles p LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.deleted_at IS NULL AND ${p.sql} GROUP BY p.team_id ORDER BY team_name`,
    ).bind(...p.args),
    db.prepare(
      `SELECT s.id, s.name, s.code, COUNT(p.id) AS poles,
              COALESCE(SUM(p.status IN ('defect', 'sedang', 'selesai')), 0) AS problem,
              COALESCE(SUM(p.last_rondaan_at IS NOT NULL), 0) AS dironda
       FROM substations s LEFT JOIN poles p ON p.substation_id = s.id AND p.deleted_at IS NULL
       WHERE ${s.sql} GROUP BY s.id ORDER BY problem DESC, s.name`,
    ).bind(...s.args),
    // Hari dikira ikut waktu Malaysia (UTC+8).
    db.prepare(
      `SELECT date(e.at, '+8 hours') AS day, SUM(e.stage = 'RONDAAN') AS rondaan, SUM(e.stage = 'SELESAI') AS siap
       FROM stage_events e WHERE ${e.sql} AND date(e.at, '+8 hours') >= ? GROUP BY day ORDER BY day`,
    ).bind(...e.args, since),
    db.prepare(
      `SELECT e.id, e.pole_id, e.defect_id, e.stage, e.actor_name, e.note, e.at, p.no_tiang_rondaan
       FROM stage_events e JOIN poles p ON p.id = e.pole_id
       WHERE ${e.sql} AND p.deleted_at IS NULL ORDER BY e.at DESC, e.id DESC LIMIT 15`,
    ).bind(...e.args),
  ]);
  const poles = Object.fromEntries(POLE_STATUS.map((st) => [st, 0])) as Record<PoleStatus, number>;
  for (const r of res[0].results as { status: PoleStatus; n: number }[]) poles[r.status] = r.n;
  const stats: Stats = {
    poles,
    total_poles: Object.values(poles).reduce((a, b) => a + b, 0),
    tasks: res[1].results as Stats['tasks'],
    categories: res[2].results as Stats['categories'],
    teams: res[3].results as Stats['teams'],
    substations: res[4].results as Stats['substations'],
    daily: res[5].results as Stats['daily'],
    recent: res[6].results as Stats['recent'],
  };
  return c.json(stats);
});

// ---- Eksport CSV (format SAVR + status + tag) ----
data.get('/export.csv', requirePerm('data.export'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const p = zoneScope(u, 'p.zone_id');
  const d = zoneScope(u, 'd.zone_id');
  const [poles, counts] = await db.batch([
    db.prepare(`${POLE_SELECT} WHERE p.deleted_at IS NULL AND ${p.sql} ORDER BY s.name, p.id LIMIT 50000`).bind(...p.args),
    db.prepare(`SELECT d.pole_id, d.category, COUNT(*) AS n FROM defects d WHERE d.status != 'disahkan' AND ${d.sql} GROUP BY d.pole_id, d.category`).bind(...d.args),
  ]);
  const byPole = new Map<number, Record<string, number>>();
  for (const r of counts.results as { pole_id: number; category: string; n: number }[]) {
    const m = byPole.get(r.pole_id) ?? {};
    m[r.category] = r.n;
    byPole.set(r.pole_id, m);
  }
  const header = [
    'NAMA PENCAWANG', 'MAINHEAD', 'TEAM', 'FUNCTIONAL LOCATION', 'KOD PENCAWANG', 'No Tiang RONDAAN', 'No Tiang LAMA', 'DATE / TIME',
    'NAMA JALAN', 'JENIS TIANG', 'BAHAN', 'TINGGI (m)', 'TAHUN PASANG', 'LATITUDE', 'LONGITUDE', 'STATUS', 'TAG',
    ...DEFECT_CATEGORIES.map((cat) => DEFECT_COLUMNS[cat]),
  ];
  const rows = (poles.results as PoleRow[]).map((r) => {
    const dc = byPole.get(r.id) ?? {};
    return [
      r.substation_name, r.zone_name, r.team_name, r.functional_location, r.substation_code, r.no_tiang_rondaan, r.no_tiang_lama,
      r.last_rondaan_at, r.street, r.pole_type, r.material, r.height_m, r.install_year, r.lat, r.lng, POLE_STATUS_LABEL[r.status], r.tag_code,
      ...DEFECT_CATEGORIES.map((cat) => dc[cat] ?? ''),
    ];
  });
  await auditStmt(db, u, 'data.export', 'pole', null, { rows: rows.length }).run();
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  // BOM supaya Excel baca UTF-8 dengan betul.
  return new Response('﻿' + toCsv([header, ...rows]), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="senarai-tiang-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

// ---- Import (CSV/Excel dihurai di klien; pelayan sahkan semula setiap baris) ----
const text = (max: number) => z.string().trim().max(max).nullish();
const ImportRow = z.object({
  pencawang: z.string().trim().min(1).max(120),
  kod: z.string().trim().min(1).max(40),
  functional_location: text(80),
  team: text(40),
  no_rondaan: z.string().trim().min(1).max(40),
  no_lama: text(40),
  street: text(120),
  pole_type: text(40),
  material: text(40),
  height_m: z.number().min(1).max(60).nullish(),
  install_year: z.number().int().min(1950).max(2100).nullish(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rondaan_at: z.string().max(40).nullish(),
  defects: z.array(z.enum(DEFECT_CATEGORIES)).max(DEFECT_CATEGORIES.length).default([]),
});
const ImportBody = z.object({
  zone_id: z.number().int().positive().optional(),
  dry_run: z.boolean().default(true),
  rows: z.array(z.unknown()).min(1).max(100),
});

type RowResult = { row: number; action: 'baru' | 'kemas kini' | 'ralat'; message?: string };

data.post('/import', requirePerm('data.import'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  const parsed = ImportBody.safeParse(await readJson(c));
  if (!parsed.success) throw bad('Data import tidak sah (maksimum 100 baris setiap permintaan)');
  const body = parsed.data;
  // Zon ditentukan pelayan: admin sentiasa zon sendiri, tak kira apa yang klien hantar.
  const zoneId = u.role === 'super_admin' ? body.zone_id : u.zone_id;
  if (!zoneId) throw bad('Sila pilih zon');
  const zone = await db.prepare('SELECT id FROM zones WHERE id = ?').bind(zoneId).first();
  if (!zone) throw notFound('Zon tidak dijumpai');

  const [subRes, teamRes] = await db.batch([
    db.prepare('SELECT id, code FROM substations WHERE zone_id = ?').bind(zoneId),
    db.prepare('SELECT id, name FROM teams WHERE zone_id = ?').bind(zoneId),
  ]);
  const subByCode = new Map((subRes.results as { id: number; code: string }[]).map((s) => [s.code.toLowerCase(), s.id]));
  const teamByName = new Map((teamRes.results as { id: number; name: string }[]).map((t) => [t.name.toLowerCase(), t.id]));

  const results: RowResult[] = [];
  const valid: { i: number; r: z.infer<typeof ImportRow> }[] = [];
  const seen = new Set<string>();
  body.rows.forEach((raw, i) => {
    const p = ImportRow.safeParse(raw);
    if (!p.success) {
      results.push({ row: i, action: 'ralat', message: `Medan ${p.error.issues[0].path.join('.') || 'data'} tidak sah` });
      return;
    }
    const key = `${p.data.kod.toLowerCase()}|${p.data.no_rondaan.toLowerCase()}`;
    if (seen.has(key)) {
      results.push({ row: i, action: 'ralat', message: 'Baris berganda dalam fail (kod pencawang + no tiang sama)' });
      return;
    }
    seen.add(key);
    valid.push({ i, r: p.data });
  });

  const newSubs = new Map<string, { name: string; code: string; fl: string | null; lat: number; lng: number }>();
  const newTeams = new Map<string, string>();
  for (const { r } of valid) {
    const code = r.kod.toLowerCase();
    if (!subByCode.has(code) && !newSubs.has(code)) newSubs.set(code, { name: r.pencawang, code: r.kod, fl: r.functional_location ?? null, lat: r.lat, lng: r.lng });
    if (r.team && !teamByName.has(r.team.toLowerCase())) newTeams.set(r.team.toLowerCase(), r.team.toUpperCase());
  }

  // Tiang sedia ada untuk pencawang yang terlibat (kunci upsert: pencawang + no tiang rondaan).
  const existing = new Map<string, number>();
  const subIds = [...new Set(valid.map(({ r }) => subByCode.get(r.kod.toLowerCase())).filter((x): x is number => !!x))];
  for (const sid of subIds) {
    const rows = await db.prepare('SELECT id, no_tiang_rondaan FROM poles WHERE substation_id = ? AND deleted_at IS NULL').bind(sid).all<{ id: number; no_tiang_rondaan: string }>();
    for (const row of rows.results) existing.set(`${sid}|${row.no_tiang_rondaan.toLowerCase()}`, row.id);
  }

  const t = now();
  if (!body.dry_run) {
    for (const [code, s] of newSubs) {
      const row = await db
        .prepare('INSERT INTO substations (zone_id, name, code, functional_location, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(zoneId, s.name, s.code, s.fl, s.lat, s.lng, t)
        .first<{ id: number }>();
      subByCode.set(code, row!.id);
    }
    for (const [key, name] of newTeams) {
      const row = await db.prepare('INSERT INTO teams (zone_id, name, created_at) VALUES (?, ?, ?) RETURNING id').bind(zoneId, name, t).first<{ id: number }>();
      teamByName.set(key, row!.id);
    }
  }

  const stmts: D1PreparedStatement[] = [];
  let inserted = 0;
  let updated = 0;
  for (const { i, r } of valid) {
    const sid = subByCode.get(r.kod.toLowerCase());
    const poleId = sid ? existing.get(`${sid}|${r.no_rondaan.toLowerCase()}`) : undefined;
    const teamId = r.team ? teamByName.get(r.team.toLowerCase()) ?? null : null;
    if (poleId) {
      updated++;
      results.push({ row: i, action: 'kemas kini' });
      if (body.dry_run) continue;
      // Nilai kosong dalam fail tidak memadam data sedia ada. Defect tidak dicipta semula (import selamat diulang).
      stmts.push(
        db
          .prepare(
            `UPDATE poles SET no_tiang_lama = COALESCE(?, no_tiang_lama), street = COALESCE(?, street), pole_type = COALESCE(?, pole_type),
               material = COALESCE(?, material), height_m = COALESCE(?, height_m), install_year = COALESCE(?, install_year),
               team_id = COALESCE(?, team_id), lat = ?, lng = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(r.no_lama ?? null, r.street ?? null, r.pole_type ?? null, r.material ?? null, r.height_m ?? null, r.install_year ?? null, teamId, r.lat, r.lng, t, poleId),
      );
      continue;
    }
    inserted++;
    results.push({ row: i, action: 'baru' });
    if (body.dry_run || !sid) continue;
    const tag = newTagCode();
    const rondaanAt = r.rondaan_at ?? (r.defects.length ? t : null);
    const poleRef = '(SELECT id FROM poles WHERE tag_code = ?)';
    stmts.push(
      db
        .prepare(
          `INSERT INTO poles (tag_code, zone_id, substation_id, team_id, no_tiang_rondaan, no_tiang_lama, street, pole_type, material,
             height_m, install_year, lat, lng, last_rondaan_at, created_by, created_by_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(tag, zoneId, sid, teamId, r.no_rondaan, r.no_lama ?? null, r.street ?? null, r.pole_type ?? null, r.material ?? null,
          r.height_m ?? null, r.install_year ?? null, r.lat, r.lng, rondaanAt, u.id, u.name, t, t),
      db.prepare(`INSERT INTO stage_events (pole_id, zone_id, stage, actor_id, actor_name, note, at) VALUES (${poleRef}, ?, 'DAFTAR', ?, ?, 'Diimport', ?)`).bind(tag, zoneId, u.id, u.name, t),
    );
    if (rondaanAt) {
      stmts.push(db.prepare(`INSERT INTO stage_events (pole_id, zone_id, stage, actor_id, actor_name, note, at) VALUES (${poleRef}, ?, 'RONDAAN', ?, ?, 'Diimport', ?)`).bind(tag, zoneId, u.id, u.name, rondaanAt));
    }
    for (const cat of r.defects) {
      const ref = randomToken(12);
      const info = DEFECT_CATEGORY_INFO[cat];
      stmts.push(
        db
          .prepare(
            `INSERT INTO defects (ref, pole_id, zone_id, category, task_type, status, assigned_team_id, reported_by, reported_by_name, reported_at)
             VALUES (?, ${poleRef}, ?, ?, ?, 'belum', ?, ?, ?, ?)`,
          )
          .bind(ref, tag, zoneId, cat, info.task, teamId, u.id, u.name, rondaanAt ?? t),
        db
          .prepare(
            `INSERT INTO stage_events (pole_id, zone_id, defect_id, stage, actor_id, actor_name, note, at)
             VALUES (${poleRef}, ?, (SELECT id FROM defects WHERE ref = ?), 'DEFECT', ?, ?, ?, ?)`,
          )
          .bind(tag, zoneId, ref, u.id, u.name, info.label, rondaanAt ?? t),
      );
    }
    stmts.push(db.prepare(recomputePoleSql('tag_code = ?2')).bind(t, tag));
  }

  if (!body.dry_run) {
    stmts.push(bumpRev(db, zoneId), auditStmt(db, u, 'data.import', 'pole', null, { inserted, updated, errors: results.filter((r) => r.action === 'ralat').length }));
    for (let k = 0; k < stmts.length; k += 80) await db.batch(stmts.slice(k, k + 80));
  }
  results.sort((a, b) => a.row - b.row);
  return c.json({
    dry_run: body.dry_run,
    inserted,
    updated,
    errors: results.filter((r) => r.action === 'ralat').length,
    new_substations: [...newSubs.values()].map((s) => `${s.name} (${s.code})`),
    new_teams: [...newTeams.values()],
    results,
  });
});

export default data;
