// Pengguna & Tetapan (Super Admin): akaun dan role, zon/team, pencawang, data contoh.
import { type FormEvent, useState } from 'react';
import { passwordProblem } from '../../shared/password';
import { PERMS, ROLES, ROLE_DESC, ROLE_LABEL, type Role, type UserRow } from '../../shared/types';
import { api, errMsg } from '../api';
import { fmtAgo } from '../fmt';
import { useApp, useFetch } from '../store';
import { Badge, Button, Empty, ErrorNote, Field, Icon, Loading, Modal, PageHeader, Tabs, useToast } from '../ui';

type Tab = 'pengguna' | 'role' | 'induk' | 'contoh';
const ROLE_COLOR: Record<Role, string> = { super_admin: '#7c3aed', admin: '#2563eb', operator: '#d97706', viewer: '#64748b' };

export default function UsersPage() {
  const [tab, setTab] = useState<Tab>('pengguna');
  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Pengguna & Tetapan" subtitle="Hanya Super Admin boleh mengubah akaun dan role" />
      <div className="card">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'pengguna', label: 'Pengguna' }, { id: 'role', label: 'Kebenaran role' }, { id: 'induk', label: 'Zon, team & pencawang' }, { id: 'contoh', label: 'Data contoh' }]} />
        <div className="p-4">
          {tab === 'pengguna' && <UsersTab />}
          {tab === 'role' && <RoleMatrix />}
          {tab === 'induk' && <MasterTab />}
          {tab === 'contoh' && <SampleTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------- Pengguna ----------------
function UsersTab() {
  const { user: me } = useApp();
  const { data, error, loading } = useFetch<{ users: UserRow[] }>('/admin/users');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  if (!data && loading) return <Loading />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">{data?.users.length ?? 0} akaun</p>
        <Button icon="plus" onClick={() => setEditing('new')} data-testid="user-add">Tambah pengguna</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full" data-testid="users-table">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Nama', 'Nama pengguna', 'Role', 'Zon', 'Team', 'Status', 'Log masuk terakhir', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                <td className="td font-semibold text-slate-900">{u.name}{u.id === me?.id && <span className="ml-1 text-[10px] font-normal text-slate-400">(anda)</span>}</td>
                <td className="td font-mono text-xs">{u.username}</td>
                <td className="td"><Badge color={ROLE_COLOR[u.role]}>{ROLE_LABEL[u.role]}</Badge></td>
                <td className="td">{u.role === 'super_admin' ? 'Semua zon' : (u.zone_name ?? '-')}</td>
                <td className="td">{u.team_name ?? '-'}</td>
                <td className="td">{!u.active ? 'Tidak aktif' : u.must_change_password ? 'Perlu tukar kata laluan' : 'Aktif'}</td>
                <td className="td">{u.last_login_at ? fmtAgo(u.last_login_at) : 'Belum pernah'}</td>
                <td className="td">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(u)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon="key" onClick={() => setResetting(u)}>Set semula</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm target={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetForm target={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserForm({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const { meta, touch } = useApp();
  const toast = useToast();
  const [f, setF] = useState({
    username: target?.username ?? '', name: target?.name ?? '', role: (target?.role ?? 'operator') as Role,
    zone_id: String(target?.zone_id ?? meta.zones[0]?.id ?? ''), team_id: String(target?.team_id ?? ''), password: '', active: target ? !!target.active : true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const teams = meta.teams.filter((t) => String(t.zone_id) === f.zone_id);
  const scoped = f.role !== 'super_admin';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) {
      const problem = passwordProblem(f.password);
      if (problem) return setError(problem);
    }
    if (scoped && !f.zone_id) return setError('Sila pilih zon');
    if (f.role === 'operator' && !f.team_id) return setError('Operator mesti diberi team');
    setBusy(true);
    setError(null);
    const scope = { role: f.role, zone_id: scoped ? Number(f.zone_id) : null, team_id: f.role === 'operator' ? Number(f.team_id) : null };
    try {
      if (target) await api.patch(`/admin/users/${target.id}`, { name: f.name.trim(), active: f.active, ...scope });
      else await api.post('/admin/users', { username: f.username.trim().toLowerCase(), name: f.name.trim(), password: f.password, ...scope });
      touch();
      toast(target ? 'Pengguna dikemas kini' : 'Pengguna dicipta. Beri kata laluan sementara kepadanya');
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={target ? `Edit ${target.name}` : 'Tambah pengguna'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="user-form" loading={busy}>Simpan</Button></>}>
      <form id="user-form" onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Nama penuh"><input className="input" name="name" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {!target && (
          <Field label="Nama pengguna" hint="3-32 aksara: huruf kecil, nombor, titik, sengkang">
            <input className="input" name="username" required pattern="[a-z0-9._\-]{3,32}" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />
          </Field>
        )}
        <Field label="Role" hint={ROLE_DESC[f.role]}>
          <select className="input" name="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        {scoped && (
          <Field label="Zon">
            <select className="input" name="zone" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value, team_id: '' })}>
              <option value="">Pilih zon</option>
              {meta.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Field>
        )}
        {f.role === 'operator' && (
          <Field label="Team" hint="Operator hanya boleh kerjakan tiang dan tugasan team sendiri">
            <select className="input" name="team" value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>
              <option value="">Pilih team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        {!target && (
          <Field label="Kata laluan sementara" hint="Pengguna wajib tukar pada log masuk pertama">
            <input className="input" name="password" type="text" autoComplete="off" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        )}
        {target && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-navy-800" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Akaun aktif (nyahaktif = tidak boleh log masuk, sesi dibatalkan)
          </label>
        )}
      </form>
    </Modal>
  );
}

function ResetForm({ target, onClose }: { target: UserRow; onClose: () => void }) {
  const { touch } = useApp();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api.post(`/admin/users/${target.id}/reset-password`, { password });
      touch();
      toast('Kata laluan diset semula. Semua sesi pengguna itu dibatalkan');
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Set semula kata laluan: ${target.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="reset-form" loading={busy}>Set semula</Button></>}>
      <form id="reset-form" onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Kata laluan sementara baharu" hint="Sekurang-kurangnya 10 aksara, ada huruf dan nombor. Pengguna wajib tukar selepas log masuk">
          <input className="input" type="text" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

// ---------------- Matriks kebenaran ----------------
const PERM_LABEL: Record<keyof typeof PERMS, string> = {
  'pole.create': 'Daftar tiang baharu', 'pole.edit': 'Edit biodata tiang', 'pole.delete': 'Padam tiang', 'rondaan.create': 'Rekod rondaan & lapor defect',
  'defect.assign': 'Agih tugasan kepada team', 'defect.work': 'Mula & siapkan senggaraan', 'defect.verify': 'Sahkan / tolak kerja siap', 'photo.upload': 'Muat naik gambar',
  'photo.delete': 'Padam gambar', 'data.import': 'Import CSV / Excel', 'data.export': 'Eksport CSV', 'master.manage': 'Urus team & pencawang',
  'user.manage': 'Urus pengguna, role & zon', 'audit.view': 'Lihat audit log', 'sample.manage': 'Jana / padam data contoh',
};

function RoleMatrix() {
  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-slate-200 p-3">
            <Badge color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Badge>
            <p className="mt-1.5 text-xs text-slate-600">{ROLE_DESC[r]}</p>
          </div>
        ))}
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Tindakan</th>{ROLES.map((r) => <th key={r} className="th text-center">{ROLE_LABEL[r]}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="td">Lihat peta, dashboard, profil, gambar</td>{ROLES.map((r) => <Cell key={r} on />)}</tr>
            {(Object.keys(PERMS) as (keyof typeof PERMS)[]).map((p) => (
              <tr key={p}><td className="td">{PERM_LABEL[p]}</td>{ROLES.map((r) => <Cell key={r} on={(PERMS[p] as readonly Role[]).includes(r)} />)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Admin, Operator dan Viewer hanya nampak data zon sendiri. Operator hanya boleh mengubah tiang dan tugasan team sendiri. Admin tidak boleh mengesahkan kerja yang dia sendiri tanda siap.</p>
    </div>
  );
}
const Cell = ({ on }: { on?: boolean }) => (
  <td className="td text-center">{on ? <Icon name="check" size={16} className="inline text-emerald-600" /> : <span className="text-slate-300">-</span>}</td>
);

// ---------------- Zon, team, pencawang ----------------
function MasterTab() {
  const { meta, reloadMeta } = useApp();
  const toast = useToast();
  const [zone, setZone] = useState('');
  const [team, setTeam] = useState({ zone_id: '', name: '' });
  const [sub, setSub] = useState({ zone_id: '', name: '', code: '', functional_location: '' });
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: unknown, ok: string, reset: () => void) {
    setBusy(true);
    try {
      await api.post(path, body);
      await reloadMeta();
      toast(ok);
      reset();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  }
  const zoneOpts = meta.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section>
        <h3 className="mb-2 text-sm font-bold text-slate-900">Zon (mainhead)</h3>
        <ul className="mb-3 space-y-1 text-sm">{meta.zones.map((z) => <li key={z.id} className="rounded-lg bg-slate-50 px-3 py-2 font-medium">{z.name}</li>)}{!meta.zones.length && <li className="text-slate-500">Belum ada zon</li>}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); post('/admin/zones', { name: zone }, 'Zon ditambah', () => setZone('')); }}>
          <input className="input" placeholder="cth. KL UTARA" aria-label="Nama zon" required minLength={2} value={zone} onChange={(e) => setZone(e.target.value)} />
          <Button type="submit" icon="plus" loading={busy}>Tambah</Button>
        </form>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-bold text-slate-900">Team</h3>
        <ul className="mb-3 space-y-1 text-sm">{meta.teams.map((t) => <li key={t.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="font-medium">{t.name}</span><span className="text-xs text-slate-500">{meta.zones.find((z) => z.id === t.zone_id)?.name}</span></li>)}{!meta.teams.length && <li className="text-slate-500">Belum ada team</li>}</ul>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); post('/admin/teams', { zone_id: Number(team.zone_id), name: team.name }, 'Team ditambah', () => setTeam({ ...team, name: '' })); }}>
          <select className="input" aria-label="Zon team" required value={team.zone_id} onChange={(e) => setTeam({ ...team, zone_id: e.target.value })}><option value="">Pilih zon</option>{zoneOpts}</select>
          <div className="flex gap-2"><input className="input" placeholder="cth. ECHO" aria-label="Nama team" required value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /><Button type="submit" icon="plus" loading={busy}>Tambah</Button></div>
        </form>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-bold text-slate-900">Pencawang</h3>
        <ul className="scroll-thin mb-3 max-h-64 space-y-1 overflow-y-auto text-sm">{meta.substations.map((s) => <li key={s.id} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-medium">{s.name}</span> <span className="text-xs text-slate-500">({s.code}) {s.functional_location}</span></li>)}{!meta.substations.length && <li className="text-slate-500">Belum ada pencawang</li>}</ul>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); post('/admin/substations', { zone_id: Number(sub.zone_id), name: sub.name, code: sub.code, functional_location: sub.functional_location || null }, 'Pencawang ditambah', () => setSub({ ...sub, name: '', code: '', functional_location: '' })); }}>
          <select className="input" aria-label="Zon pencawang" required value={sub.zone_id} onChange={(e) => setSub({ ...sub, zone_id: e.target.value })}><option value="">Pilih zon</option>{zoneOpts}</select>
          <input className="input" placeholder="Nama, cth. PE KG BARU" aria-label="Nama pencawang" required value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} />
          <div className="flex gap-2"><input className="input" placeholder="Kod" aria-label="Kod pencawang" required value={sub.code} onChange={(e) => setSub({ ...sub, code: e.target.value })} /><input className="input" placeholder="Functional location" aria-label="Functional location" value={sub.functional_location} onChange={(e) => setSub({ ...sub, functional_location: e.target.value })} /></div>
          <Button type="submit" icon="plus" loading={busy}>Tambah pencawang</Button>
        </form>
      </section>
    </div>
  );
}

