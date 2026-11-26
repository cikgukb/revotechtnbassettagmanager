import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { hashPassword, newTagCode, passwordProblem, verifyPassword } from '../../shared/password';
import { SAMPLE_GROUPS, samplePoles } from '../../shared/sample';
import { csvCell, mapSavrRow, parseSavrDate, toCsv } from '../../shared/savr';
import { nextDefectStatus, poleStatusFrom, poleStep } from '../../shared/stages';
import { PERMS, can } from '../../shared/types';
import { ngon, rect, ribbon } from '../../src/map/geometry';
import { buildStyle } from '../../src/map/style';

describe('kata laluan', () => {
  it('hash boleh disahkan dan garam berbeza setiap kali', async () => {
    const a = await hashPassword('Rahsia#12345', 1000);
    const b = await hashPassword('Rahsia#12345', 1000);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^pbkdf2\$sha256\$1000\$/);
    expect(await verifyPassword('Rahsia#12345', a)).toBe(true);
    expect(await verifyPassword('rahsia#12345', a)).toBe(false);
  });
  it('hash rosak atau iterasi melampau ditolak tanpa ralat', async () => {
    for (const bad of ['', 'abc', 'pbkdf2$sha256$x$a$b', 'pbkdf2$sha256$99999999$AAAA$AAAA', 'md5$sha256$1000$AAAA$AAAA']) {
      expect(await verifyPassword('apa-apa', bad)).toBe(false);
    }
  });
  it('polisi kata laluan', () => {
    expect(passwordProblem('pendek1')).toBeTruthy();
    expect(passwordProblem('tiadanombordisini')).toBeTruthy();
    expect(passwordProblem('1234567890123')).toBeTruthy();
    expect(passwordProblem('Sementara#12345')).toBeNull();
  });
  it('kod tag ikut format', () => {
    expect(newTagCode()).toMatch(/^RV-[A-HJ-NP-Z2-9]{8}$/);
  });
});

describe('stages', () => {
  it('hanya peralihan sah dibenarkan', () => {
    expect(nextDefectStatus('belum', 'start')).toBe('sedang');
    expect(nextDefectStatus('sedang', 'complete')).toBe('selesai');
    expect(nextDefectStatus('selesai', 'verify')).toBe('disahkan');
    expect(nextDefectStatus('selesai', 'reject')).toBe('sedang');
    expect(nextDefectStatus('belum', 'complete')).toBeNull();
    expect(nextDefectStatus('belum', 'verify')).toBeNull();
    expect(nextDefectStatus('disahkan', 'start')).toBeNull();
    expect(nextDefectStatus('sedang', 'verify')).toBeNull();
  });
  it('status tiang: defect paling teruk menang', () => {
    expect(poleStatusFrom([], false)).toBe('baru');
    expect(poleStatusFrom([], true)).toBe('ok');
    expect(poleStatusFrom(['disahkan'], true)).toBe('ok');
    expect(poleStatusFrom(['disahkan', 'selesai'], true)).toBe('selesai');
    expect(poleStatusFrom(['selesai', 'sedang'], true)).toBe('sedang');
    expect(poleStatusFrom(['sedang', 'belum', 'disahkan'], true)).toBe('defect');
  });
  it('langkah stepper', () => {
    expect(poleStep({ status: 'baru', total_defects: 0, last_rondaan_at: null })).toBe(1);
    expect(poleStep({ status: 'ok', total_defects: 0, last_rondaan_at: 'x' })).toBe(2);
    expect(poleStep({ status: 'defect', total_defects: 1, last_rondaan_at: 'x' })).toBe(3);
    expect(poleStep({ status: 'sedang', total_defects: 1, last_rondaan_at: 'x' })).toBe(4);
    expect(poleStep({ status: 'selesai', total_defects: 1, last_rondaan_at: 'x' })).toBe(5);
    expect(poleStep({ status: 'ok', total_defects: 1, last_rondaan_at: 'x' })).toBe(6);
  });
});

describe('kebenaran', () => {
  it('viewer tidak boleh menulis apa-apa; hanya super admin urus pengguna', () => {
    const writes = (Object.keys(PERMS) as (keyof typeof PERMS)[]).filter((p) => p !== 'data.export');
    for (const p of writes) expect(can('viewer', p), p).toBe(false);
    expect(can('viewer', 'data.export')).toBe(true);
    for (const role of ['admin', 'operator', 'viewer'] as const) {
      expect(can(role, 'user.manage')).toBe(false);
      expect(can(role, 'audit.view')).toBe(false);
    }
    expect(can('operator', 'defect.verify')).toBe(false);
    expect(can('operator', 'pole.edit')).toBe(false);
    expect(can(null, 'pole.create')).toBe(false);
  });
});

