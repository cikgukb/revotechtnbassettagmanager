// Format lajur "SENARAI TIANG SAVR" untuk import & eksport CSV/Excel.
import { DEFECT_CATEGORIES, type DefectCategory } from './types';

export interface ImportRowInput {
  pencawang: string;
  kod: string;
  functional_location?: string | null;
  team?: string | null;
  no_rondaan: string;
  no_lama?: string | null;
  street?: string | null;
  pole_type?: string | null;
  material?: string | null;
  height_m?: number | null;
  install_year?: number | null;
  lat: number;
  lng: number;
  rondaan_at?: string | null;
  defects: DefectCategory[];
}

type TextKey = 'pencawang' | 'kod' | 'functional_location' | 'team' | 'no_rondaan' | 'no_lama' | 'street' | 'pole_type' | 'material';

export const SAVR_COLUMNS: { key: string; header: string; aliases?: string[] }[] = [
  { key: 'pencawang', header: 'NAMA PENCAWANG', aliases: ['PENCAWANG', 'NAMA PE'] },
  { key: 'mainhead', header: 'MAINHEAD' },
  { key: 'team', header: 'TEAM', aliases: ['PASUKAN'] },
  { key: 'functional_location', header: 'FUNCTIONAL LOCATION', aliases: ['FUNC LOC', 'FLOC'] },
  { key: 'kod', header: 'KOD PENCAWANG', aliases: ['KOD PE', 'KOD'] },
  { key: 'no_rondaan', header: 'No Tiang RONDAAN', aliases: ['NO TIANG', 'NO TIANG BARU'] },
  { key: 'no_lama', header: 'No Tiang LAMA' },
  { key: 'rondaan_at', header: 'DATE / TIME', aliases: ['DATE/TIME', 'TARIKH', 'DATE TIME', 'TARIKH RONDAAN'] },
  { key: 'street', header: 'NAMA JALAN', aliases: ['JALAN'] },
  { key: 'pole_type', header: 'JENIS TIANG', aliases: ['JENIS'] },
  { key: 'material', header: 'BAHAN' },
  { key: 'height_m', header: 'TINGGI (m)', aliases: ['TINGGI'] },
  { key: 'install_year', header: 'TAHUN PASANG', aliases: ['TAHUN'] },
  { key: 'lat', header: 'LATITUDE', aliases: ['LAT'] },
  { key: 'lng', header: 'LONGITUDE', aliases: ['LONG', 'LNG', 'LON'] },
  { key: 'latlng', header: 'LOKASI', aliases: ['LATLONG', 'LAT LONG', 'GPS', 'KOORDINAT', 'LOCATION'] },
];

export const DEFECT_COLUMNS: Record<DefectCategory, string> = {
  TIANG_REPUT: 'TIANG - Reput/Retak',
  TIANG_CONDONG: 'TIANG - Condong',
  TIANG_NOMBOR: 'TIANG - Nombor Pudar',
  PENGALIR_MIDSPAN: 'PENGALIR - Mid-Span',
  PENGALIR_KAWASAN: 'PENGALIR - Kawasan',
  IKLAN_HARAM: 'IKLAN HARAM',
  LAIN: 'LAIN-LAIN',
};

/** Samakan tajuk lajur: huruf besar, buang simbol, satu ruang. */
export const normHeader = (h: string) => String(h ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const HEADER_TO_KEY = new Map<string, string>();
for (const col of SAVR_COLUMNS) {
  HEADER_TO_KEY.set(normHeader(col.header), col.key);
  for (const a of col.aliases ?? []) HEADER_TO_KEY.set(normHeader(a), col.key);
}
const DEFECT_HEADER_TO_CAT = new Map<string, DefectCategory>();
for (const cat of DEFECT_CATEGORIES) DEFECT_HEADER_TO_CAT.set(normHeader(DEFECT_COLUMNS[cat]), cat);

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Terima "29/12/2023, 04:46:42 pm", "29/12/2023 16:46", ISO, atau objek Date; anggap waktu Malaysia (UTC+8). */
export function parseSavrDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i);
  if (m) {
    let h = Number(m[4] ?? 0);
    const ap = m[7]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const utc = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h - 8, Number(m[5] ?? 0), Number(m[6] ?? 0));
    return Number.isNaN(utc) ? null : new Date(utc).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Tukar satu baris mentah (tajuk lajur -> nilai) kepada bentuk import.
 * Pulangkan `error` jika medan wajib tiada, supaya pengguna nampak baris mana yang bermasalah.
 */
export function mapSavrRow(raw: Record<string, unknown>): { row?: ImportRowInput; error?: string } {
  const out: Record<string, unknown> = {};
  const defects: DefectCategory[] = [];
  for (const [header, value] of Object.entries(raw)) {
    const h = normHeader(header);
    const key = HEADER_TO_KEY.get(h);
    if (key) {
      out[key] = value;
      continue;
    }
    const cat = DEFECT_HEADER_TO_CAT.get(h) ?? [...DEFECT_HEADER_TO_CAT.entries()].find(([k]) => h.startsWith(k))?.[1];
    if (cat) {
      const n = num(value);
      if (n !== null && n > 0 && !defects.includes(cat)) defects.push(cat);
    }
  }
  let lat = num(out.lat);
  let lng = num(out.lng);
  if ((lat === null || lng === null) && str(out.latlng)) {
    const parts = String(out.latlng).split(/[,;\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) [lat, lng] = parts;
  }
  const text = (k: TextKey) => str(out[k]);
  const pencawang = text('pencawang');
  const kod = text('kod');
  const noRondaan = text('no_rondaan');
  if (!pencawang) return { error: 'NAMA PENCAWANG kosong' };
  if (!kod) return { error: 'KOD PENCAWANG kosong' };
  if (!noRondaan) return { error: 'No Tiang RONDAAN kosong' };
  if (lat === null || lng === null) return { error: 'Koordinat (LATITUDE / LONGITUDE) tiada' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: 'Koordinat di luar julat' };
  const year = num(out.install_year);
  return {
    row: {
      pencawang,
      kod,
      functional_location: text('functional_location'),
      team: text('team'),
      no_rondaan: noRondaan,
      no_lama: text('no_lama'),
      street: text('street'),
      pole_type: text('pole_type'),
      material: text('material'),
      height_m: num(out.height_m),
      install_year: year === null ? null : Math.round(year),
      lat,
      lng,
      rondaan_at: parseSavrDate(out.rondaan_at),
      defects,
    },
  };
}

/** Sel CSV yang selamat: petik bila perlu, dan neutralkan formula (=, +, -, @) supaya Excel tak jalankannya. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
