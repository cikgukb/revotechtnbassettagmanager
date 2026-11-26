// Penjana data contoh: tiang diletak sepanjang jalan sebenar Seksyen 25, Shah Alam
// (geometri jalan dari OpenStreetMap). Semua nama pencawang, nombor tiang dan defect adalah REKAAN.
import streetData from './sample-streets.json';
import type { DefectCategory, DefectStatus, Severity } from './types';

export interface SampleGroup { name: string; code: string; fl: string; lat: number; lng: number; team: string }
interface Street { n: string; g: number; p: [number, number][] }

const data = streetData as unknown as { source: string; groups: SampleGroup[]; streets: Street[] };

export const SAMPLE_ZONE = 'SHAH ALAM';
export const SAMPLE_TEAMS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
export const SAMPLE_GROUPS: SampleGroup[] = data.groups;
export const SAMPLE_SOURCE = data.source;

export interface SampleDefect { category: DefectCategory; severity: Severity; status: DefectStatus; reportedAt: string; startedAt?: string; completedAt?: string; verifiedAt?: string }
export interface SamplePole {
  no: string; lama: string | null; street: string; lat: number; lng: number;
  /** indeks tiang sebelum dalam senarai yang sama (untuk lukis pengalir), atau -1 */
  prev: number;
  type: string; material: string; height: number; year: number;
  createdAt: string; rondaanAt: string | null; defects: SampleDefect[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG = 111320;
const SPACING_M = 36;
const SIDE_OFFSET_M = 3.2;

/** Titik setiap SPACING_M sepanjang garisan jalan, dianjak ke tepi jalan. */
function walk(line: [number, number][]): [number, number][] {
  const k = Math.cos((line[0][1] * Math.PI) / 180);
  const out: [number, number][] = [];
  let next = 14;
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0] * M_PER_DEG * k, ay = line[i - 1][1] * M_PER_DEG;
    const bx = line[i][0] * M_PER_DEG * k, by = line[i][1] * M_PER_DEG;
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg === 0) continue;
    const ux = (bx - ax) / seg, uy = (by - ay) / seg;
    while (next <= travelled + seg) {
      const d = next - travelled;
      const x = ax + ux * d + uy * SIDE_OFFSET_M;
      const y = ay + uy * d - ux * SIDE_OFFSET_M;
      out.push([+(x / (M_PER_DEG * k)).toFixed(7), +(y / M_PER_DEG).toFixed(7)]);
      next += SPACING_M;
    }
    travelled += seg;
  }
  return out;
}

const CATS: [DefectCategory, number][] = [
  ['TIANG_NOMBOR', 0.28], ['PENGALIR_KAWASAN', 0.24], ['TIANG_CONDONG', 0.15], ['TIANG_REPUT', 0.11], ['PENGALIR_MIDSPAN', 0.11], ['IKLAN_HARAM', 0.11],
];
const STATUSES: [DefectStatus, number][] = [['belum', 0.5], ['sedang', 0.14], ['selesai', 0.14], ['disahkan', 0.22]];
function pick<T>(rnd: () => number, table: [T, number][]): T {
  let r = rnd();
  for (const [v, w] of table) {
    if (r < w) return v;
    r -= w;
  }
  return table[table.length - 1][0];
}

// Peratus tiang yang sudah dironda bagi setiap pencawang: menunjukkan kemajuan kerja yang berbeza.
const PROGRESS = [1, 1, 1, 0.95, 1, 0.7, 0.4, 0.12];

/**
 * Jana tiang untuk satu pencawang contoh. Deterministik: indeks kumpulan yang sama memberi tiang yang sama.
 * `nowMs` hanya menentukan tarikh, supaya data sentiasa nampak baru.
 */
