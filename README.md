# Revotech Asset Tag Manager

Sistem pengurusan aset tiang dan respons defect: peta 3D, profil setiap tiang, timeline stage,
tugasan senggaraan dan kawalan akses ikut role.

## Ciri utama

- **Peta 3D** (MapLibre): imej satelit, bangunan 3D, tiang 3D berwarna ikut status. Tiang bermasalah
  ditanda dengan tiang cahaya dan denyutan, jadi nampak dari jauh. Kluster pada zum jauh, carian, tapisan.
- **Profil tiang**: klik tiang untuk buka biodata, stages (timeline kitar hayat), defect, gambar dan tag QR.
- **Stages**: Daftar/Tag → Rondaan → Defect dilapor → Sedang disenggara → Selesai → Disahkan.
  Setiap peristiwa direkod dengan masa, pelaku dan gambar.
- **Tugasan (DRS)**: papan Belum / Sedang / Selesai / Disahkan ikut jenis tugasan (T1, T2, Rentis, Cat Tiang).
- **Dashboard** boleh dicetak sebagai laporan (Cetak → Simpan sebagai PDF).
- **Import / eksport** CSV dan Excel dalam format lajur SENARAI TIANG SAVR.
- **Audit log** untuk setiap tindakan penting.

## Role

| Role | Boleh buat |
|---|---|
| Super Admin | Semua, termasuk urus pengguna, role, zon dan audit log |
| Admin | Urus data zon sendiri, agih tugasan, sahkan atau tolak kerja siap, import/eksport |
| Operator | Kerja di site untuk team sendiri: daftar tiang, rondaan, lapor defect, mula dan siapkan senggaraan |
| Viewer | Lihat sahaja: peta, dashboard, profil, eksport |

Peraturan tambahan yang dikuatkuasakan di pelayan:

- Admin, Operator dan Viewer hanya nampak data zon sendiri. Data zon lain dilayan seperti tidak wujud (404).
- Operator hanya boleh ubah tiang dan tugasan team sendiri.
- Orang yang tanda kerja siap tidak boleh sahkan kerja itu sendiri (kecuali Super Admin).
- Mesti sentiasa ada sekurang-kurangnya seorang Super Admin aktif.
- Akaun baharu dan kata laluan yang diset semula wajib ditukar pada log masuk pertama.

Matriks penuh ada dalam aplikasi: Pengguna & Tetapan → Kebenaran role (`shared/types.ts`, `PERMS`).

## Seni bina

- **Satu Cloudflare Worker** (`worker/`): API Hono di `/api/*`, dan SPA React dihidang sebagai aset statik.
- **D1** (SQLite) untuk data, **R2** untuk gambar. Gambar dihidang melalui laluan yang menyemak sesi dan zon.
- **Sesi**: token rawak dalam kuki `HttpOnly`; hanya hash SHA-256 disimpan. Kata laluan: PBKDF2-SHA256, 100,000 iterasi.
- **Tiada kunci API**: tile peta dari OpenFreeMap (vektor) dan Esri World Imagery (satelit).

```
migrations/   skema D1
shared/       jenis, kebenaran, mesin stage, format SAVR, penjana data contoh (dikongsi API + UI)
worker/       API: auth, poles, defects, photos, data (statistik/import/eksport), admin
src/          SPA: peta (src/map), halaman, komponen
tests/        unit (Vitest) dan hujung-ke-hujung (Playwright)
```

## Jalankan di komputer sendiri

Perlu Node 22.12 atau lebih baharu.

```bash
npm install
npm run build
npm run db:local
npm run seed:dev
npm run dev:api
```

Buka http://localhost:8787. `seed:dev` mencipta akaun ujian (kata laluan dicetak di terminal):
`superadmin`, `admin.sa`, `admin2.sa`, `op.alpha`, `op.bravo`, `viewer.sa`. Akaun ini untuk tempatan sahaja.

Log masuk sebagai `superadmin`, kemudian Pengguna & Tetapan → Data contoh → Jana data contoh.

Untuk ubah UI dengan muat semula pantas, jalankan `npm run dev` di terminal kedua dan buka http://localhost:5173.

## Ujian

```bash
npm run typecheck
npm test
npm run e2e
```

`npm run e2e` membina aplikasi, menyediakan pangkalan data D1 tempatan yang baharu dan menjalankan
ujian pelayar. Tile peta luar disekat semasa ujian, jadi ia tidak bergantung pada internet.

## Deploy ke Cloudflare

Sumber berikut sudah dicipta dalam akaun Cloudflare dan dirujuk dalam `wrangler.jsonc`:

- D1 `revotech-asset-tag-db` (skema `migrations/0001_init.sql` sudah dipasang, dengan satu akaun Super Admin)
- R2 `revotech-asset-tag-photos`

Yang tinggal ialah deploy Worker `revotech-asset-tag`. Cara paling mudah ialah **Workers Builds**
(deploy automatik setiap kali push):

1. Dashboard Cloudflare → Workers & Pages → Create → Import a repository → pilih repo ini.
2. Nama projek mesti `revotech-asset-tag`. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
3. Pilih branch yang hendak di-deploy, kemudian Deploy.

Selepas siap, Cloudflare memaparkan alamat `https://revotech-asset-tag.<subdomain>.workers.dev`.

Alternatif dari komputer sendiri (selepas `npx wrangler login`):

```bash
npm run deploy
```

Jika skema berubah kemudian, tambah fail baharu dalam `migrations/` dan jalankan `npm run db:remote`.

Untuk cipta Super Admin tambahan secara manual (cth. jika terkunci di luar):

```bash
npm run hash -- "KataLaluanSementara123"
```

Masukkan hash itu ke jadual `users` dengan `role = 'super_admin'` dan `must_change_password = 1`.

## Data contoh

Kira-kira 1,500 tiang di sepanjang jalan sebenar Seksyen 25, Shah Alam. Geometri jalan dari
OpenStreetMap (© OpenStreetMap contributors, ODbL). Nama pencawang, nombor tiang dan defect adalah rekaan.
Padam di Pengguna & Tetapan → Data contoh bila data sebenar sudah masuk.

## Perkara yang perlu tahu

- **Imej satelit**: Esri World Imagery digunakan tanpa kunci API. Syarat penggunaan komersialnya perlu
  disemak sebelum sistem dijual kepada klien. Untuk tukar pembekal, ubah `SATELLITE` dalam `src/map/style.ts`
  dan senarai hos dalam `public/_headers`.
- **OpenFreeMap** percuma tetapi tiada jaminan perkhidmatan (SLA).
- **Pelan percuma Cloudflare** ada had: 10 ms CPU setiap permintaan (login PBKDF2 mungkin melebihi), dan
  100,000 baris ditulis sehari pada D1. Untuk kegunaan sebenar, pelan Workers Paid disyorkan.
- **Tiada mod offline**: operator perlukan talian internet di site.
- **Lupa kata laluan**: diset semula oleh Super Admin (tiada e-mel).
- Kemas kini "masa nyata" dibuat dengan semakan ringan setiap 20 saat, bukan WebSocket.
