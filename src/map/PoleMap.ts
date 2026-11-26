// Pembungkus MapLibre untuk peta tiang 3D.
import {
  AttributionControl, type GeoJSONSource, LngLatBounds, Map as MlMap, type MapMouseEvent, NavigationControl, Popup, ScaleControl, setWorkerUrl,
} from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type GeoRow, POLE_STATUS, POLE_STATUS_COLOR, POLE_STATUS_LABEL } from '../../shared/types';
import { angleBetween, clamp, distanceM, ngon, rect, ribbon } from './geometry';
import { BEACON_MINZOOM, LAYERS_3D_MINZOOM, PICK_LAYERS, buildStyle } from './style';

// MapLibre v6 ialah ESM; URL worker mesti diberi secara jelas bila dibundel.
setWorkerUrl(workerUrl);

export interface PolePoint { id: number; lat: number; lng: number; s: number; no: string; sub: number; prev: number | null; team: number | null }
export interface MapFilter { statuses: Set<number>; substation: number | null; team: number | null }
export type Basemap = 'satelit' | 'gelap';

const COLORS = POLE_STATUS.map((s) => POLE_STATUS_COLOR[s]);
const POLE_HEIGHT = 9.5;
const DEFAULT_CENTER: [number, number] = [101.5345, 3.0262];
type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const fc = (features: Feature[]) => ({ type: 'FeatureCollection' as const, features }) as unknown as FeatureCollection;

