import { useEffect, useState } from 'react';
import { POLE_STATUS, POLE_STATUS_COLOR, POLE_STATUS_LABEL, type PoleRow, can } from '../../shared/types';
import ImportWizard from '../components/ImportWizard';
import PoleForm from '../components/PoleForm';
import { fmtDateTime, fmtNum } from '../fmt';
import { Link, navigate } from '../router';
import { useApp, useFetch } from '../store';
import { Badge, Button, Empty, ErrorNote, Icon, Loading, PageHeader } from '../ui';

const PAGE = 50;

export default function PolesPage() {
  const { user, meta } = useApp();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [substation, setSubstation] = useState('');
  const [team, setTeam] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(0), [term, status, substation, team]);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (term) params.set('q', term);
  if (status === 'problem') params.set('problem', '1');
  else if (status) params.set('status', status);
  if (substation) params.set('substation_id', substation);
  if (team) params.set('team_id', team);
  const { data, error, loading } = useFetch<{ total: number; rows: PoleRow[] }>(`/poles?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Senarai Tiang"
        subtitle={data ? `${fmtNum(data.total)} tiang sepadan` : 'Memuatkan…'}
        actions={
          <>
            {can(user?.role, 'data.export') && (
              <a href="/api/export.csv" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" data-testid="export-csv">
                <Icon name="download" size={16} /> Eksport CSV
              </a>
            )}
            {can(user?.role, 'data.import') && <Button variant="secondary" icon="upload" onClick={() => setImporting(true)} data-testid="import-open">Import</Button>}
            {can(user?.role, 'pole.create') && <Button icon="plus" onClick={() => setAdding(true)}>Daftar tiang</Button>}
          </>
        }
      />

      <div className="card mb-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Cari no tiang, tag, jalan, pencawang…" aria-label="Cari" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="problem">Bermasalah sahaja</option>
          {POLE_STATUS.map((s) => <option key={s} value={s}>{POLE_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" aria-label="Pencawang" value={substation} onChange={(e) => setSubstation(e.target.value)}>
          <option value="">Semua pencawang</option>
          {meta.substations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Semua team</option>
          {meta.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="card overflow-hidden">
        {!data && loading ? (
          <Loading />
        ) : data && data.rows.length === 0 ? (
          <Empty icon="list" title="Tiada tiang dijumpai" hint="Ubah tapisan, daftar tiang baharu, atau import dari Excel/CSV." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full" data-testid="poles-table">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {['No tiang rondaan', 'Status', 'Pencawang', 'Kod', 'Functional location', 'Team', 'No tiang lama', 'Jalan', 'Defect', 'Rondaan terakhir', ''].map((h) => <th key={h} className="th">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/tiang/${r.id}`)}>
                    <td className="td font-semibold text-slate-900">{r.no_tiang_rondaan}</td>
                    <td className="td"><Badge color={POLE_STATUS_COLOR[r.status]}>{POLE_STATUS_LABEL[r.status]}</Badge></td>
                    <td className="td">{r.substation_name}</td>
                    <td className="td">{r.substation_code}</td>
                    <td className="td font-mono text-xs">{r.functional_location ?? '-'}</td>
                    <td className="td">{r.team_name ?? '-'}</td>
                    <td className="td">{r.no_tiang_lama ?? '-'}</td>
                    <td className="td max-w-48 truncate">{r.street ?? '-'}</td>
                    <td className="td">{r.open_defects > 0 ? <span className="inline-flex items-center gap-1 font-semibold text-red-600"><span className="h-2 w-2 rounded-full bg-red-500" />{r.open_defects}</span> : <span className="text-slate-400">0</span>}</td>
                    <td className="td">{fmtDateTime(r.last_rondaan_at)}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/?tiang=${r.id}`} title="Lihat di peta 3D" aria-label={`Lihat ${r.no_tiang_rondaan} di peta`} className="inline-flex rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-navy-800"><Icon name="cube" size={16} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
            <span>Halaman {page + 1} / {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Sebelum</Button>
              <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Seterusnya</Button>
            </div>
          </div>
        )}
      </div>

      {adding && <PoleForm initial={meta.substations[0]?.lat && meta.substations[0]?.lng ? { lat: meta.substations[0].lat, lng: meta.substations[0].lng } : undefined} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); navigate(`/tiang/${id}`); }} />}
      {importing && <ImportWizard onClose={() => setImporting(false)} />}
    </div>
  );
}