describe('format SAVR', () => {
  it('memetakan tajuk lajur sebenar dan lajur defect', () => {
    const r = mapSavrRow({
      'NAMA PENCAWANG': 'PE KG BARU', MAINHEAD: 'SHAH ALAM', TEAM: 'ALPHA', 'FUNCTIONAL LOCATION': 'BSAM/PCE/J00001', 'KOD PENCAWANG': 'KB1',
      'No Tiang RONDAAN': 'N 8/2', 'No Tiang LAMA': 'JBT4A 7', 'DATE / TIME': '29/12/2023, 04:46:42 pm', LATITUDE: '3.0731', LONGITUDE: 101.5183,
      'TIANG - Reput/Retak': '', 'TIANG - Condong': 1, 'PENGALIR - Kawasan': '2',
    });
    expect(r.error).toBeUndefined();
    expect(r.row).toMatchObject({ pencawang: 'PE KG BARU', kod: 'KB1', team: 'ALPHA', no_rondaan: 'N 8/2', no_lama: 'JBT4A 7', lat: 3.0731, lng: 101.5183 });
    expect(r.row!.defects).toEqual(['TIANG_CONDONG', 'PENGALIR_KAWASAN']);
    expect(r.row!.rondaan_at).toBe('2023-12-29T08:46:42.000Z'); // 4:46 petang waktu Malaysia
  });
  it('menerima satu lajur koordinat gabungan dan melaporkan medan yang tiada', () => {
    expect(mapSavrRow({ 'NAMA PENCAWANG': 'A', 'KOD PENCAWANG': 'B', 'No Tiang RONDAAN': 'N 1', LOKASI: '3.05, 101.52' }).row).toMatchObject({ lat: 3.05, lng: 101.52 });
    expect(mapSavrRow({ 'NAMA PENCAWANG': 'A', 'KOD PENCAWANG': 'B', 'No Tiang RONDAAN': 'N 1' }).error).toMatch(/Koordinat/);
    expect(mapSavrRow({ 'KOD PENCAWANG': 'B', 'No Tiang RONDAAN': 'N 1', LATITUDE: 3, LONGITUDE: 101 }).error).toMatch(/PENCAWANG/);
    expect(mapSavrRow({ 'NAMA PENCAWANG': 'A', 'KOD PENCAWANG': 'B', 'No Tiang RONDAAN': 'N 1', LATITUDE: 300, LONGITUDE: 101 }).error).toMatch(/julat/);
  });
  it('tarikh', () => {
    expect(parseSavrDate('18/12/2023, 02:08:53 pm')).toBe('2023-12-18T06:08:53.000Z');
    expect(parseSavrDate('01/01/2024 00:30')).toBe('2023-12-31T16:30:00.000Z');
    expect(parseSavrDate('bukan tarikh')).toBeNull();
    expect(parseSavrDate('')).toBeNull();
  });
  it('CSV: petikan dan formula dineutralkan', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('kata "x"')).toBe('"kata ""x"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5'); // nombor negatif sebenar tidak diubah
    expect(csvCell(null)).toBe('');
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,');
  });
});

describe('data contoh', () => {
  it('deterministik, nombor tiang unik bagi setiap pencawang, dalam kawasan Shah Alam', () => {
    const now = Date.UTC(2026, 10, 26);
    let total = 0;
    SAMPLE_GROUPS.forEach((_, g) => {
      const a = samplePoles(g, now);
      const b = samplePoles(g, now);
      expect(a).toEqual(b);
      expect(new Set(a.map((p) => p.no)).size).toBe(a.length);
      for (const p of a) {
        expect(p.lat).toBeGreaterThan(3.0);
        expect(p.lat).toBeLessThan(3.06);
        expect(p.lng).toBeGreaterThan(101.5);
        expect(p.lng).toBeLessThan(101.57);
        expect(p.prev).toBeLessThan(a.length);
        if (p.rondaanAt) expect(Date.parse(p.rondaanAt)).toBeLessThanOrEqual(now);
        if (!p.rondaanAt) expect(p.defects).toHaveLength(0);
      }
      total += a.length;
    });
    expect(total).toBeGreaterThan(1200);
    expect(total).toBeLessThan(1800);
  });
});

describe('peta', () => {
  it('gaya peta sah mengikut spesifikasi MapLibre', () => {
    const errors = validateStyleMin(buildStyle() as never);
    expect(errors.map((e) => e.message)).toEqual([]);
  });
  it('poligon tertutup', () => {
    for (const ring of [ngon(101.5, 3, 1, 8), rect(101.5, 3, 2, 0.3, 0.4), ribbon([101.5, 3], [101.5003, 3.0002], 0.2)]) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.length).toBeGreaterThanOrEqual(5);
    }
  });
});