export function samplePoles(group: number, nowMs: number): SamplePole[] {
  const rnd = mulberry32(7919 + group * 104729);
  const g = SAMPLE_GROUPS[group];
  const lines = data.streets.filter((s) => s.g === group);
  const prefix = g.code.replace(/[^A-Z]/g, '').slice(0, 3);
  const out: SamplePole[] = [];
  const progress = PROGRESS[group] ?? 1;
  // Rondaan kumpulan ini bermula beberapa hari lepas, 9 pagi waktu Malaysia, satu tiang setiap ~2 minit.
  const dayStart = Math.floor((nowMs + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000;
  let clock = dayStart - (16 - group * 2) * 86400_000 + 9 * 3600_000;
  let oldNo = 1;
  let n = 0;

  lines.forEach((line, li) => {
    const pts = walk(line.p);
    let svc = 0;
    let sub = 0;
    pts.forEach((pt, pi) => {
      const service = pi > 0 && rnd() < 0.14;
      let no: string;
      if (pi === 0) no = `N ${li + 1}`;
      else if (service) no = `N ${li + 1}/S${++svc}`;
      else no = `N ${li + 1}/${++sub}`;
      const inspected = n / Math.max(1, countPoles(lines)) < progress;
      let rondaanAt: string | null = null;
      if (inspected) {
        clock += 90_000 + Math.floor(rnd() * 90_000);
        // Lepas 5 petang, sambung esok pagi.
        const local = new Date(clock + 8 * 3600_000);
        if (local.getUTCHours() >= 17) clock += (24 - local.getUTCHours() + 9) * 3600_000 - local.getUTCMinutes() * 60_000;
        if (clock > nowMs - 600_000) clock = nowMs - 600_000 - Math.floor(rnd() * 3600_000);
        rondaanAt = new Date(clock).toISOString();
      }
      const defects: SampleDefect[] = [];
      if (rondaanAt && rnd() < 0.17) {
        const count = rnd() < 0.15 ? 2 : 1;
        const used = new Set<DefectCategory>();
        for (let d = 0; d < count; d++) {
          const category = pick(rnd, CATS);
          if (used.has(category)) continue;
          used.add(category);
          const status = pick(rnd, STATUSES);
          const sev: Severity = category === 'TIANG_REPUT' || category === 'TIANG_CONDONG' ? (rnd() < 0.6 ? 'tinggi' : 'sederhana') : rnd() < 0.5 ? 'sederhana' : 'rendah';
          const t0 = Date.parse(rondaanAt);
          const cap = (ms: number) => new Date(Math.min(ms, nowMs - 60_000)).toISOString();
          const def: SampleDefect = { category, severity: sev, status, reportedAt: rondaanAt };
          if (status !== 'belum') def.startedAt = cap(t0 + (1 + rnd() * 2) * 86400_000);
          if (status === 'selesai' || status === 'disahkan') def.completedAt = cap(Date.parse(def.startedAt!) + (2 + rnd() * 6) * 3600_000);
          if (status === 'disahkan') def.verifiedAt = cap(Date.parse(def.completedAt!) + (4 + rnd() * 20) * 3600_000);
          defects.push(def);
        }
      }
      const created = rondaanAt ? Date.parse(rondaanAt) - 60_000 : dayStart - 20 * 86400_000 + n * 60_000;
      out.push({
        no,
        lama: service ? 'SERVICE' : `${prefix}${1 + (li % 9)}${'AB'[li % 2]} ${oldNo++}`,
        street: line.n,
        lng: pt[0],
        lat: pt[1],
        prev: pi > 0 ? out.length - 1 : -1,
        type: service ? 'Servis' : rnd() < 0.3 ? 'LV + Lampu Jalan' : 'LV',
        material: rnd() < 0.72 ? 'Konkrit' : rnd() < 0.7 ? 'Spun' : 'Kayu',
        height: service ? 7.5 : rnd() < 0.8 ? 9 : 10,
        year: 1992 + Math.floor(rnd() * 28),
        createdAt: new Date(created).toISOString(),
        rondaanAt,
        defects,
      });
      n++;
    });
  });
  return out;
}

const countCache = new Map<Street[], number>();
function countPoles(lines: Street[]): number {
  let c = countCache.get(lines);
  if (c === undefined) {
    c = lines.reduce((s, l) => s + walk(l.p).length, 0);
    countCache.set(lines, c);
  }
  return c;
}
