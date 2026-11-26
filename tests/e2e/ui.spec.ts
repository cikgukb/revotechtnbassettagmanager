import { expect, test } from '@playwright/test';
import { PASSWORD, TINY_PNG, apiAs, stubTiles, uiLogin, waitForMap } from './helpers';

type Pt = { id: number; lat: number; lng: number; s: number; no: string };

test.beforeEach(async ({ page }) => {
  await stubTiles(page);
});

test('log masuk salah ditolak; betul masuk ke peta', async ({ page }) => {
  await uiLogin(page, 'viewer.sa', 'salah-sama-sekali');
  await expect(page.getByRole('alert')).toContainText('salah');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await waitForMap(page, 1000);
  await expect(page.getByTestId('pole-total')).toContainText('tiang');
});

test('peta 3D: kluster, klik tiang buka profil yang betul, tapis bermasalah', async ({ page }) => {
  await uiLogin(page, 'viewer.sa');
  await waitForMap(page, 1000);
  expect(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))).toBe(true);
  // Viewer tiada butang daftar tiang.
  await expect(page.getByTestId('add-pole')).toHaveCount(0);

  const settle = () => page.waitForTimeout(1500);
  // Zum jauh: tiang dikumpul dalam kluster.
  await page.evaluate(() => (window as any).__poleMap.map.jumpTo({ zoom: 12.5, pitch: 0, bearing: 0 }));
  await settle();
  expect(await page.evaluate(() => (window as any).__poleMap.map.queryRenderedFeatures({ layers: ['cluster'] }).length)).toBeGreaterThan(0);

  // Zum dekat pada satu tiang bermasalah: tiang 3D dilukis, dan klik membuka profil tiang itu.
  const target: Pt = await page.evaluate(() => {
    const pm = (window as any).__poleMap;
    const p = [...pm.all.values()].find((x: any) => x.s === 2);
    pm.map.jumpTo({ center: [p.lng, p.lat], zoom: 18.4, pitch: 60, bearing: -20 });
    return p;
  });
  await settle();
  expect(await page.evaluate(() => (window as any).__poleMap.map.queryRenderedFeatures({ layers: ['poles-3d'] }).length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__poleMap.map.queryRenderedFeatures({ layers: ['beacon'] }).length)).toBeGreaterThan(0);
  const pt = await page.evaluate((p) => {
    const q = (window as any).__poleMap.map.project([p.lng, p.lat]);
    const r = document.querySelector('[data-testid=map]')!.getBoundingClientRect();
    return { x: r.left + q.x, y: r.top + q.y };
  }, target);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId('pole-no')).toHaveText(target.no);
  await expect(page).toHaveURL(new RegExp(`tiang=${target.id}`));
  await expect(page.getByTestId('pole-profile')).toContainText('Belum disenggara');
  // Tab Stages menunjukkan timeline; tab Tag QR menjana kod QR.
  await page.getByRole('tab', { name: /Stages/ }).click();
  await expect(page.getByTestId('timeline')).toContainText('Defect dilapor');
  await page.getByRole('tab', { name: 'Tag QR' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  // Viewer tiada butang tindakan.
  await expect(page.getByTestId('btn-rondaan')).toHaveCount(0);
  await page.getByTestId('profile-close').click();

  // Tapisan "bermasalah sahaja" mengurangkan tiang yang dilukis kepada yang berstatus 2..4.
  const problem = await page.evaluate(() => [...(window as any).__poleMap.all.values()].filter((x: any) => x.s >= 2).length);
  await page.getByTestId('filter-problem').click();
  await expect.poll(() => page.evaluate(() => (window as any).__poleMap.visibleCount)).toBe(problem);
});

