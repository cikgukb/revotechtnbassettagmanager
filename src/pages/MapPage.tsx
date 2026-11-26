import { useEffect, useMemo, useRef, useState } from 'react';
import { type GeoRow, POLE_STATUS, POLE_STATUS_COLOR, POLE_STATUS_LABEL, type PoleRow, can } from '../../shared/types';
import { api } from '../api';
import { type Basemap, PoleMap } from '../map/PoleMap';
import { navigate, useLocation } from '../router';
import { useApp } from '../store';
import { fmtNum } from '../fmt';
import { Icon, type IconName, Spinner } from '../ui';
import PoleProfile from '../components/PoleProfile';
import PoleForm from '../components/PoleForm';

const ALL = POLE_STATUS.map((_, i) => i);
const PROBLEM = [2, 3, 4];
const SHORT: Record<string, string> = { baru: 'Belum dironda', ok: 'Baik', defect: 'Belum disenggara', sedang: 'Sedang', selesai: 'Tunggu sah' };

export default function MapPage() {
  const { dataKey, user, meta } = useApp();
  const { query } = useLocation();
  const selectedId = Number(query.get('tiang')) || null;
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<PoleMap | null>(null);
  const [rows, setRows] = useState<GeoRow[] | null>(null);
  const [statuses, setStatuses] = useState<Set<number>>(new Set(ALL));
  const [substation, setSubstation] = useState<number | null>(null);
  const [basemap, setBasemap] = useState<Basemap>('satelit');
  const [buildings, setBuildings] = useState(true);
  const [is3d, setIs3d] = useState(true);
  const [adding, setAdding] = useState<{ lat: number; lng: number } | null>(null);
  const [panel, setPanel] = useState(() => window.innerWidth >= 640);

  useEffect(() => {
    const map = new PoleMap(boxRef.current!, (id) => navigate(id ? `/?tiang=${id}` : '/'));
    mapRef.current = map;
    return () => {
      map.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let dead = false;
    api
      .get<{ poles: GeoRow[] }>('/poles/geo')
      .then((r) => {
        if (dead) return;
        setRows(r.poles);
        mapRef.current?.setPoles(r.poles);
      })
      .catch(() => !dead && setRows((r) => r ?? []));
    return () => {
      dead = true;
    };
  }, [dataKey]);

  useEffect(() => mapRef.current?.setFilter({ statuses, substation, team: null }), [statuses, substation]);
  useEffect(() => mapRef.current?.setBasemap(basemap), [basemap]);
  useEffect(() => mapRef.current?.setBuildings(buildings), [buildings]);
  // Bila tiang dipilih (klik, carian, atau pautan dari halaman lain), tanda dan bawa kamera ke situ jika perlu.
  useEffect(() => mapRef.current?.select(selectedId, 'auto'), [selectedId, rows]);
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 220);
    return () => clearTimeout(t);
  }, [selectedId]);

  const counts = useMemo(() => {
    const c = ALL.map(() => 0);
    for (const r of rows ?? []) if (substation === null || r[5] === substation) c[r[3]]++;
    return c;
  }, [rows, substation]);
  const total = counts.reduce((a, b) => a + b, 0);
  const problem = PROBLEM.reduce((a, i) => a + counts[i], 0);
  const onlyProblem = statuses.size === PROBLEM.length && PROBLEM.every((i) => statuses.has(i));
  const showAll = statuses.size === ALL.length;

  const toggle = (i: number) =>
    setStatuses((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="absolute inset-0 flex">
      <div className="relative min-w-0 flex-1">
        {/* MapLibre menetapkan position: relative pada bekasnya, jadi saiz diberi oleh pembalut luar. */}
        <div className="absolute inset-0 bg-navy-950">
          <div ref={boxRef} data-testid="map" className="h-full w-full" />
        </div>

        {/* Panel kiri atas: carian + tapisan (juga berfungsi sebagai petunjuk warna) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3 sm:max-w-sm">
          <SearchBox onPick={(id) => navigate(`/?tiang=${id}`)} />
          <div className="glass pointer-events-auto rounded-xl p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="whitespace-nowrap text-sm font-bold" data-testid="pole-total">{rows === null ? 'Memuatkan…' : `${fmtNum(total)} tiang`}</span>
                {problem > 0 && <span className="truncate text-xs text-red-300">{fmtNum(problem)} bermasalah</span>}
                {rows === null && <Spinner size={14} />}
              </div>
              <button type="button" onClick={() => setPanel((p) => !p)} aria-expanded={panel} aria-label="Tunjuk atau sorok tapisan" className="rounded-lg p-1 hover:bg-white/10">
                <Icon name="chevron" size={16} className={panel ? '-rotate-90' : 'rotate-90'} />
              </button>
            </div>
            <div className="mt-2 flex gap-1.5">
              <Pill active={showAll} onClick={() => setStatuses(new Set(ALL))}>Semua</Pill>
              <Pill active={onlyProblem} onClick={() => setStatuses(new Set(onlyProblem ? ALL : PROBLEM))} danger data-testid="filter-problem">
                Bermasalah sahaja
              </Pill>
            </div>
            {panel && (
              <>
                <div className="mt-2 grid grid-cols-1 gap-1">
                  {POLE_STATUS.map((s, i) => (
                    <button key={s} type="button" aria-pressed={statuses.has(i)} onClick={() => toggle(i)} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${statuses.has(i) ? 'bg-white/10' : 'opacity-45 hover:opacity-80'}`}>
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full ring-2 ring-white/70" style={{ backgroundColor: POLE_STATUS_COLOR[s] }} />
                        {POLE_STATUS_LABEL[s]}
                      </span>
                      <span className="font-bold tabular-nums">{fmtNum(counts[i])}</span>
                    </button>
                  ))}
                </div>
                {meta.substations.length > 0 && (
                  <select aria-label="Tapis pencawang" className="mt-2 w-full rounded-lg border border-white/15 bg-navy-900 px-2 py-1.5 text-xs text-white outline-none" value={substation ?? ''} onChange={(e) => setSubstation(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Semua pencawang</option>
                    {meta.substations.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
        </div>

        {/* Kawalan paparan */}
        <div className="absolute bottom-10 right-3 z-10 flex flex-col items-end gap-2 sm:bottom-auto sm:top-3">
          <div className="glass flex overflow-hidden rounded-xl text-xs font-semibold">
            {(['satelit', 'gelap'] as Basemap[]).map((b) => (
              <button key={b} type="button" aria-pressed={basemap === b} onClick={() => setBasemap(b)} className={`px-3 py-2 capitalize ${basemap === b ? 'bg-volt-400 text-navy-950' : 'hover:bg-white/10'}`}>
                {b}
              </button>
            ))}
          </div>
          <div className="glass flex overflow-hidden rounded-xl">
            <MapBtn icon="cube" label={is3d ? 'Tukar ke pandangan atas (2D)' : 'Tukar ke pandangan 3D'} active={is3d} onClick={() => { setIs3d(!is3d); mapRef.current?.set3d(!is3d); }} />
            <MapBtn icon="building" label="Bangunan 3D" active={buildings} onClick={() => setBuildings((b) => !b)} />
            <MapBtn icon="locate" label="Tunjuk semua tiang" onClick={() => mapRef.current?.fitAll()} />
          </div>
        </div>

        {can(user?.role, 'pole.create') && (
          <button type="button" data-testid="add-pole" onClick={() => setAdding(mapRef.current?.getCenter() ?? null)} className="absolute bottom-36 right-3 z-10 flex h-12 items-center gap-2 rounded-full bg-volt-400 px-4 text-sm font-bold text-navy-950 shadow-xl hover:bg-volt-300 sm:bottom-10">
            <Icon name="plus" /> Daftar tiang
          </button>
        )}
      </div>

      {selectedId !== null && (
        <aside className="anim-slide absolute inset-x-0 bottom-0 z-20 flex max-h-[78dvh] flex-col rounded-t-2xl bg-white shadow-2xl md:static md:max-h-none md:w-[430px] md:shrink-0 md:rounded-none md:border-l md:border-slate-200" data-testid="profile-drawer">
          <PoleProfile id={selectedId} onClose={() => navigate('/')} />
        </aside>
      )}

      {adding && (
        <PoleForm
          initial={adding}
          onClose={() => setAdding(null)}
          onSaved={(id) => {
            setAdding(null);
            navigate(`/?tiang=${id}`);
          }}
        />
      )}
    </div>
  );
}

