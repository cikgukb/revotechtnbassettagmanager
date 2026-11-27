// Lakaran PE: lukisan rangkaian tiang satu pencawang (gaya pelan TNB, A3 landskap).
// Boleh dicetak terus (Cetak -> Simpan sebagai PDF) atau dimuat turun sebagai SVG.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Layout, POLE_KINDS, POLE_KIND_INFO, type SchematicData, feeders, joinList, layoutSchematic, niceScale, numberingExample, poleKind,
} from '../../shared/schematic';
import { POLE_STATUS, POLE_STATUS_COLOR, POLE_STATUS_LABEL } from '../../shared/types';
import { fmtDate, fmtNum } from '../fmt';
import { navigate, useLocation } from '../router';
import { useApp, useFetch } from '../store';
import { Button, Empty, ErrorNote, Loading, PageHeader } from '../ui';

// Kertas A3 landskap: 420 x 297 mm, 4 unit = 1 mm.
const W = 1680;
const H = 1188;
const M = 24; // jidar bingkai
const TB_H = 112; // tinggi blok tajuk
const TB_Y = H - M - TB_H;
const DRAW = { x: M + 16, y: M + 16, w: W - 2 * M - 32, h: TB_Y - M - 150 };
const FONT = "'Arial Narrow', Arial, Helvetica, sans-serif";
const LINE = '#e11d48';
const LINE_SVC = '#eab308';
const PE_GREEN = '#22c55e';
const CALLOUT = '#c2410c';

type ColorMode = 'jenis' | 'status';

const store = {
  get: (k: string) => {
    try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
  },
  set: (k: string, v: string) => {
    try { localStorage.setItem(k, v); } catch { /* storan disekat: abaikan */ }
  },
};

