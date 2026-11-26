import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { fmtDateTime } from '../fmt';
import { Button, Empty, ErrorNote, Loading, PageHeader } from '../ui';

interface Row { id: number; actor_name: string | null; action: string; entity: string | null; entity_id: string | null; detail: string | null; at: string }

const GROUPS: [string, string][] = [['', 'Semua'], ['login', 'Log masuk'], ['user', 'Pengguna'], ['pole', 'Tiang'], ['rondaan', 'Rondaan'], ['defect', 'Defect'], ['data', 'Import/eksport'], ['password', 'Kata laluan']];
const LABEL: Record<string, string> = {
  login: 'Log masuk', 'password.change': 'Tukar kata laluan', 'user.create': 'Cipta pengguna', 'user.update': 'Kemas kini pengguna', 'user.reset_password': 'Set semula kata laluan',
  'pole.create': 'Daftar tiang', 'pole.update': 'Edit tiang', 'pole.delete': 'Padam tiang', 'rondaan.create': 'Rondaan', 'defect.assign': 'Agih tugasan',
  'defect.start': 'Mula senggara', 'defect.complete': 'Tanda siap', 'defect.verify': 'Sahkan kerja', 'defect.reject': 'Tolak kerja', 'photo.delete': 'Padam gambar',
  'data.import': 'Import data', 'data.export': 'Eksport data', 'zone.create': 'Cipta zon', 'team.create': 'Cipta team', 'substation.create': 'Cipta pencawang',
  'substation.update': 'Kemas kini pencawang', 'sample.create': 'Jana data contoh', 'sample.delete': 'Padam data contoh',
};

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setBusy(true);
    try {
      const before = !reset && rows.length ? `&before=${rows[rows.length - 1].id}` : '';
      const r = await api.get<{ rows: Row[] }>(`/admin/audit?limit=100&action=${encodeURIComponent(action)}${before}`);
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setMore(r.rows.length === 100);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Audit Log" subtitle="Siapa buat apa, bila. Rekod ini tidak boleh diubah dari aplikasi." />
      <div className="mb-3 flex flex-wrap gap-1">
        {GROUPS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={action === v} onClick={() => setAction(v)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${action === v ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="card overflow-hidden">
        {rows.length === 0 && busy ? <Loading /> : rows.length === 0 ? <Empty icon="shield" title="Tiada rekod" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full" data-testid="audit-table">
              <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Masa', 'Pengguna', 'Tindakan', 'Rekod', 'Butiran'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td">{fmtDateTime(r.at)}</td>
                    <td className="td font-medium text-slate-900">{r.actor_name ?? '-'}</td>
                    <td className="td">{LABEL[r.action] ?? r.action}</td>
                    <td className="td text-slate-500">{r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '-'}</td>
                    <td className="td max-w-md truncate font-mono text-[11px] text-slate-500" title={r.detail ?? ''}>{r.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more && rows.length > 0 && <div className="border-t border-slate-200 p-2 text-center"><Button size="sm" variant="secondary" loading={busy} onClick={() => load(false)}>Muat lagi</Button></div>}
      </div>
    </div>
  );
}
