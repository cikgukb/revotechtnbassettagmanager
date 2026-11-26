// Geometri kecil untuk tiang 3D. Semua ukuran dalam meter, ditukar ke darjah mengikut latitud.
const M_PER_DEG = 111320;

export type Ring = [number, number][];

/** Poligon n-sisi (silinder bila di-extrude). */
export function ngon(lng: number, lat: number, radiusM: number, sides = 8): Ring {
  const k = Math.cos((lat * Math.PI) / 180);
  const ring: Ring = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([lng + (Math.cos(a) * radiusM) / (M_PER_DEG * k), lat + (Math.sin(a) * radiusM) / M_PER_DEG]);
  }
  return ring;
}

/** Segi empat berpusat di (lng, lat), panjang sepanjang `angle` (radian, 0 = timur). */
export function rect(lng: number, lat: number, lengthM: number, widthM: number, angle: number): Ring {
  const k = Math.cos((lat * Math.PI) / 180);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const hl = lengthM / 2, hw = widthM / 2;
  const pt = (a: number, b: number): [number, number] => [
    lng + (ux * a - uy * b) / (M_PER_DEG * k),
    lat + (uy * a + ux * b) / M_PER_DEG,
  ];
  return [pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw), pt(-hl, -hw)];
}

/** Jalur nipis antara dua titik (untuk pengalir). */
export function ribbon(a: [number, number], b: [number, number], widthM: number): Ring {
  const k = Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * M_PER_DEG * k, dy = (b[1] - a[1]) * M_PER_DEG;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (widthM / 2), ny = (dx / len) * (widthM / 2);
  const off = (p: [number, number], s: number): [number, number] => [p[0] + (nx * s) / (M_PER_DEG * k), p[1] + (ny * s) / M_PER_DEG];
  return [off(a, 1), off(b, 1), off(b, -1), off(a, -1), off(a, 1)];
}

/** Sudut (radian) dari a ke b dalam satah tempatan. */
export function angleBetween(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.atan2(b[1] - a[1], (b[0] - a[0]) * k);
}

export function distanceM(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * M_PER_DEG * k, (b[1] - a[1]) * M_PER_DEG);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
