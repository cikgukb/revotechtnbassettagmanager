import { useState } from 'react';
import {
  DEFECT_CATEGORY_INFO, DEFECT_STATUS, DEFECT_STATUS_COLOR, DEFECT_STATUS_LABEL, type DefectRow, type DefectStatus,
  SEVERITY_LABEL, TASK_TYPES, TASK_TYPE_LABEL,
} from '../../shared/types';
import DefectActions from '../components/DefectActions';
import { fmtAgo, fmtNum } from '../fmt';
import { Link } from '../router';
import { useApp, useFetch } from '../store';
import { Empty, ErrorNote, Icon, Loading, PageHeader } from '../ui';

interface Board { counts: Record<DefectStatus, number>; columns: Record<DefectStatus, DefectRow[]> }
const SEV_COLOR = { tinggi: '#dc2626', sederhana: '#f59e0b', rendah: '#94a3b8' } as const;

export default function TasksPage() {
  const { user, meta } = useApp();
  const [task, setTask] = useState('');
  const [team, setTeam] = useState(user?.role === 'operator' && user.team_id ? String(user.team_id) : '');
  const [mobileCol, setMobileCol] = useState<DefectStatus>('belum');
  const params = new URLSearchParams();
  if (task) params.set('task_type', task);
  if (team) params.set('team_id', team);
  const { data, error, loading } = useFetch<Board>(`/defects/board?${params}`);

  return (
    <div className="flex h-full flex-col p-4 md:p-6">
      <PageHeader title="Tugasan Senggaraan" subtitle="Dari defect dilapor sampai disahkan admin" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {[['', 'Semua'], ...TASK_TYPES.map((t) => [t, TASK_TYPE_LABEL[t]])].map(([v, label]) => (
            <button key={v} type="button" aria-pressed={task === v} onClick={() => setTask(v)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${task === v ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <select className="input ml-auto w-auto" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Semua team</option>
          {meta.teams.map((t) => <option key={t.id} value={t.id}>Team {t.name}</option>)}
        </select>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!data && loading && <Loading />}
      {data && (
        <>
          {/* Mudah alih: pilih satu lajur */}
          <div className="mb-2 grid grid-cols-4 gap-1 lg:hidden">
            {DEFECT_STATUS.map((s) => (
              <button key={s} type="button" aria-pressed={mobileCol === s} onClick={() => setMobileCol(s)} className={`rounded-lg px-1 py-2 text-center text-[10px] font-bold leading-tight ${mobileCol === s ? 'text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`} style={mobileCol === s ? { backgroundColor: DEFECT_STATUS_COLOR[s] } : undefined}>
                <span className="block text-base tabular-nums">{fmtNum(data.counts[s])}</span>
                {DEFECT_STATUS_LABEL[s].replace('Senggaraan ', '').replace(' disenggara', '')}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-4" data-testid="board">
            {DEFECT_STATUS.map((s) => (
              <section key={s} className={`min-h-0 flex-col rounded-xl bg-slate-200/60 ${mobileCol === s ? 'flex' : 'hidden'} lg:flex`} data-testid={`col-${s}`}>
                <header className="flex items-center justify-between px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEFECT_STATUS_COLOR[s] }} />
                    {DEFECT_STATUS_LABEL[s]}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-slate-700">{fmtNum(data.counts[s])}</span>
                </header>
                <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {data.columns[s].length === 0 && <Empty icon="check" title="Tiada tugasan" />}
                  {data.columns[s].map((d) => <Card key={d.id} d={d} />)}
                  {data.counts[s] > data.columns[s].length && <p className="py-1 text-center text-[11px] text-slate-500">Menunjukkan {data.columns[s].length} daripada {fmtNum(data.counts[s])}. Guna tapisan untuk kecilkan senarai.</p>}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ d }: { d: DefectRow }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm" data-testid="task-card">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/?tiang=${d.pole_id}`} className="text-sm font-bold text-navy-800 hover:underline">{d.no_tiang_rondaan}</Link>
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase" style={{ color: SEV_COLOR[d.severity] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEV_COLOR[d.severity] }} />
          {SEVERITY_LABEL[d.severity]}
        </span>
      </div>
      <div className="mt-0.5 text-sm text-slate-800">{DEFECT_CATEGORY_INFO[d.category]?.label ?? d.category}</div>
      <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
        <div className="flex items-center gap-1 truncate"><Icon name="pin" size={11} />{[d.substation_name, d.street].filter(Boolean).join(' · ')}</div>
        <div className="flex items-center gap-1"><Icon name="users" size={11} />{d.team_name ? `Team ${d.team_name}` : 'Belum diagih'} · {TASK_TYPE_LABEL[d.task_type]}</div>
        <div className="flex items-center gap-1"><Icon name="clock" size={11} />Dilapor {fmtAgo(d.reported_at)}</div>
      </div>
      <div className="mt-2"><DefectActions defect={d} /></div>
    </article>
  );
}