export default function SchematicPage() {
  const { meta } = useApp();
  const { query } = useLocation();
  const subs = meta.substations;
  const peId = Number(query.get('pe')) || subs[0]?.id || 0;
  const { data, error, loading } = useFetch<SchematicData>(peId ? `/poles/schematic?substation_id=${peId}` : null);
  const [contractor, setContractor] = useState(() => store.get('lakaran.kontraktor'));
  const [address, setAddress] = useState(() => store.get('lakaran.alamat'));
  const [mode, setMode] = useState<ColorMode>('jenis');
  const [defects, setDefects] = useState(true);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => store.set('lakaran.kontraktor', contractor), [contractor]);
  useEffect(() => store.set('lakaran.alamat', address), [address]);

  const download = () => {
    const svg = svgRef.current;
    if (!svg || !data) return;
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `LAKARAN_PE_${data.substation.code.replace(/[^\w-]+/g, '_')}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="p-4 md:p-6 print:p-0" data-testid="lakaran">
      <style>{'@media print { @page { size: A3 landscape; margin: 0; } }'}</style>
      <div className="no-print">
        <PageHeader
          title="Lakaran PE"
          subtitle="Lukisan rangkaian tiang bagi satu pencawang, sedia untuk dicetak A3"
          actions={
            <>
              <Button variant="secondary" icon="download" onClick={download} disabled={!data?.poles.length}>Muat turun SVG</Button>
              <Button icon="printer" onClick={() => window.print()} disabled={!data?.poles.length}>Cetak / PDF</Button>
            </>
          }
        />
        {subs.length === 0 ? (
          <div className="card"><Empty icon="map" title="Belum ada pencawang" hint="Import senarai tiang atau jana data contoh dahulu." /></div>
        ) : (
          <div className="card mb-3 grid gap-3 p-3 md:grid-cols-[minmax(12rem,1.2fr)_1fr_1.4fr_auto_auto]">
            <label className="block">
              <span className="label">Pencawang (PE)</span>
              <select className="input" value={peId} onChange={(e) => navigate(`/lakaran?pe=${e.target.value}`, true)} data-testid="lakaran-pe">
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Kontraktor</span>
              <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Nama syarikat" maxLength={60} />
            </label>
            <label className="block">
              <span className="label">Alamat kontraktor</span>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Alamat (baris kedua selepas koma)" maxLength={120} />
            </label>
            <label className="block">
              <span className="label">Warna tiang</span>
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as ColorMode)}>
                <option value="jenis">Ikut tinggi tiang</option>
                <option value="status">Ikut status</option>
              </select>
            </label>
            <div className="flex items-end gap-3">
              <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={defects} onChange={(e) => setDefects(e.target.checked)} /> Tanda defect
              </label>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" aria-label="Zum keluar" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</Button>
                <span className="w-10 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
                <Button variant="secondary" size="sm" aria-label="Zum masuk" onClick={() => setZoom((z) => Math.min(6, z * 1.5))}>+</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {peId > 0 && !data && <div className="card p-6">{loading ? <Loading /> : <ErrorNote>{error}</ErrorNote>}</div>}
      {data && data.poles.length === 0 && (
        <div className="card no-print"><Empty icon="map" title="Tiada tiang untuk pencawang ini" hint="Daftar atau import tiang dahulu." /></div>
      )}
      {data && data.poles.length > 0 && (
        <div className="card overflow-auto bg-white print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
          <div style={{ width: `${zoom * 100}%` }} className="print:!w-full">
            <Sheet ref={svgRef} data={data} contractor={contractor} address={address} mode={mode} defects={defects} />
          </div>
        </div>
      )}
    </div>
  );
}

interface SheetProps { data: SchematicData; contractor: string; address: string; mode: ColorMode; defects: boolean; ref?: React.Ref<SVGSVGElement> }

function Sheet({ data, contractor, address, mode, defects, ref }: SheetProps) {
  const layout = useMemo(() => layoutSchematic(data, DRAW), [data]);
  const sub = data.substation;
  const fd = useMemo(() => feeders(data.poles), [data.poles]);
  const ex = useMemo(() => numberingExample(data.poles), [data.poles]);
  const kindCount = useMemo(() => {
    const n = Object.fromEntries(POLE_KINDS.map((k) => [k, 0])) as Record<(typeof POLE_KINDS)[number], number>;
    for (const p of data.poles) n[poleKind(p)]++;
    return n;
  }, [data.poles]);
  const statusCount = useMemo(() => {
    const n = Object.fromEntries(POLE_STATUS.map((s) => [s, 0])) as Record<(typeof POLE_STATUS)[number], number>;
    for (const p of data.poles) n[p.status]++;
    return n;
  }, [data.poles]);
  const openPoles = data.poles.filter((p) => p.open > 0).length;
  const gps = sub.lat !== null && sub.lng !== null ? `${sub.lat.toFixed(6)}°${sub.lng.toFixed(6)}°` : '-';
  const color = (n: Layout['nodes'][number]) => (mode === 'jenis' ? POLE_KIND_INFO[n.kind].color : POLE_STATUS_COLOR[n.status]);
  const scale = niceScale(layout.metersPerUnit, 220);
  const today = fmtDate(new Date().toISOString());

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: FONT }} role="img" aria-label={`Lakaran rangkaian tiang ${sub.name}`}>
      <rect width={W} height={H} fill="#fff" />
      <rect x={M} y={M} width={W - 2 * M} height={H - 2 * M} fill="none" stroke="#111" strokeWidth={1.6} />

      {/* Talian */}
      <g strokeWidth={1.3} strokeLinecap="round">
        {layout.edges.map((e, i) => <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.service ? LINE_SVC : LINE} />)}
      </g>

      {/* Tiang */}
      <g>
        {layout.nodes.map((n) => (
          <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tiang/${n.id}`)}>
            <title>{`${n.label} · ${POLE_STATUS_LABEL[n.status]}${n.open ? ` · ${n.open} defect terbuka` : ''}`}</title>
            {defects && n.open > 0 && <circle cx={n.x} cy={n.y} r={9} fill="none" stroke="#ef4444" strokeWidth={2} />}
            <circle cx={n.x} cy={n.y} r={4.5} fill={color(n)} />
            <text x={n.lx} y={n.ly} fontSize={11} textAnchor={n.anchor} fill="#111">{n.label}</text>
          </g>
        ))}
      </g>

      {layout.pe && <PeMark layout={layout} name={sub.name} gps={gps} />}

      {/* Jalur bawah: ringkasan, skala, kod pencawang, contoh penomboran */}
      <g transform={`translate(${M + 16}, ${TB_Y - 120})`} fontSize={12} fill="#111">
        <text y={0} fontWeight={700} fontSize={13}>RINGKASAN</text>
        <text y={20}>JUMLAH TIANG : {fmtNum(data.poles.length)}</text>
        <text y={38}>TIANG ADA DEFECT TERBUKA : {fmtNum(openPoles)}</text>
        <text y={56}>BELUM DIRONDA : {fmtNum(statusCount.baru)}</text>
        <g transform="translate(0, 84)">
          <line x1={0} y1={0} x2={scale.units} y2={0} stroke="#111" strokeWidth={2} />
          <line x1={0} y1={-5} x2={0} y2={5} stroke="#111" strokeWidth={2} />
          <line x1={scale.units} y1={-5} x2={scale.units} y2={5} stroke="#111" strokeWidth={2} />
          <text x={scale.units / 2} y={-8} textAnchor="middle" fontSize={11}>{scale.meters} m</text>
          <text x={scale.units + 10} y={4} fontSize={11}>SKALA ANGGARAN · UTARA KE ATAS</text>
        </g>
      </g>

      <text x={W - M - 436} y={TB_Y - 108} fontSize={20} letterSpacing={1} fill="#111">KOD PENCAWANG : {sub.code}</text>
      <NumberingBox x={W - M - 436} y={TB_Y - 92} code={sub.code} ex={ex} />

      {/* Blok tajuk */}
      <TitleBlock
        contractor={contractor} address={address} sub={sub} feeders={joinList(fd)} gps={gps} today={today}
        legendPoles={
          mode === 'jenis'
            ? POLE_KINDS.filter((k) => kindCount[k] > 0).map((k) => ({ color: POLE_KIND_INFO[k].color, label: POLE_KIND_INFO[k].label, n: kindCount[k] }))
            : POLE_STATUS.filter((s) => statusCount[s] > 0).map((s) => ({ color: POLE_STATUS_COLOR[s], label: POLE_STATUS_LABEL[s].toUpperCase(), n: statusCount[s] }))
        }
        defects={defects}
      />
    </svg>
  );
}