export class PoleMap {
  readonly map: MlMap;
  private all = new Map<number, PolePoint>();
  private shown: PolePoint[] = [];
  private filter: MapFilter = { statuses: new Set(POLE_STATUS.map((_, i) => i)), substation: null, team: null };
  private selected: number | null = null;
  private ready = false;
  private fitted = false;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  private hover = new Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'pole-hover' });
  private hoverId: number | null = null;

  constructor(
    container: HTMLElement,
    private onSelect: (id: number | null) => void,
  ) {
    this.map = new MlMap({
      container,
      style: buildStyle(),
      center: DEFAULT_CENTER,
      zoom: 14,
      pitch: 55,
      bearing: -17,
      maxPitch: 78,
      maxZoom: 20.5,
      attributionControl: false,
    });
    const map = this.map;
    map.addControl(new ScaleControl({ maxWidth: 110 }), 'bottom-left');
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
    const attribution = new AttributionControl({ compact: true });
    map.addControl(attribution, 'bottom-right');
    // Atribusi kekal ada (butang "i"), cuma bermula dalam keadaan tertutup supaya tak menutup peta di telefon.
    const collapse = () => {
      const el = container.querySelector('.maplibregl-ctrl-attrib');
      el?.classList.remove('maplibregl-compact-show');
      el?.removeAttribute('open');
    };
    collapse();
    map.once('style.load', collapse);
    // 'style.load' berlaku sebaik gaya sedia, tanpa menunggu tile luar (yang mungkin lambat atau gagal).
    map.once('style.load', () => {
      this.ready = true;
      this.render();
    });
    map.on('moveend', () => this.build3d());
    map.on('zoom', () => {
      if (this.zoomTimer) return;
      this.zoomTimer = setTimeout(() => {
        this.zoomTimer = null;
        this.build3d();
      }, 140);
    });
    map.on('click', (e) => this.handleClick(e));
    map.on('mousemove', (e) => this.handleHover(e));
    map.on('mouseout', () => this.clearHover());
    this.pulse = setInterval(() => this.animate(), 80);
    (window as unknown as { __poleMap?: PoleMap }).__poleMap = this;
  }

  destroy() {
    if (this.pulse) clearInterval(this.pulse);
    if (this.zoomTimer) clearTimeout(this.zoomTimer);
    this.hover.remove();
    this.map.remove();
    const w = window as unknown as { __poleMap?: PoleMap };
    if (w.__poleMap === this) delete w.__poleMap;
  }

  // ---------- Data ----------
  setPoles(rows: GeoRow[]) {
    this.all = new Map(rows.map((r) => [r[0], { id: r[0], lat: r[1], lng: r[2], s: r[3], no: r[4], sub: r[5], prev: r[6], team: r[7] }]));
    this.render();
    if (!this.fitted && this.all.size) {
      this.fitted = true;
      this.fitAll(false);
    }
  }

  setFilter(f: MapFilter) {
    this.filter = f;
    this.render();
  }

  get(id: number) {
    return this.all.get(id);
  }
  get visibleCount() {
    return this.shown.length;
  }

  private matches(p: PolePoint) {
    const f = this.filter;
    return f.statuses.has(p.s) && (f.substation === null || p.sub === f.substation) && (f.team === null || p.team === f.team);
  }

  private src(id: string) {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  /** Kemas kini semua sumber dari data + tapisan semasa. Kluster dikira sebelum tapisan lapisan, jadi data ditapis di sini. */
  private render() {
    if (!this.ready) return;
    this.shown = [...this.all.values()].filter((p) => this.matches(p));
    this.src('pts')?.setData(
      fc(this.shown.map((p) => ({ type: 'Feature', properties: { id: p.id, s: p.s, no: p.no }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }))),
    );
    this.build3d();
    this.drawSelection();
  }

  /** Bina geometri 3D hanya untuk kawasan yang sedang dilihat (ditambah sedikit jidar). */
  private build3d() {
    if (!this.ready) return;
    const map = this.map;
    const z = map.getZoom();
    const p3d: Feature[] = [];
    const beacons: Feature[] = [];
    if (z >= BEACON_MINZOOM - 0.5) {
      const b = map.getBounds();
      const padLng = (b.getEast() - b.getWest()) * 0.35, padLat = (b.getNorth() - b.getSouth()) * 0.35;
      const w = b.getWest() - padLng, e = b.getEast() + padLng, s = b.getSouth() - padLat, n = b.getNorth() + padLat;
      const draw3d = z >= LAYERS_3D_MINZOOM - 0.3;
      // Pada zum jauh, tiang dibesarkan sedikit supaya masih nampak; pada zum dekat ia hampir saiz sebenar.
      const k = clamp(2 ** (18.2 - z), 1, 3);
      const kb = clamp(2 ** (17.4 - z), 1, 12);
      const H = POLE_HEIGHT * (1 + (k - 1) * 0.45);
      for (const p of this.shown) {
        if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) continue;
        const c = COLORS[p.s];
        if (p.s >= 2) {
          const tall = p.s === 2 ? 30 : 18;
          beacons.push({ type: 'Feature', properties: { c, h: Math.min(260, tall * kb ** 0.85) }, geometry: { type: 'Polygon', coordinates: [ngon(p.lng, p.lat, 1.9 * kb ** 0.9, 10)] } });
        }
        if (!draw3d) continue;
        const here: [number, number] = [p.lng, p.lat];
        const prev = p.prev !== null ? this.all.get(p.prev) : undefined;
        const prevPt: [number, number] | null = prev && distanceM(here, [prev.lng, prev.lat]) < 90 ? [prev.lng, prev.lat] : null;
        const armAngle = (prevPt ? angleBetween(here, prevPt) : 0) + Math.PI / 2;
        const props = { id: p.id };
        p3d.push(
          { type: 'Feature', properties: { ...props, c: shade(c, 0.78), b: 0, h: H }, geometry: { type: 'Polygon', coordinates: [ngon(p.lng, p.lat, 0.42 * k, 8)] } },
          { type: 'Feature', properties: { ...props, c, b: H, h: H + 0.95 * k }, geometry: { type: 'Polygon', coordinates: [ngon(p.lng, p.lat, 0.85 * k, 8)] } },
          { type: 'Feature', properties: { ...props, c: '#cbd5e1', b: H - 1.5, h: H - 1.22 }, geometry: { type: 'Polygon', coordinates: [rect(p.lng, p.lat, 2.3 * k, 0.26 * k, armAngle)] } },
        );
        if (prevPt && this.matches(prev!)) {
          p3d.push({ type: 'Feature', properties: { c: '#111827', b: H - 1.42, h: H - 1.3 }, geometry: { type: 'Polygon', coordinates: [ribbon(here, prevPt, 0.16 * k)] } });
        }
      }
    }
    this.src('p3d')?.setData(fc(p3d));
    this.src('beacon')?.setData(fc(beacons));
  }

  // ---------- Pemilihan ----------
  /** `fly: 'auto'` hanya gerakkan kamera jika tiang itu di luar paparan atau zum masih terlalu jauh. */
  select(id: number | null, fly: boolean | 'auto' = false) {
    this.selected = id;
    this.drawSelection();
    const p = id !== null ? this.all.get(id) : undefined;
    if (!p || !fly) return;
    if (fly === 'auto' && this.map.getZoom() >= 16 && this.map.getBounds().contains([p.lng, p.lat])) return;
    this.map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(this.map.getZoom(), 18.2), pitch: 60, speed: 1.4, essential: true });
  }

  private drawSelection() {
    if (!this.ready) return;
    const p = this.selected !== null ? this.all.get(this.selected) : undefined;
    if (!p) return void this.src('sel')?.setData(fc([]));
    this.src('sel')?.setData(
      fc([
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } },
        { type: 'Feature', properties: { h: 22 }, geometry: { type: 'Polygon', coordinates: [ngon(p.lng, p.lat, 1.6, 12)] } },
      ]),
    );
  }

  /** Cari tiang terdekat dengan titik klik (tiang 3D hanya beberapa piksel lebar, jadi kotak carian dilebarkan). */
  private pick(e: MapMouseEvent, pad = 9): PolePoint | null {
    const { x, y } = e.point;
    const layers = PICK_LAYERS.filter((l) => this.map.getLayer(l));
    const feats = this.map.queryRenderedFeatures([[x - pad, y - pad], [x + pad, y + pad]], { layers });
    let best: PolePoint | null = null;
    let bestD = Infinity;
    for (const f of feats) {
      const id = Number(f.properties?.id);
      const p = this.all.get(id);
      if (!p) continue;
      const pt = this.map.project([p.lng, p.lat]);
      const d = Math.hypot(pt.x - x, pt.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private handleClick(e: MapMouseEvent) {
    const p = this.pick(e);
    if (p) {
      this.onSelect(p.id);
      return;
    }
    const clusters = this.map.queryRenderedFeatures(e.point, { layers: ['cluster'] });
    if (clusters.length) {
      const c = clusters[0];
      const coords = (c.geometry as Point).coordinates as [number, number];
      this.src('pts')
        ?.getClusterExpansionZoom(Number(c.properties?.cluster_id))
        .then((zoom) => this.map.easeTo({ center: coords, zoom: Math.min(zoom + 0.4, 17) }))
        .catch(() => {});
    }
  }

  private handleHover(e: MapMouseEvent) {
    const p = this.pick(e, 6);
    const overCluster = !p && this.map.queryRenderedFeatures(e.point, { layers: ['cluster'] }).length > 0;
    this.map.getCanvas().style.cursor = p || overCluster ? 'pointer' : '';
    if (!p) return this.clearHover();
    if (this.hoverId === p.id) return;
    this.hoverId = p.id;
    const el = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = p.no;
    const s = document.createElement('span');
    s.textContent = ` · ${POLE_STATUS_LABEL[POLE_STATUS[p.s]]}`;
    el.append(b, s);
    this.hover.setLngLat([p.lng, p.lat]).setDOMContent(el).addTo(this.map);
  }

  private clearHover() {
    if (this.hoverId === null) return;
    this.hoverId = null;
    this.hover.remove();
  }

  // ---------- Kamera & paparan ----------
  fitAll(animate = true) {
    if (!this.shown.length) return;
    const b = new LngLatBounds();
    for (const p of this.shown) b.extend([p.lng, p.lat]);
    this.map.fitBounds(b, { padding: 70, pitch: this.map.getPitch(), bearing: this.map.getBearing(), maxZoom: 17.5, duration: animate ? 900 : 0 });
  }

  flyTo(lng: number, lat: number, zoom = 18.2) {
    this.map.flyTo({ center: [lng, lat], zoom, pitch: 60, speed: 1.4, essential: true });
  }

  getCenter(): { lat: number; lng: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  setBasemap(b: Basemap) {
    if (!this.ready) return void this.map.once('style.load', () => this.setBasemap(b));
    this.map.setLayoutProperty('sat', 'visibility', b === 'satelit' ? 'visible' : 'none');
    this.map.setPaintProperty('buildings-3d', 'fill-extrusion-color', b === 'satelit' ? '#8fa0b8' : '#2b3d5c');
    this.map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', b === 'satelit' ? 0.7 : 0.9);
  }

  setBuildings(on: boolean) {
    if (!this.ready) return void this.map.once('style.load', () => this.setBuildings(on));
    this.map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none');
  }

  set3d(on: boolean) {
    this.map.easeTo({ pitch: on ? 58 : 0, bearing: on ? -17 : 0, duration: 600 });
  }

  resize() {
    this.map.resize();
  }

  /** Denyutan untuk tiang "belum disenggara". Dihentikan bila tab tidak dilihat. */
  private animate() {
    if (!this.ready || document.visibilityState !== 'visible' || this.map.getZoom() < 14.5) return;
    const t = (performance.now() % 1500) / 1500;
    this.map.setPaintProperty('halo', 'circle-radius', 8 + t * 22);
    this.map.setPaintProperty('halo', 'circle-opacity', 0.5 * (1 - t));
  }
}

/** Gelapkan warna hex (faktor < 1) untuk batang tiang. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