function Pill({ active, danger, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; danger?: boolean }) {
  const on = danger ? 'bg-red-500 text-white' : 'bg-white text-navy-950';
  return (
    <button type="button" aria-pressed={active} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition ${active ? on : 'bg-white/10 text-white hover:bg-white/20'}`} {...rest}>
      {children}
    </button>
  );
}

function MapBtn({ icon, label, active, onClick }: { icon: IconName; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick} className={`flex h-10 flex-1 items-center justify-center px-3 ${active ? 'text-volt-400' : 'text-white'} hover:bg-white/10`}>
      <Icon name={icon} />
    </button>
  );
}

function SearchBox({ onPick }: { onPick: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PoleRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let dead = false;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .get<{ rows: PoleRow[] }>(`/poles?limit=8&q=${encodeURIComponent(term)}`)
        .then((r) => !dead && setResults(r.rows))
        .catch(() => !dead && setResults([]))
        .finally(() => !dead && setBusy(false));
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="pointer-events-auto relative">
      <div className="glass flex items-center gap-2 rounded-xl px-3">
        <Icon name="search" size={16} className="text-slate-300" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari no tiang, tag, jalan, pencawang…" aria-label="Cari tiang" className="h-11 w-full bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none" />
        {busy ? <Spinner size={14} /> : q && <button type="button" aria-label="Kosongkan" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
      </div>
      {results && (
        <div className="glass absolute inset-x-0 top-full mt-1 max-h-72 overflow-y-auto rounded-xl py-1">
          {results.length === 0 && <div className="px-3 py-3 text-xs text-slate-300">Tiada padanan</div>}
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick(r.id); setQ(''); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/10">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: POLE_STATUS_COLOR[r.status] }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.no_tiang_rondaan} <span className="font-normal text-slate-300">· {r.substation_name}</span></span>
                <span className="block truncate text-[11px] text-slate-400">{[r.street, SHORT[r.status], r.tag_code].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
