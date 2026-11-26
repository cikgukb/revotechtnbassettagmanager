import { Hono } from 'hono';
import { PHOTO_KINDS, type PhotoKind } from '../../shared/types';
import { type AppEnv, HttpError, auditStmt, bad, canWritePole, forbidden, inZone, intParam, notFound, now, requirePerm } from '../lib';
import { canWorkDefect } from './defects';
import { loadPole } from './poles';

const photos = new Hono<AppEnv>();

const MAX_FILE = 5 * 1024 * 1024;
const MAX_THUMB = 400 * 1024;

/** Jenis fail ditentukan dari bait sebenar, bukan dari apa yang klien dakwa. */
function sniff(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return { type: 'image/webp', ext: 'webp' };
  return null;
}

const optInt = (v: unknown, name: string): number | null => {
  if (v === null || v === undefined || v === '') return null;
  return intParam(String(v), name);
};

photos.post('/', requirePerm('photo.upload'), async (c) => {
  const u = c.get('user');
  const db = c.env.DB;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw bad('Borang muat naik tidak sah');
  }
  const file = form.get('file');
  const thumb = form.get('thumb');
  const kind = String(form.get('kind') ?? '') as PhotoKind;
  if (!(file instanceof File)) throw bad('Fail gambar diperlukan');
  if (!(PHOTO_KINDS as readonly string[]).includes(kind)) throw bad('Jenis gambar tidak sah');
  if (file.size > MAX_FILE) throw new HttpError(413, 'too_large', 'Gambar melebihi 5MB');

  const pole = await loadPole(db, u, intParam(String(form.get('pole_id') ?? ''), 'pole_id'));
  const defectId = optInt(form.get('defect_id'), 'defect_id');
  const eventId = optInt(form.get('stage_event_id'), 'stage_event_id');

  let allowed = canWritePole(u, pole);
  if (defectId !== null) {
    const d = await db.prepare('SELECT pole_id, zone_id, assigned_team_id FROM defects WHERE id = ?').bind(defectId).first<{ pole_id: number; zone_id: number; assigned_team_id: number | null }>();
    if (!d || d.pole_id !== pole.id) throw bad('Defect tidak sepadan dengan tiang');
    allowed = allowed || canWorkDefect(u, d);
  }
  if (!allowed) throw forbidden('Tiang ini bukan di bawah team anda');
  if (eventId !== null) {
    const e = await db.prepare('SELECT pole_id FROM stage_events WHERE id = ?').bind(eventId).first<{ pole_id: number }>();
    if (!e || e.pole_id !== pole.id) throw bad('Stage tidak sepadan dengan tiang');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = sniff(bytes);
  if (!info) throw new HttpError(415, 'bad_type', 'Hanya gambar JPEG, PNG atau WebP dibenarkan');

  // Kunci R2 dijana pelayan dan rawak; klien tak pernah hantar atau terima kunci.
  const base = `photos/${pole.zone_id}/${pole.id}/${crypto.randomUUID()}`;
  const key = `${base}.${info.ext}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: info.type } });
  let thumbKey: string | null = null;
  if (thumb instanceof File && thumb.size > 0 && thumb.size <= MAX_THUMB) {
    const tb = new Uint8Array(await thumb.arrayBuffer());
    const ti = sniff(tb);
    if (ti) {
      thumbKey = `${base}-t.${ti.ext}`;
      await c.env.PHOTOS.put(thumbKey, tb, { httpMetadata: { contentType: ti.type } });
    }
  }

  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO photos (pole_id, defect_id, stage_event_id, kind, r2_key, thumb_key, content_type, size, uploaded_by, uploaded_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(pole.id, defectId, eventId, kind, key, thumbKey, info.type, bytes.length, u.id, u.name, t)
    .first<{ id: number }>();
  if (kind === 'profil' && row) {
    await db.prepare('UPDATE poles SET photo_id = ?, updated_at = ? WHERE id = ?').bind(row.id, t, pole.id).run();
  }
  return c.json({ id: row!.id }, 201);
});

interface PhotoDb { id: number; pole_id: number; r2_key: string; thumb_key: string | null; content_type: string; zone_id: number }

async function loadPhoto(c: any, id: number): Promise<PhotoDb> {
  const row = await c.env.DB.prepare(
    'SELECT ph.id, ph.pole_id, ph.r2_key, ph.thumb_key, ph.content_type, p.zone_id FROM photos ph JOIN poles p ON p.id = ph.pole_id WHERE ph.id = ?',
  )
    .bind(id)
    .first() as PhotoDb | null;
  // Di luar zon = 404, sama seperti tidak wujud, supaya ID tak boleh diteka-teka.
  if (!row || !inZone(c.get('user'), row.zone_id)) throw notFound('Gambar tidak dijumpai');
  return row;
}

photos.get('/:id', async (c) => {
  const row = await loadPhoto(c, intParam(c.req.param('id')));
  const key = c.req.query('thumb') && row.thumb_key ? row.thumb_key : row.r2_key;
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) throw notFound('Gambar tidak dijumpai');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? row.content_type,
      'content-length': String(obj.size),
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  });
});

photos.delete('/:id', requirePerm('photo.delete'), async (c) => {
  const u = c.get('user');
  const row = await loadPhoto(c, intParam(c.req.param('id')));
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE poles SET photo_id = NULL WHERE id = ? AND photo_id = ?').bind(row.pole_id, row.id),
    db.prepare('DELETE FROM photos WHERE id = ?').bind(row.id),
    auditStmt(db, u, 'photo.delete', 'photo', row.id, { pole_id: row.pole_id }),
  ]);
  await c.env.PHOTOS.delete(row.thumb_key ? [row.r2_key, row.thumb_key] : [row.r2_key]);
  return c.json({ ok: true });
});

export default photos;