/** Kotak merah nama PE + GPS, diletak di penjuru yang paling sedikit menutup tiang. */
function PeMark({ layout, name, gps }: { layout: Layout; name: string; gps: string }) {
  const pe = layout.pe!;
  const title = name.toUpperCase();
  const fsBig = 34;
  const fsSmall = 26;
  const bw = Math.max(title.length * fsBig * 0.52, gps.length * fsSmall * 0.5) + 28;
  const bh = fsBig + fsSmall + 30;
  // Cari tempat kosong pada grid seluruh kawasan lukisan: paling sedikit tiang di bawah kotak, kemudian paling dekat dengan PE.
  let b = { x: DRAW.x, y: DRAW.y, score: Infinity };
  const step = 24;
  for (let y = DRAW.y; y <= DRAW.y + DRAW.h - bh; y += step) {
    for (let x = DRAW.x; x <= DRAW.x + DRAW.w - bw; x += step) {
      if (pe.x > x - 20 && pe.x < x + bw + 20 && pe.y > y - 20 && pe.y < y + bh + 20) continue;
      let hits = 0;
      for (const n of layout.nodes) if (n.x > x - 60 && n.x < x + bw + 20 && n.y > y - 16 && n.y < y + bh + 16) hits++;
      const score = hits * 1000 + Math.hypot(x + bw / 2 - pe.x, y + bh / 2 - pe.y);
      if (score < b.score) b = { x, y, score };
    }
  }
  const ax = Math.min(Math.max(pe.x, b.x), b.x + bw);
  const ay = Math.min(Math.max(pe.y, b.y), b.y + bh);
  return (
    <g>
      <path d={`M ${pe.x} ${pe.y} Q ${(pe.x + ax) / 2} ${Math.max(pe.y, ay) + 18} ${ax} ${ay}`} fill="none" stroke={CALLOUT} strokeWidth={1} />
      <rect x={pe.x - 7} y={pe.y - 7} width={14} height={14} fill={PE_GREEN} stroke="#15803d" transform={`rotate(45 ${pe.x} ${pe.y})`} />
      <rect x={b.x} y={b.y} width={bw} height={bh} fill="#fff" stroke={CALLOUT} strokeWidth={1.2} />
      <text x={b.x + bw / 2} y={b.y + fsBig + 6} fontSize={fsBig} fontStyle="italic" textAnchor="middle" fill={CALLOUT}>{title}</text>
      <text x={b.x + bw / 2} y={b.y + fsBig + fsSmall + 16} fontSize={fsSmall} fontStyle="italic" textAnchor="middle" fill={CALLOUT}>{gps}</text>
    </g>
  );
}