// ---------------- Data contoh ----------------
function SampleTab() {
  const { touch, reloadMeta } = useApp();
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function generate() {
    try {
      let step = 0;
      let total = 1;
      while (step <= total) {
        setProgress(step === 0 ? 'Menyediakan zon, team dan pencawang…' : `Menjana tiang untuk pencawang ${step} / ${total}…`);
        const r = await api.post<{ total: number; done: boolean }>('/admin/sample', { step });
        total = r.total;
        if (r.done) break;
        step++;
      }
      await reloadMeta();
      touch();
      toast('Data contoh siap dijana');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setProgress(null);
    }
  }
  async function remove() {
    setConfirm(false);
    setProgress('Memadam data contoh…');
    try {
      const r = await api.del<{ poles: number }>('/admin/sample');
      await reloadMeta();
      touch();
      toast(`${r.poles} tiang contoh dipadam`);
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-slate-700">
        Data contoh mengandungi lebih kurang 1,500 tiang di sepanjang jalan sebenar Seksyen 25, Shah Alam, dalam 8 pencawang dan 4 team, dengan pelbagai status defect.
        Nama pencawang, nombor tiang dan defect semuanya <b>rekaan</b> untuk demo. Kedudukan jalan dari OpenStreetMap.
      </p>
      <p className="text-sm text-slate-700">Bila data sebenar sudah diimport, padam data contoh di sini. Tiang sebenar tidak terjejas.</p>
      {progress ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loading label={progress} /></div> : (
        <div className="flex flex-wrap gap-2">
          <Button icon="bolt" onClick={generate} data-testid="sample-generate">Jana data contoh</Button>
          <Button variant="secondary" icon="trash" onClick={() => setConfirm(true)}>Padam data contoh</Button>
        </div>
      )}
      {confirm && (
        <Modal title="Padam semua data contoh?" onClose={() => setConfirm(false)} footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Batal</Button><Button variant="danger" onClick={remove}>Ya, padam</Button></>}>
          <p className="text-sm text-slate-700">Semua tiang, defect, stage dan gambar yang ditanda sebagai contoh akan dipadam terus. Tindakan ini tidak boleh dibatalkan.</p>
        </Modal>
      )}
      {!progress && <Empty icon="file" title="" hint="Jana semula hanya boleh selepas data contoh lama dipadam." />}
    </div>
  );
}
