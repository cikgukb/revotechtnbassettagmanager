// Dashboard & laporan visual. Halaman ini juga boleh dicetak terus (Cetak -> Simpan sebagai PDF).
import type { ReactNode } from 'react';
import {
  DEFECT_CATEGORY_INFO, DEFECT_STATUS, DEFECT_STATUS_COLOR, DEFECT_STATUS_LABEL, type DefectStatus, POLE_STATUS_COLOR, POLE_STATUS_LABEL,
  type PoleStatus, STAGE_LABEL, type Stats, TASK_TYPES, TASK_TYPE_LABEL,
} from '../../shared/types';
import { fmtAgo, fmtDateTime, fmtNum, pct } from '../fmt';
import { Link } from '../router';
import { useApp, useFetch } from '../store';
import { Button, Empty, ErrorNote, Loading, PageHeader } from '../ui';

// Warna status ialah warna "keadaan" (bukan siri). Susunan dalam bar dipilih supaya hijau dan merah
// tidak bersebelahan (lebih selamat untuk rabun warna); kelabu sengaja neutral = belum ada keadaan.
const POLE_ORDER: PoleStatus[] = ['ok', 'baru', 'defect', 'sedang', 'selesai'];
// Satu warna sahaja untuk semua carta magnitud (bilangan), supaya tak dikelirukan dengan warna status.
const INK = '#1a3a66';
const SHORT_STATUS: Record<DefectStatus, string> = { belum: 'Belum', sedang: 'Sedang', selesai: 'Selesai', disahkan: 'Disahkan' };