function NumberingBox({ x, y, code, ex }: { x: number; y: number; code: string; ex: { feeder: string; no: string } }) {
  const short = code.length > 6 ? code.slice(0, 6) : code;
  return (
    <g transform={`translate(${x}, ${y})`} fill="#111">
      <rect width={420} height={86} fill="none" stroke="#111" />
      <text x={8} y={18} fontSize={13} letterSpacing={1}>CONTOH PENOMBORAN TIANG :</text>
      <rect x={14} y={26} width={70} height={54} fill="none" stroke="#111" />
      <g fontSize={13} textAnchor="middle">
        <text x={49} y={42}>{short}</text>
        <text x={49} y={58}>{ex.feeder}</text>
        <text x={49} y={74}>{ex.no}</text>
      </g>
      <g fontSize={13}>
        <text x={110} y={42}>(NAMA / KOD PE)</text>
        <text x={110} y={58}>(FEEDER)</text>
        <text x={110} y={74}>(NOMBOR TIANG)</text>
      </g>
    </g>
  );
}

interface LegendItem { color: string; label: string; n: number }

function TitleBlock({ contractor, address, sub, feeders: fd, gps, today, legendPoles, defects }: {
  contractor: string; address: string; sub: SchematicData['substation']; feeders: string; gps: string; today: string;
  legendPoles: LegendItem[]; defects: boolean;
}) {
  // Lebar lajur: logo | kontraktor | alamat | petunjuk tiang | petunjuk talian | maklumat PE
  const cols = [190, 250, 300, 270, 250];
  const xs = cols.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [M]);
  const peX = xs[xs.length - 1];
  const right = W - M;
  const y = TB_Y;
  const addr = address.split(',').map((s) => s.trim()).filter(Boolean);
  const addrLines = addr.length > 1 ? [addr.slice(0, Math.ceil(addr.length / 2)).join(', '), addr.slice(Math.ceil(addr.length / 2)).join(', ')] : addr;
  const rowH = 15;
  return (
    <g fill="#111">
      <line x1={M} y1={y} x2={right} y2={y} stroke="#111" strokeWidth={1.2} />
      {xs.slice(1).map((x) => <line key={x} x1={x} y1={y} x2={x} y2={H - M} stroke="#111" />)}

      {/* Logo */}
      <g transform={`translate(${M + 22}, ${y + 22})`}>
        <rect width={46} height={46} rx={10} fill="#11284a" />
        <path d="M23 8v32M13 15h20M16 21h14" stroke="#fbbf24" strokeWidth={3.4} strokeLinecap="round" />
        <circle cx={23} cy={40} r={3} fill="#ef4444" />
        <text x={56} y={22} fontSize={17} fontWeight={700} fill="#11284a">REVOTECH</text>
        <text x={56} y={38} fontSize={9.5} fill="#475569">ASSET TAG</text>
        <text x={56} y={50} fontSize={9.5} fill="#475569">MANAGER</text>
      </g>

      {/* Kontraktor & alamat */}
      <text x={xs[1] + 8} y={y + 18} fontSize={11}>CONTRACTOR :</text>
      <text x={xs[1] + cols[1] / 2} y={y + 62} fontSize={12} fontWeight={700} textAnchor="middle">{(contractor || '-').toUpperCase()}</text>
      <text x={xs[2] + 8} y={y + 18} fontSize={11}>CONTRACTOR ADDRESS :</text>
      {(addrLines.length ? addrLines : ['-']).map((l, i) => (
        <text key={i} x={xs[2] + cols[2] / 2} y={y + 54 + i * 16} fontSize={11} fontWeight={700} textAnchor="middle">{l.toUpperCase()}</text>
      ))}

      {/* Petunjuk tiang */}
      <g transform={`translate(${xs[3] + 10}, ${y + 16})`} fontSize={10.5}>
        <rect x={0} y={-8} width={9} height={9} fill={PE_GREEN} stroke="#15803d" />
        <text x={18} y={0}>PENCAWANG ELEKTRIK</text>
        {legendPoles.slice(0, 6).map((it, i) => (
          <g key={it.label} transform={`translate(0, ${(i + 1) * rowH})`}>
            <circle cx={4.5} cy={-3.5} r={4.5} fill={it.color} />
            <text x={18} y={0}>{it.label}</text>
            <text x={cols[3] - 22} y={0} textAnchor="end">{fmtNum(it.n)}</text>
          </g>
        ))}
      </g>

      {/* Petunjuk talian */}
      <g transform={`translate(${xs[4] + 10}, ${y + 16})`} fontSize={10.5}>
        <line x1={0} y1={-3.5} x2={24} y2={-3.5} stroke={LINE} strokeWidth={1.6} />
        <text x={32} y={0}>TALIAN (TIANG KE TIANG)</text>
        <line x1={0} y1={rowH - 3.5} x2={24} y2={rowH - 3.5} stroke={LINE_SVC} strokeWidth={1.6} />
        <text x={32} y={rowH}>TALIAN SERVIS</text>
        {defects && (
          <g transform={`translate(0, ${rowH * 2})`}>
            <circle cx={12} cy={-3.5} r={6} fill="none" stroke="#ef4444" strokeWidth={1.6} />
            <circle cx={12} cy={-3.5} r={3} fill="#64748b" />
            <text x={32} y={0}>TIANG ADA DEFECT TERBUKA</text>
          </g>
        )}
        <text x={0} y={rowH * 4 + 4} fontSize={9.5} fill="#475569">Dijana {today} dari data sistem.</text>
        <text x={0} y={rowH * 5 + 4} fontSize={9.5} fill="#475569">Kedudukan ikut koordinat GPS tiang.</text>
      </g>

      {/* Maklumat PE */}
      <g fontSize={11.5}>
        <text x={(peX + right) / 2} y={y + 18} textAnchor="middle">PENCAWANG ELEKTRIK :</text>
        <text x={(peX + right) / 2} y={y + 38} textAnchor="middle" fontWeight={700} fontSize={14}>{sub.name.toUpperCase()}</text>
        <line x1={peX} y1={y + 48} x2={right} y2={y + 48} stroke="#111" />
        {[
          ['KOD PENCAWANG', sub.code],
          ['FEEDER', fd],
          ['COORDINATE GPS', gps],
          ['FUNCTIONAL LOCATION', sub.functional_location ?? '-'],
        ].map(([k, v], i) => (
          <g key={k}>
            <text x={peX + 14} y={y + 63 + i * 15}>{k}</text>
            <text x={peX + 150} y={y + 63 + i * 15}>: {v}</text>
            {i < 3 && <line x1={peX} y1={y + 67 + i * 15} x2={right} y2={y + 67 + i * 15} stroke="#cbd5e1" />}
          </g>
        ))}
      </g>
    </g>
  );
}
