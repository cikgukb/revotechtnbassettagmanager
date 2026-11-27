// Lakaran rangkaian tiang bagi satu pencawang (PE), gaya lukisan "single line" TNB:
// tiang diletak ikut koordinat sebenar, disambung ke tiang sebelum, dan dilabel dengan nombor tiang.
// Fungsi di sini tulen (tiada DOM) supaya boleh diuji dan dikongsi.
import type { PoleStatus } from './types';

export interface SchematicPole {
  id: number;
  no: string;
  prev: number | null;
  lat: number;
  lng: number;
  type: string | null;
  height: number | null;
  status: PoleStatus;
  open: number;
}

export interface SchematicSubstation {
  id: number;
  name: string;
  code: string;
  functional_location: string | null;
  lat: number | null;
  lng: number | null;
}

export interface SchematicData {
  substation: SchematicSubstation;
  poles: SchematicPole[];
}

export const POLE_KINDS = ['p10', 'p9', 'p75', 'lain'] as const;
export type PoleKind = (typeof POLE_KINDS)[number];
export const POLE_KIND_INFO: Record<PoleKind, { label: string; color: string }> = {
  p10: { label: 'TIANG 10 METER', color: '#1530e8' },
  p9: { label: 'TIANG 9 METER', color: '#141a5c' },
  p75: { label: 'TIANG 7.5 METER / SERVIS', color: '#dc2626' },
  lain: { label: 'TIANG (TINGGI TIADA)', color: '#64748b' },
};

export function poleKind(p: Pick<SchematicPole, 'type' | 'height'>): PoleKind {
  const h = p.height;
  if (p.type === 'Servis' || (h !== null && h < 8.5)) return 'p75';
  if (h !== null && h >= 9.5) return 'p10';
  if (h !== null && h >= 8.5) return 'p9';
  return 'lain';
}

/** Huruf awalan nombor tiang = feeder. "CE 22" -> "CE", "A 9/1" -> "A". */
export const feederOf = (no: string): string | null => no.trim().match(/^([A-Za-z]+)/)?.[1].toUpperCase() ?? null;

/** Senarai feeder ikut kekerapan (paling banyak dahulu). */
export function feeders(poles: Pick<SchematicPole, 'no'>[]): string[] {
  const n = new Map<string, number>();
  for (const p of poles) {
    const f = feederOf(p.no);
    if (f) n.set(f, (n.get(f) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
}

/** Senarai feeder dalam bentuk "A, B, C & CDE". */
export const joinList = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '-') : `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`);

export interface Box { x: number; y: number; w: number; h: number }
export interface LaidNode {
  id: number; x: number; y: number; kind: PoleKind; label: string;
  lx: number; ly: number; anchor: 'start' | 'middle' | 'end';
  open: number; status: PoleStatus;
}
export interface LaidEdge { x1: number; y1: number; x2: number; y2: number; service: boolean }
export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  pe: { x: number; y: number } | null;
  /** meter bagi setiap unit lukisan (untuk bar skala) */
  metersPerUnit: number;
}

const M_PER_DEG = 111_320;
/** Tiang pertama yang dalam jarak ini dari PE dianggap disambung terus ke PE. */
const PE_LINK_M = 120;

export interface LayoutOptions {
  fontSize?: number;
  /** jejari bulatan tiang (unit lukisan) */
  radius?: number;
}

/**
 * Unjur tiang ke dalam kotak lukisan (skala sama pada X dan Y, utara ke atas),
 * sambung setiap tiang ke tiang sebelumnya, dan letak label supaya tidak bertindih.
 */