export default function DashboardPage() {
  const { user, meta } = useApp();
  const { data, error, loading } = useFetch<Stats>('/stats');
  if (!data) return <div className="p-6">{loading ? <Loading /> : <ErrorNote>{error}</ErrorNote>}</div>;

  const s = data;
  const zoneName = user?.role === 'super_admin' ? 'Semua zon' : (meta.zones.find((z) => z.id === user?.zone_id)?.name ?? '');
  const dironda = s.total_poles - s.poles.baru;
  const problem = s.poles.defect + s.poles.sedang + s.poles.selesai;
  const taskCount = (type: string, st: DefectStatus) => s.tasks.find((t) => t.task_type === type && t.status === st)?.n ?? 0;
  const byStatus = Object.fromEntries(DEFECT_STATUS.map((st) => [st, s.tasks.filter((t) => t.status === st).reduce((a, t) => a + t.n, 0)])) as Record<DefectStatus, number>;
  const totalDefects = DEFECT_STATUS.reduce((a, st) => a + byStatus[st], 0);

  if (s.total_poles === 0) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader title="Dashboard" subtitle={zoneName} />
        <div className="card"><Empty icon="chart" title="Belum ada data" hint="Daftar tiang, import senarai tiang, atau minta Super Admin jana data contoh." /></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6" data-testid="dashboard">
      <PageHeader
        title="Dashboard"
        subtitle={`${zoneName} · dikemas kini ${fmtDateTime(new Date().toISOString())}`}
        actions={<Button variant="secondary" icon="printer" onClick={() => window.print()}>Cetak laporan</Button>}
      />

      {/* Angka utama */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Jumlah tiang" value={fmtNum(s.total_poles)} sub={`${s.substations.length} pencawang`} />
        <Tile label="Sudah dironda" value={`${pct(dironda, s.total_poles)}%`} sub={`${fmtNum(dironda)} daripada ${fmtNum(s.total_poles)}`} />
        <Tile label="Tiang bermasalah" value={fmtNum(problem)} sub={`${pct(problem, s.total_poles)}% daripada semua tiang`} dot={POLE_STATUS_COLOR.defect} />
        <Tile label="Tunggu pengesahan" value={fmtNum(byStatus.selesai)} sub="kerja siap, belum disahkan" dot={DEFECT_STATUS_COLOR.selesai} />
        <Tile label="Defect ditutup" value={`${pct(byStatus.disahkan, totalDefects)}%`} sub={`${fmtNum(byStatus.disahkan)} daripada ${fmtNum(totalDefects)} defect`} dot={DEFECT_STATUS_COLOR.disahkan} />
      </div>

      <div className="mb-4">
        <Card title="Status tiang" subtitle="Semua tiang mengikut keadaan semasa">
          <SegBar total={s.total_poles} segments={POLE_ORDER.map((st) => ({ key: st, label: POLE_STATUS_LABEL[st], value: s.poles[st], color: POLE_STATUS_COLOR[st] }))} tall />
          <Legend items={POLE_ORDER.map((st) => ({ label: POLE_STATUS_LABEL[st], value: s.poles[st], color: POLE_STATUS_COLOR[st] }))} total={s.total_poles} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">

        <Card title="Tugasan mengikut jenis" subtitle="Bilangan defect bagi setiap jenis tugasan dan status">
          <div className="space-y-3">
            {TASK_TYPES.map((type) => {
              const segs = DEFECT_STATUS.map((st) => ({ key: st, label: DEFECT_STATUS_LABEL[st], value: taskCount(type, st), color: DEFECT_STATUS_COLOR[st] }));
              const total = segs.reduce((a, x) => a + x.value, 0);
              return (
                <div key={type} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{TASK_TYPE_LABEL[type]}</span>
                  <SegBar total={total} segments={segs} />
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{fmtNum(total)}</span>
                </div>
              );
            })}
          </div>
          <Legend items={DEFECT_STATUS.map((st) => ({ label: DEFECT_STATUS_LABEL[st], value: byStatus[st], color: DEFECT_STATUS_COLOR[st] }))} total={totalDefects} />
          {/* Paparan jadual bagi data yang sama */}
          <div className="scroll-thin mt-3 overflow-x-auto">
            <table className="w-full" data-testid="task-table">
              <thead className="border-y border-slate-200 bg-slate-50">
                <tr><th className="th">Tugasan</th>{DEFECT_STATUS.map((st) => <th key={st} className="th text-right" title={DEFECT_STATUS_LABEL[st]}>{SHORT_STATUS[st]}</th>)}<th className="th text-right">Jumlah</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TASK_TYPES.map((type) => (
                  <tr key={type}><td className="td font-medium">{TASK_TYPE_LABEL[type]}</td>{DEFECT_STATUS.map((st) => <td key={st} className="td text-right tabular-nums">{fmtNum(taskCount(type, st))}</td>)}<td className="td text-right font-semibold tabular-nums text-slate-900">{fmtNum(DEFECT_STATUS.reduce((a, st) => a + taskCount(type, st), 0))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Kemajuan rondaan mengikut team" subtitle="Peratus tiang yang sudah dironda">
          <div className="space-y-3">
            {s.teams.map((t) => {
              const p = pct(t.dironda, t.poles);
              return (
                <div key={t.team_id ?? 0}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-slate-800">{t.team_name}</span>
                    <span className="text-xs text-slate-500">{fmtNum(t.dironda)} / {fmtNum(t.poles)} tiang · {fmtNum(t.open_defects)} defect terbuka</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 flex-1 rounded-r bg-slate-100" role="img" aria-label={`${t.team_name}: ${p}% dironda`}>
                      <div className="h-full rounded-r" style={{ width: `${p}%`, backgroundColor: INK }} />
                    </div>
                    <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-900">{p}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Defect mengikut kategori" subtitle="Jumlah dilapor (yang masih terbuka dalam kurungan)">
          {s.categories.length === 0 ? <Empty icon="check" title="Tiada defect direkod" /> : (
            <div className="space-y-2">
              {s.categories.map((c) => {
                const max = Math.max(...s.categories.map((x) => x.n));
                return (
                  <div key={c.category} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-2" title={`${DEFECT_CATEGORY_INFO[c.category]?.label ?? c.category}: ${c.n} dilapor, ${c.open} terbuka`}>
                    <span className="truncate text-sm text-slate-700">{DEFECT_CATEGORY_INFO[c.category]?.label ?? c.category}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded-r" style={{ width: `${Math.max(2, (c.n / max) * 78)}%`, backgroundColor: INK }} />
                      <span className="whitespace-nowrap text-xs tabular-nums text-slate-700"><b className="text-slate-900">{fmtNum(c.n)}</b> ({fmtNum(c.open)})</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Rondaan sehari" subtitle="14 hari terakhir">
          <Columns data={days(s.daily, 'rondaan')} unit="rondaan" />
        </Card>
        <Card title="Senggaraan siap sehari" subtitle="14 hari terakhir">
          <Columns data={days(s.daily, 'siap')} unit="siap" />
        </Card>

        <Card title="Pencawang" subtitle="Disusun mengikut bilangan tiang bermasalah">
          <div className="scroll-thin -mx-4 overflow-x-auto">
            <table className="w-full">
              <thead className="border-y border-slate-200 bg-slate-50">
                <tr>{['Pencawang', 'Kod', 'Tiang', 'Dironda', 'Bermasalah'].map((h, i) => <th key={h} className={`th ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.substations.map((x) => (
                  <tr key={x.id}>
                    <td className="td font-medium text-slate-900">{x.name}</td>
                    <td className="td">{x.code}</td>
                    <td className="td text-right tabular-nums">{fmtNum(x.poles)}</td>
                    <td className="td text-right tabular-nums">{pct(x.dironda, x.poles)}%</td>
                    <td className="td text-right tabular-nums">{x.problem > 0 ? <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: POLE_STATUS_COLOR.defect }} />{fmtNum(x.problem)}</span> : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Aktiviti terkini" subtitle="Stage terbaru yang direkod">
          <ul className="divide-y divide-slate-100">
            {s.recent.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link to={`/?tiang=${e.pole_id}`} className="font-semibold text-navy-800 hover:underline">{e.no_tiang_rondaan}</Link>
                  <span className="text-slate-700"> · {STAGE_LABEL[e.stage] ?? e.stage}</span>
                  {e.note && <span className="text-slate-500"> ({e.note})</span>}
                  <span className="block truncate text-[11px] text-slate-500">{e.actor_name ?? 'Sistem'}</span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-500" title={fmtDateTime(e.at)}>{fmtAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Isi hari yang tiada rekod dengan 0 supaya paksi masa tak melompat. */
function days(daily: Stats['daily'], key: 'rondaan' | 'siap'): { day: string; value: number }[] {
  const map = new Map(daily.map((d) => [d.day, d[key]]));
  const out: { day: string; value: number }[] = [];
  const today = Date.now() + 8 * 3600_000;
  for (let i = 13; i >= 0; i--) {
    const day = new Date(today - i * 86400_000).toISOString().slice(0, 10);
    out.push({ day, value: map.get(day) ?? 0 });
  }
  return out;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function Tile({ label, value, sub, dot }: { label: string; value: string; sub: string; dot?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {dot && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />}
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}

interface Seg { key: string; label: string; value: number; color: string }

/** Bar bersegmen (sebahagian daripada keseluruhan). Jurang 2px memisahkan segmen; tiada garisan tepi. */
function SegBar({ segments, total, tall }: { segments: Seg[]; total: number; tall?: boolean }) {
  const shown = segments.filter((x) => x.value > 0);
  if (!total) return <div className="h-5 rounded bg-slate-100" aria-label="Tiada data" />;
  return (
    <div className={`flex gap-0.5 ${tall ? 'h-9' : 'h-5'}`} role="img" aria-label={shown.map((x) => `${x.label}: ${x.value}`).join(', ')}>
      {shown.map((x, i) => {
        const share = x.value / total;
        return (
          <div key={x.key} className={`group relative min-w-[3px] ${i === 0 ? 'rounded-l' : ''} ${i === shown.length - 1 ? 'rounded-r' : ''}`} style={{ flexGrow: x.value, flexBasis: 0, backgroundColor: x.color }} tabIndex={0}>
            {/* Label dalam segmen hanya bila cukup ruang; selebihnya dibawa oleh legenda, tooltip dan jadual. */}
            {tall && share >= 0.12 && <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">{pct(x.value, total)}%</span>}
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-navy-950 px-2 py-1 text-[11px] text-white shadow-lg group-hover:block group-focus:block">
              {x.label}: <b>{fmtNum(x.value)}</b> ({pct(x.value, total)}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ items, total }: { items: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((x) => (
        <li key={x.label} className="flex items-center gap-1.5 text-xs text-slate-700">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: x.color }} />
          {x.label}
          <b className="tabular-nums text-slate-900">{fmtNum(x.value)}</b>
          <span className="text-slate-400">{pct(x.value, total)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Carta lajur satu siri. Tiada legenda: tajuk kad sudah menamakan sirinya. */
function Columns({ data, unit }: { data: { day: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [top, top / 2, 0];
  const peak = data.reduce((a, d) => (d.value > a.value ? d : a), data[0]);
  const label = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  return (
    <div className="flex gap-2" role="img" aria-label={`${unit} sehari: ${data.map((d) => `${label(d.day)} ${d.value}`).join(', ')}`}>
      <div className="flex h-36 flex-col justify-between text-right text-[10px] tabular-nums text-slate-400">
        {ticks.map((t) => <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{fmtNum(t)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-36 border-b border-slate-300">
          <div className="absolute inset-x-0 top-0 border-t border-slate-100" />
          <div className="absolute inset-x-0 top-1/2 border-t border-slate-100" />
          <div className="absolute inset-0 flex items-end justify-between gap-0.5">
            {data.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0}>
                <div className="w-full max-w-6 rounded-t" style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 2 : 0, backgroundColor: INK }} />
                {d === peak && d.value > 0 && <span className="pointer-events-none absolute text-[10px] font-semibold tabular-nums text-slate-700" style={{ bottom: `calc(${(d.value / top) * 100}% + 2px)` }}>{fmtNum(d.value)}</span>}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 translate-y-6 whitespace-nowrap rounded-md bg-navy-950 px-2 py-1 text-[11px] text-white shadow-lg group-hover:block group-focus:block">
                  {label(d.day)}: <b>{fmtNum(d.value)}</b> {unit}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1 flex justify-between gap-0.5 text-[10px] tabular-nums text-slate-400">
          {data.map((d, i) => <span key={d.day} className="flex-1 text-center">{i % 2 === 1 ? label(d.day) : ''}</span>)}
        </div>
      </div>
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 2;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