test('operator di telefon: daftar tiang dengan GPS, rondaan dengan defect dan gambar', async ({ browser, playwright }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 3.0277, longitude: 101.5355 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await stubTiles(page);
  await uiLogin(page, 'op.alpha');
  await waitForMap(page, 1000);
  const no = `UI ${Date.now().toString(36)}`;

  await page.getByTestId('add-pole').click();
  await page.fill('input[name=no_tiang_rondaan]', no);
  await page.getByRole('button', { name: 'Guna GPS' }).click();
  await expect(page.locator('input[name=lat]')).toHaveValue('3.0277000');
  await expect(page.locator('input[name=lng]')).toHaveValue('101.5355000');
  await page.getByRole('button', { name: 'Daftar tiang', exact: true }).last().click();

  await expect(page.getByTestId('pole-no')).toHaveText(no);
  await expect(page.getByTestId('pole-profile')).toContainText('Belum dironda');

  await page.getByTestId('btn-rondaan').click();
  await page.getByTestId('defect-TIANG_CONDONG').check();
  await page.getByTestId('photo-input').setInputFiles({ name: 'tiang.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.getByTestId('rondaan-submit').click();
  await expect(page.getByTestId('pole-profile')).toContainText('Belum disenggara');

  // Sahkan di pelayan: defect wujud, gambar tersimpan dan dipaut pada stage rondaan.
  const api = await apiAs(playwright, 'viewer.sa');
  const row = (await (await api.get(`/api/poles?q=${encodeURIComponent(no)}`)).json()).rows[0];
  expect(row).toMatchObject({ status: 'defect', team_name: 'ALPHA', lat: 3.0277, lng: 101.5355 });
  const profile = await (await api.get(`/api/poles/${row.id}`)).json();
  expect(profile.defects).toHaveLength(1);
  expect(profile.photos).toHaveLength(1);
  expect(profile.photos[0]).toMatchObject({ kind: 'sebelum' });
  expect(profile.photos[0].stage_event_id).toBeTruthy();
  expect((await api.get(`/api/photos/${profile.photos[0].id}?thumb=1`)).headers()['content-type']).toBe('image/jpeg');

  // Operator memulakan dan menyiapkan kerja dari profil.
  await page.getByRole('tab', { name: /Defect/ }).click();
  await page.getByTestId('defect-start').click();
  await expect(page.getByTestId('defect-card')).toContainText('Sedang disenggara');
  await page.getByTestId('defect-complete').click();
  await page.getByTestId('complete-submit').click();
  await expect(page.getByTestId('defect-card')).toContainText('Senggaraan selesai');
  // Operator tidak boleh sahkan.
  await expect(page.getByTestId('defect-verify')).toHaveCount(0);
  await ctx.close();
});

test('Super Admin cipta pengguna; pengguna baharu dipaksa tukar kata laluan', async ({ page }) => {
  const username = `ui.viewer${Date.now().toString(36)}`;
  await uiLogin(page, 'superadmin');
  await waitForMap(page, 1);
  await page.goto('/pengguna');
  await page.getByTestId('user-add').click();
  await page.fill('input[name=name]', 'Viewer Ujian UI');
  await page.fill('input[name=username]', username);
  await page.selectOption('select[name=role]', 'viewer');
  await page.selectOption('select[name=zone]', { label: 'SHAH ALAM' });
  await page.fill('input[name=password]', 'Sementara#12345');
  await page.getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByTestId('users-table')).toContainText(username);
  await page.getByRole('button', { name: 'Log keluar' }).first().click();

  await uiLogin(page, username, 'Sementara#12345');
  await expect(page.getByText('Wajib sebelum guna sistem')).toBeVisible();
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill('Sementara#12345');
  await pw.nth(1).fill('Baharu#1234567');
  await pw.nth(2).fill('Baharu#1234567');
  await page.getByRole('button', { name: 'Tukar kata laluan' }).click();
  await waitForMap(page, 1000);
  // Viewer tidak nampak menu Super Admin, dan laluan terus pun ditolak.
  await expect(page.getByRole('link', { name: /Pengguna/ })).toHaveCount(0);
  await page.goto('/pengguna');
  await expect(page.getByText('Halaman tidak dijumpai')).toBeVisible();
});

test('dashboard, senarai dan tag QR memaparkan data sebenar', async ({ page, playwright }) => {
  const api = await apiAs(playwright, 'admin.sa');
  const stats = await (await api.get('/api/stats')).json();
  await uiLogin(page, 'admin.sa');
  await waitForMap(page, 1000);

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard')).toContainText(new Intl.NumberFormat('ms-MY').format(stats.total_poles));
  const t1Belum = stats.tasks.find((t: { task_type: string; status: string }) => t.task_type === 'T1' && t.status === 'belum')?.n ?? 0;
  await expect(page.getByTestId('task-table').locator('tbody tr').first().locator('td').nth(1)).toHaveText(String(t1Belum));

  await page.goto('/tiang');
  await expect(page.getByTestId('poles-table').locator('tbody tr')).toHaveCount(50);
  await page.getByLabel('Status').selectOption('problem');
  await expect(page.getByText(/tiang sepadan/)).not.toContainText(new Intl.NumberFormat('ms-MY').format(stats.total_poles));

  await page.goto('/tugasan');
  await expect(page.getByTestId('col-belum').getByTestId('task-card').first()).toBeVisible();

  // Pautan dalam tag QR terus ke profil tiang.
  const pole = (await (await api.get('/api/poles?limit=1')).json()).rows[0];
  await page.goto(`/t/${pole.tag_code}`);
  await expect(page).toHaveURL(new RegExp(`/tiang/${pole.id}$`));
  await expect(page.getByTestId('pole-no')).toHaveText(pole.no_tiang_rondaan);
});