export function layoutSchematic(data: SchematicData, box: Box, opts: LayoutOptions = {}): Layout {
  const fs = opts.fontSize ?? 11;
  const r = opts.radius ?? 4.5;
  const poles = data.poles.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const sub = data.substation;
  const hasPe = sub.lat !== null && sub.lng !== null && Number.isFinite(sub.lat) && Number.isFinite(sub.lng);
  const pts = poles.map((p) => [p.lng, p.lat] as [number, number]);
  if (hasPe) pts.push([sub.lng!, sub.lat!]);
  if (pts.length === 0) return { nodes: [], edges: [], pe: null, metersPerUnit: 1 };

  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const mx = (lng: number) => lng * M_PER_DEG * k;
  const my = (lat: number) => lat * M_PER_DEG;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lng, lat] of pts) {
    x0 = Math.min(x0, mx(lng)); x1 = Math.max(x1, mx(lng));
    y0 = Math.min(y0, my(lat)); y1 = Math.max(y1, my(lat));
  }
  // Ruang untuk label di tepi.
  const pad = fs * 5;
  const iw = Math.max(1, box.w - pad * 2);
  const ih = Math.max(1, box.h - pad * 2);
  const spanX = Math.max(x1 - x0, 1);
  const spanY = Math.max(y1 - y0, 1);
  // Had zum supaya kawasan kecil (beberapa tiang) tidak terlalu besar: 1 m = paling banyak 3 unit.
  const scale = Math.min(iw / spanX, ih / spanY, 3);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const midX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;
  const px = (lng: number) => cx + (mx(lng) - midX) * scale;
  const py = (lat: number) => cy - (my(lat) - midY) * scale;

  const byId = new Map<number, SchematicPole>();
  for (const p of poles) byId.set(p.id, p);
  const pos = new Map<number, [number, number]>();
  for (const p of poles) pos.set(p.id, [px(p.lng), py(p.lat)]);

  const edges: LaidEdge[] = [];
  for (const p of poles) {
    const a = pos.get(p.id)!;
    const prev = p.prev !== null ? pos.get(p.prev) : undefined;
    if (prev) edges.push({ x1: prev[0], y1: prev[1], x2: a[0], y2: a[1], service: p.type === 'Servis' });
  }
  let pe: Layout['pe'] = null;
  if (hasPe) {
    pe = { x: px(sub.lng!), y: py(sub.lat!) };
    const peM = [mx(sub.lng!), my(sub.lat!)];
    for (const p of poles) {
      if (p.prev !== null && byId.has(p.prev)) continue;
      if (Math.hypot(mx(p.lng) - peM[0], my(p.lat) - peM[1]) <= PE_LINK_M) {
        const a = pos.get(p.id)!;
        edges.push({ x1: pe.x, y1: pe.y, x2: a[0], y2: a[1], service: false });
      }
    }
  }

  // ---- Letak label (tamak, dengan grid ruang supaya pantas untuk ribuan tiang) ----
  const grid = new Grid(fs * 4);
  for (const p of poles) {
    const [x, y] = pos.get(p.id)!;
    grid.add({ x: x - r, y: y - r, w: r * 2, h: r * 2 }, 'node');
  }
  if (pe) grid.add({ x: pe.x - 8, y: pe.y - 8, w: 16, h: 16 }, 'node');
  for (const e of edges) grid.addSeg(e);

  const charW = fs * 0.6;
  const gap = r + 3;
  // [dx, dy, anchor] — kanan dahulu (seperti lukisan asal), kemudian kiri, atas, bawah.
  const CANDIDATES: [number, number, LaidNode['anchor']][] = [
    [gap, fs * 0.35, 'start'], [-gap, fs * 0.35, 'end'],
    [gap * 0.7, -gap * 0.7, 'start'], [-gap * 0.7, -gap * 0.7, 'end'],
    [gap * 0.7, gap * 0.7 + fs * 0.7, 'start'], [-gap * 0.7, gap * 0.7 + fs * 0.7, 'end'],
    [0, -gap - 1, 'middle'], [0, gap + fs * 0.8, 'middle'],
  ];
  // Label tiang yang lebih "sesak" diletak dahulu? Cukup ikut susunan input; tiang awal feeder dahulu.
  const nodes: LaidNode[] = [];
  for (const p of poles) {
    const [x, y] = pos.get(p.id)!;
    const w = p.no.length * charW;
    let best: { s: number; c: (typeof CANDIDATES)[number]; b: Box } | null = null;
    for (let i = 0; i < CANDIDATES.length; i++) {
      const c = CANDIDATES[i];
      const lx = x + c[0];
      const ly = y + c[1];
      const bx = c[2] === 'start' ? lx : c[2] === 'end' ? lx - w : lx - w / 2;
      const b = { x: bx, y: ly - fs * 0.8, w, h: fs };
      let s = i * 0.4 + grid.score(b);
      if (b.x < box.x || b.y < box.y || b.x + b.w > box.x + box.w || b.y + b.h > box.y + box.h) s += 30;
      if (!best || s < best.s) best = { s, c, b };
      if (s === 0) break;
    }
    grid.add(best!.b, 'label');
    nodes.push({
      id: p.id, x, y, kind: poleKind(p), label: p.no,
      lx: x + best!.c[0], ly: y + best!.c[1], anchor: best!.c[2],
      open: p.open, status: p.status,
    });
  }
  return { nodes, edges, pe, metersPerUnit: 1 / scale };
}

