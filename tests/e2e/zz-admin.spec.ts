// Dijalankan terakhir (nama fail bermula "zz") kerana ia memadam dan menjana semula data contoh.
import { expect, test } from '@playwright/test';
import { apiAs } from './helpers';

test('admin agih defect kepada team lain; hanya team itu boleh kerjakan', async ({ playwright }) => {
  const admin = await apiAs(playwright, 'admin.sa');
  const alpha = await apiAs(playwright, 'op.alpha');
  const bravo = await apiAs(playwright, 'op.bravo');
  const meta = await (await admin.get('/api/meta')).json();
  const teamBravo = meta.teams.find((t: { name: string }) => t.name === 'BRAVO');
  const { id } = await (await alpha.post('/api/poles', { data: { substation_id: meta.substations[0].id, no_tiang_rondaan: `AGIH ${Date.now().toString(36)}`, lat: 3.03, lng: 101.53 } })).json();
  const defectId = (await (await alpha.post(`/api/poles/${id}/rondaan`, { data: { defects: [{ category: 'PENGALIR_KAWASAN' }] } })).json()).defect_ids[0];

  expect((await alpha.post(`/api/defects/${defectId}/assign`, { data: { team_id: teamBravo.id } })).status()).toBe(403);
  expect((await admin.post(`/api/defects/${defectId}/assign`, { data: { team_id: 999999 } })).status()).toBe(400);
  expect((await admin.post(`/api/defects/${defectId}/assign`, { data: { team_id: teamBravo.id, task_type: 'T2' } })).status()).toBe(200);

  expect((await alpha.post(`/api/defects/${defectId}/start`, { data: {} })).status()).toBe(403);
  expect((await bravo.post(`/api/defects/${defectId}/start`, { data: {} })).status()).toBe(200);
  const board = await (await admin.get(`/api/defects/board?team_id=${teamBravo.id}&task_type=T2`)).json();
  expect(board.columns.sedang.some((d: { id: number }) => d.id === defectId)).toBe(true);
});

test('audit log merekod tindakan dan hanya Super Admin boleh baca', async ({ playwright }) => {
  const superAdmin = await apiAs(playwright, 'superadmin');
  const rows = (await (await superAdmin.get('/api/admin/audit?limit=200')).json()).rows as { action: string; actor_name: string }[];
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['login', 'pole.create', 'rondaan.create', 'defect.assign', 'defect.start']) expect(actions.has(a), a).toBe(true);
  expect(rows.every((r) => typeof r.actor_name === 'string')).toBe(true);
});

test('data contoh boleh dipadam tanpa menjejaskan tiang sebenar, dan dijana semula', async ({ playwright }) => {
  const superAdmin = await apiAs(playwright, 'superadmin');
  const count = async () => (await (await superAdmin.get('/api/poles/geo')).json()).poles.length as number;
  const before = await count();
  expect((await superAdmin.post('/api/admin/sample', { data: { step: 0 } })).status()).toBe(409); // sudah wujud

  const del = await superAdmin.delete('/api/admin/sample');
  expect(del.status()).toBe(200);
  const removed = (await del.json()).poles as number;
  expect(removed).toBeGreaterThan(1000);
  const after = await count();
  expect(after).toBe(before - removed);
  expect(after).toBeGreaterThan(0); // tiang yang didaftar semasa ujian masih ada
  // Tiada rekod yatim tertinggal.
  const stats = await (await superAdmin.get('/api/stats')).json();
  expect(stats.total_poles).toBe(after);

  // Jana semula: pencawang contoh yang sudah ada tiang sebenar kekal sebagai pencawang biasa dan dilangkau.
  let skipped = 0;
  for (let step = 0; ; step++) {
    const res = await superAdmin.post('/api/admin/sample', { data: { step } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body.skipped) skipped++;
    if (body.done) break;
  }
  expect(skipped).toBeGreaterThanOrEqual(1);
  const regenerated = await count();
  expect(regenerated).toBeGreaterThan(after + 1000);
  expect(regenerated).toBeLessThanOrEqual(before);
  // Jana kali kedua ditolak kerana data contoh sudah wujud.
  expect((await superAdmin.post('/api/admin/sample', { data: { step: 0 } })).status()).toBe(409);
});
