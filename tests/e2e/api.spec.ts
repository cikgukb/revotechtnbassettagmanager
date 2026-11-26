import { expect, test } from '@playwright/test';
import { TINY_JPEG, anon, apiAs } from './helpers';

const uniq = (p: string) => `${p} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.describe('pengesahan & kawalan akses', () => {
  test('tanpa sesi ditolak; origin asing ditolak', async ({ playwright }) => {
    const a = await anon(playwright);
    expect((await a.get('/api/poles/geo')).status()).toBe(401);
    expect((await a.get('/api/auth/me')).status()).toBe(401);
    const bad = await playwright.request.newContext({ baseURL: 'http://localhost:8788', extraHTTPHeaders: { Origin: 'https://jahat.example' } });
    expect((await bad.post('/api/auth/login', { data: { username: 'superadmin', password: 'x' } })).status()).toBe(403);
    const none = await playwright.request.newContext({ baseURL: 'http://localhost:8788' });
    expect((await none.post('/api/auth/login', { data: { username: 'superadmin', password: 'x' } })).status()).toBe(403);
  });

  test('akaun dikunci selepas 5 cubaan salah', async ({ playwright }) => {
    const a = await anon(playwright);
    for (let i = 0; i < 5; i++) expect((await a.post('/api/auth/login', { data: { username: 'kunci.ujian', password: 'salah' } })).status()).toBe(401);
    expect((await a.post('/api/auth/login', { data: { username: 'kunci.ujian', password: 'salah' } })).status()).toBe(429);
  });

  test('matriks role dikuatkuasakan di pelayan', async ({ playwright }) => {
    const viewer = await apiAs(playwright, 'viewer.sa');
    const op = await apiAs(playwright, 'op.alpha');
    const admin = await apiAs(playwright, 'admin.sa');
    const sub = (await (await viewer.get('/api/meta')).json()).substations[0];
    const pole = { substation_id: sub.id, no_tiang_rondaan: uniq('RBAC'), lat: 3.03, lng: 101.53 };

    expect((await viewer.post('/api/poles', { data: pole })).status()).toBe(403);
    expect((await viewer.post('/api/import', { data: { rows: [{}] } })).status()).toBe(403);
    expect((await viewer.get('/api/export.csv')).status()).toBe(200);
    expect((await op.get('/api/export.csv')).status()).toBe(403);
    for (const ctx of [viewer, op, admin]) {
      expect((await ctx.get('/api/admin/users')).status()).toBe(403);
      expect((await ctx.get('/api/admin/audit')).status()).toBe(403);
      expect((await ctx.post('/api/admin/users', { data: { username: 'x.y.z', name: 'X', role: 'super_admin', password: 'Sementara#12345' } })).status()).toBe(403);
      expect((await ctx.post('/api/admin/sample', { data: { step: 0 } })).status()).toBe(403);
    }
    const created = await op.post('/api/poles', { data: pole });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    expect((await op.patch(`/api/poles/${id}`, { data: { street: 'x' } })).status()).toBe(403);
    expect((await op.delete(`/api/poles/${id}`)).status()).toBe(403);
    expect((await admin.patch(`/api/poles/${id}`, { data: { street: 'Jalan Ujian' } })).status()).toBe(200);
    expect((await op.post('/api/poles', { data: pole })).status()).toBe(409); // no tiang berganda
    expect((await admin.delete(`/api/poles/${id}`)).status()).toBe(200);
    expect((await viewer.get(`/api/poles/${id}`)).status()).toBe(404);
  });

  test('operator hanya boleh ubah tiang team sendiri', async ({ playwright }) => {
    const alpha = await apiAs(playwright, 'op.alpha');
    const bravo = await apiAs(playwright, 'op.bravo');
    const sub = (await (await alpha.get('/api/meta')).json()).substations[0];
    // Walaupun klien hantar team lain, tiang didaftar atas team operator itu sendiri.
    const { id } = await (await alpha.post('/api/poles', { data: { substation_id: sub.id, no_tiang_rondaan: uniq('TEAM'), lat: 3.03, lng: 101.53, team_id: 2 } })).json();
    const profile = await (await bravo.get(`/api/poles/${id}`)).json();
    expect(profile.pole.team_name).toBe('ALPHA');
    expect((await bravo.post(`/api/poles/${id}/rondaan`, { data: { defects: [] } })).status()).toBe(403);
    expect((await alpha.post(`/api/poles/${id}/rondaan`, { data: { defects: [] } })).status()).toBe(201);
  });

  test('pengguna baharu wajib tukar kata laluan; zon lain tak nampak data; role tak boleh dinaikkan sendiri', async ({ playwright }) => {
    const superAdmin = await apiAs(playwright, 'superadmin');
    const meta = await (await superAdmin.get('/api/meta')).json();
    const klu = meta.zones.find((z: { name: string }) => z.name === 'KL UTARA');
    const username = `admin.klu${Date.now().toString(36)}`;
    const temp = 'Sementara#12345';
    expect((await superAdmin.post('/api/admin/users', { data: { username, name: 'Admin KL Utara', role: 'admin', zone_id: klu.id, password: 'lemah' } })).status()).toBe(400);
    const made = await superAdmin.post('/api/admin/users', { data: { username, name: 'Admin KL Utara', role: 'admin', zone_id: klu.id, password: temp } });
    expect(made.status()).toBe(201);
    const userId = (await made.json()).id;

    const u = await apiAs(playwright, username, temp);
    const gated = await u.get('/api/poles/geo');
    expect(gated.status()).toBe(403);
    expect((await gated.json()).error).toBe('must_change_password');
    expect((await u.post('/api/auth/password', { data: { current: temp, next: 'Baharu#1234567' } })).status()).toBe(200);

    // Admin zon KL UTARA tidak nampak apa-apa dari SHAH ALAM.
    expect((await (await u.get('/api/poles/geo')).json()).poles).toHaveLength(0);
    const shahAlamPole = (await (await superAdmin.get('/api/poles?limit=1')).json()).rows[0];
    expect((await u.get(`/api/poles/${shahAlamPole.id}`)).status()).toBe(404);
    expect((await u.post(`/api/poles/${shahAlamPole.id}/rondaan`, { data: { defects: [] } })).status()).toBe(404);
    expect((await u.patch(`/api/admin/users/${userId}`, { data: { role: 'super_admin' } })).status()).toBe(403);

    // Tukar role membatalkan sesi sedia ada serta-merta.
    expect((await superAdmin.patch(`/api/admin/users/${userId}`, { data: { role: 'viewer' } })).status()).toBe(200);
    expect((await u.get('/api/auth/me')).status()).toBe(401);
  });

  test('Super Admin terakhir tidak boleh dibuang', async ({ playwright }) => {
    const superAdmin = await apiAs(playwright, 'superadmin');
    const me = (await (await superAdmin.get('/api/auth/me')).json()).user;
    expect((await superAdmin.patch(`/api/admin/users/${me.id}`, { data: { role: 'admin', zone_id: 1 } })).status()).toBe(409);
    expect((await superAdmin.patch(`/api/admin/users/${me.id}`, { data: { active: false } })).status()).toBe(409);
    expect((await superAdmin.get('/api/auth/me')).status()).toBe(200);
  });
});

test.describe('kitar hayat tiang', () => {
  test('daftar -> rondaan -> defect -> mula -> siap -> sahkan, dengan peralihan haram ditolak', async ({ playwright }) => {
    const op = await apiAs(playwright, 'op.alpha');
    const bravo = await apiAs(playwright, 'op.bravo');
    const admin = await apiAs(playwright, 'admin.sa');
    const admin2 = await apiAs(playwright, 'admin2.sa');
    const viewer = await apiAs(playwright, 'viewer.sa');
    const sub = (await (await op.get('/api/meta')).json()).substations[0];
    const status = async (id: number) => (await (await viewer.get(`/api/poles/${id}`)).json()).pole.status;

    const { id, tag_code } = await (await op.post('/api/poles', { data: { substation_id: sub.id, no_tiang_rondaan: uniq('HAYAT'), lat: 3.0301, lng: 101.5301 } })).json();
    expect(tag_code).toMatch(/^RV-[A-Z0-9]{8}$/);
    expect(await status(id)).toBe('baru');
    expect((await (await viewer.get(`/api/poles/tag/${tag_code}`)).json()).id).toBe(id);

    const rondaan = await op.post(`/api/poles/${id}/rondaan`, { data: { note: 'ujian', defects: [{ category: 'TIANG_CONDONG', severity: 'tinggi' }] } });
    expect(rondaan.status()).toBe(201);
    const defectId = (await rondaan.json()).defect_ids[0];
    expect(await status(id)).toBe('defect');
    // Kategori yang masih terbuka tidak diganda.
    expect((await (await op.post(`/api/poles/${id}/rondaan`, { data: { defects: [{ category: 'TIANG_CONDONG' }] } })).json()).skipped).toBe(1);

    expect((await viewer.post(`/api/defects/${defectId}/start`, { data: {} })).status()).toBe(403);
    expect((await bravo.post(`/api/defects/${defectId}/start`, { data: {} })).status()).toBe(403);
    expect((await op.post(`/api/defects/${defectId}/complete`, { data: {} })).status()).toBe(409);
    expect((await admin.post(`/api/defects/${defectId}/verify`, { data: {} })).status()).toBe(409);

    expect((await op.post(`/api/defects/${defectId}/start`, { data: {} })).status()).toBe(200);
    expect(await status(id)).toBe('sedang');
    expect((await op.post(`/api/defects/${defectId}/complete`, { data: { note: 'tiang ditegakkan' } })).status()).toBe(200);
    expect(await status(id)).toBe('selesai');
    expect((await op.post(`/api/defects/${defectId}/verify`, { data: {} })).status()).toBe(403);
    expect((await admin.post(`/api/defects/${defectId}/reject`, { data: {} })).status()).toBe(400); // sebab wajib
    expect((await admin.post(`/api/defects/${defectId}/verify`, { data: {} })).status()).toBe(200);
    expect(await status(id)).toBe('ok');

    const profile = await (await viewer.get(`/api/poles/${id}`)).json();
    expect(profile.pole.open_defects).toBe(0);
    expect(profile.pole.total_defects).toBe(1);
    expect(profile.events.map((e: { stage: string }) => e.stage).reverse()).toEqual(['DAFTAR', 'RONDAAN', 'DEFECT', 'RONDAAN', 'SEDANG', 'SELESAI', 'DISAHKAN']);

    // Pengasingan tugas: admin yang siapkan kerja tak boleh sahkan kerja sendiri.
    const d2 = (await (await admin.post(`/api/poles/${id}/rondaan`, { data: { defects: [{ category: 'IKLAN_HARAM' }] } })).json()).defect_ids[0];
    await admin.post(`/api/defects/${d2}/start`, { data: {} });
    await admin.post(`/api/defects/${d2}/complete`, { data: {} });
    expect((await admin.post(`/api/defects/${d2}/verify`, { data: {} })).status()).toBe(403);
    expect((await admin2.post(`/api/defects/${d2}/reject`, { data: { note: 'iklan masih ada' } })).status()).toBe(200);
    expect(await status(id)).toBe('sedang');
  });

  test('gambar: jenis fail disemak, akses ikut zon', async ({ playwright }) => {
    const op = await apiAs(playwright, 'op.alpha');
    const viewer = await apiAs(playwright, 'viewer.sa');
    const sub = (await (await op.get('/api/meta')).json()).substations[0];
    const { id } = await (await op.post('/api/poles', { data: { substation_id: sub.id, no_tiang_rondaan: uniq('FOTO'), lat: 3.03, lng: 101.53 } })).json();
    const form = (buffer: Buffer, name = 'a.jpg') => ({ multipart: { file: { name, mimeType: 'image/jpeg', buffer }, pole_id: String(id), kind: 'profil' } });

    expect((await viewer.post('/api/photos', form(TINY_JPEG))).status()).toBe(403);
    expect((await op.post('/api/photos', form(Buffer.from('<script>alert(1)</script>')))).status()).toBe(415);
    const up = await op.post('/api/photos', form(TINY_JPEG));
    expect(up.status()).toBe(201);
    const photoId = (await up.json()).id;

    const got = await viewer.get(`/api/photos/${photoId}`);
    expect(got.status()).toBe(200);
    expect(got.headers()['content-type']).toBe('image/jpeg');
    expect(got.headers()['x-content-type-options']).toBe('nosniff');
    expect((await (await anon(playwright)).get(`/api/photos/${photoId}`)).status()).toBe(401);
    expect((await (await viewer.get(`/api/poles/${id}`)).json()).pole.photo_id).toBe(photoId);

    // Pengguna zon lain: 404, sama seperti gambar yang tidak wujud.
    const superAdmin = await apiAs(playwright, 'superadmin');
    const klu = (await (await superAdmin.get('/api/meta')).json()).zones.find((z: { name: string }) => z.name === 'KL UTARA');
    const username = `viewer.klu${Date.now().toString(36)}`;
    await superAdmin.post('/api/admin/users', { data: { username, name: 'Viewer KLU', role: 'viewer', zone_id: klu.id, password: 'Sementara#12345' } });
    const other = await apiAs(playwright, username, 'Sementara#12345');
    await other.post('/api/auth/password', { data: { current: 'Sementara#12345', next: 'Baharu#1234567' } });
    expect((await other.get(`/api/photos/${photoId}`)).status()).toBe(404);
    expect((await other.get('/api/photos/99999999')).status()).toBe(404);
  });
});

test.describe('data', () => {
  test('import: semakan dahulu, kemudian import; ulang import tidak mengganda', async ({ playwright }) => {
    const admin = await apiAs(playwright, 'admin.sa');
    const kod = `IMP${Date.now().toString(36).toUpperCase()}`;
    const row = (no: string, extra: object = {}) => ({ pencawang: 'PE UJIAN IMPORT', kod, team: 'ECHO', no_rondaan: no, lat: 3.05, lng: 101.52, defects: [], ...extra });
    const rows = [row('N 1', { defects: ['TIANG_REPUT'] }), row('N 2'), row('N 2'), { ...row('N 3'), lat: 999 }];

    const dry = await (await admin.post('/api/import', { data: { dry_run: true, rows } })).json();
    expect(dry).toMatchObject({ inserted: 2, updated: 0, errors: 2 });
    expect(dry.new_substations).toHaveLength(1);
    expect((await (await admin.get(`/api/poles?q=${kod}`)).json()).total).toBe(0); // semakan tidak menulis apa-apa

    const done = await (await admin.post('/api/import', { data: { dry_run: false, rows } })).json();
    expect(done).toMatchObject({ inserted: 2, updated: 0, errors: 2 });
    const list = (await (await admin.get(`/api/poles?q=${kod}`)).json()).rows;
    expect(list).toHaveLength(2);
    expect(list.find((p: { no_tiang_rondaan: string }) => p.no_tiang_rondaan === 'N 1')).toMatchObject({ status: 'defect', open_defects: 1, team_name: 'ECHO' });
    expect(list.find((p: { no_tiang_rondaan: string }) => p.no_tiang_rondaan === 'N 2')).toMatchObject({ status: 'baru', open_defects: 0 });

    const again = await (await admin.post('/api/import', { data: { dry_run: false, rows } })).json();
    expect(again).toMatchObject({ inserted: 0, updated: 2 });
    expect((await (await admin.get(`/api/poles?q=${kod}`)).json()).total).toBe(2);
  });

  test('eksport CSV dan statistik sepadan dengan data', async ({ playwright }) => {
    const viewer = await apiAs(playwright, 'viewer.sa');
    const csv = await (await viewer.get('/api/export.csv')).text();
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('NAMA PENCAWANG,MAINHEAD,TEAM,FUNCTIONAL LOCATION,KOD PENCAWANG,No Tiang RONDAAN');
    const stats = await (await viewer.get('/api/stats')).json();
    const geo = await (await viewer.get('/api/poles/geo')).json();
    expect(stats.total_poles).toBe(geo.poles.length);
    expect(lines.length - 1).toBe(geo.poles.length);
    expect(stats.total_poles).toBeGreaterThan(1000);
  });
});