type Item = { b: Box; t: 'node' | 'label' } | { s: LaidEdge; t: 'seg' };
class Grid {
  private cells = new Map<string, Item[]>();
  constructor(private size: number) {}
  private keys(b: Box): string[] {
    const out: string[] = [];
    const s = this.size;
    for (let i = Math.floor(b.x / s); i <= Math.floor((b.x + b.w) / s); i++)
      for (let j = Math.floor(b.y / s); j <= Math.floor((b.y + b.h) / s); j++) out.push(`${i},${j}`);
    return out;
  }
  private put(b: Box, it: Item) {
    for (const k of this.keys(b)) {
      const c = this.cells.get(k);
      if (c) c.push(it);
      else this.cells.set(k, [it]);
    }
  }
  add(b: Box, t: 'node' | 'label') { this.put(b, { b, t }); }
  addSeg(s: LaidEdge) {
    const b = { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    // Garisan panjang: daftar sel di sepanjang garisan sahaja, bukan seluruh kotak sempadan.
    const len = Math.hypot(b.w, b.h);
    const steps = Math.max(1, Math.ceil(len / this.size));
    const it: Item = { s, t: 'seg' };
    const seen = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const x = s.x1 + ((s.x2 - s.x1) * i) / steps;
      const y = s.y1 + ((s.y2 - s.y1) * i) / steps;
      const k = `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const c = this.cells.get(k);
      if (c) c.push(it);
      else this.cells.set(k, [it]);
    }
  }
  score(b: Box): number {
    const seen = new Set<Item>();
    let s = 0;
    for (const k of this.keys(b)) {
      for (const it of this.cells.get(k) ?? []) {
        if (seen.has(it)) continue;
        seen.add(it);
        if (it.t === 'seg') { if (segHitsBox(it.s, b)) s += 3; }
        else if (overlap(it.b, b)) s += it.t === 'label' ? 10 : 6;
      }
    }
    return s;
  }
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Liang–Barsky: adakah segmen garisan memotong kotak? */
export function segHitsBox(s: LaidEdge, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const checks: [number, number][] = [
    [-dx, s.x1 - b.x], [dx, b.x + b.w - s.x1], [-dy, s.y1 - b.y], [dy, b.y + b.h - s.y1],
  ];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** Contoh penomboran dari tiang sebenar: "CE 22" -> { feeder: 'CE', no: '22' }. */
export function numberingExample(poles: Pick<SchematicPole, 'no'>[]): { feeder: string; no: string } {
  for (const p of poles) {
    const m = p.no.trim().match(/^([A-Za-z]+)\s*(\d+[A-Za-z]?)/);
    if (m) return { feeder: m[1].toUpperCase(), no: m[2] };
  }
  return { feeder: 'A', no: '1' };
}

/** Panjang bar skala yang "bulat" (10, 20, 50, 100 m …) yang muat dalam `maxUnits`. */
export function niceScale(metersPerUnit: number, maxUnits: number): { meters: number; units: number } {
  const maxM = metersPerUnit * maxUnits;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  let m = steps[0];
  for (const s of steps) if (s <= maxM) m = s;
  return { meters: m, units: m / metersPerUnit };
}
