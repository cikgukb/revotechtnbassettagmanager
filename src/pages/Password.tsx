import { type FormEvent, useState } from 'react';
import { ROLE_LABEL, type SessionUser } from '../../shared/types';
import { passwordProblem } from '../../shared/password';
import { api, errMsg } from '../api';
import { useApp } from '../store';
import { Button, ErrorNote, Field, PageHeader, useToast } from '../ui';
import { Logo } from './Login';

export default function PasswordPage({ forced = false }: { forced?: boolean }) {
  const { user, setUser, logout, meta } = useApp();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(next) ?? (next !== again ? 'Kata laluan baharu tidak sepadan' : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/auth/password', { current, next });
      setUser(r.user);
      setCurrent('');
      setNext('');
      setAgain('');
      toast('Kata laluan ditukar');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="space-y-4">
      <ErrorNote>{error}</ErrorNote>
      <Field label={forced ? 'Kata laluan sementara' : 'Kata laluan semasa'}>
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Kata laluan baharu" hint="Sekurang-kurangnya 10 aksara, ada huruf dan nombor">
        <input className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Ulang kata laluan baharu">
        <input className="input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Tukar kata laluan
        </Button>
        {forced && (
          <Button variant="ghost" onClick={logout}>
            Log keluar
          </Button>
        )}
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="card w-full max-w-sm p-6">
          <div className="mb-4 flex items-center gap-3">
            <Logo />
            <div>
              <div className="font-bold text-slate-900">Tukar kata laluan</div>
              <div className="text-xs text-slate-500">Wajib sebelum guna sistem buat kali pertama</div>
            </div>
          </div>
          {form}
        </div>
      </div>
    );
  }

  const zone = meta.zones.find((z) => z.id === user?.zone_id)?.name;
  const team = meta.teams.find((t) => t.id === user?.team_id)?.name;
  return (
    <div className="mx-auto max-w-xl p-4 md:p-6">
      <PageHeader title="Akaun saya" />
      <div className="card mb-4 grid grid-cols-2 gap-4 p-4 text-sm">
        <Info label="Nama" value={user?.name} />
        <Info label="Nama pengguna" value={user?.username} />
        <Info label="Role" value={user ? ROLE_LABEL[user.role] : ''} />
        <Info label="Zon / Team" value={[zone ?? 'Semua zon', team].filter(Boolean).join(' / ')} />
      </div>
      <div className="card p-4">
        <h2 className="mb-3 font-bold text-slate-900">Tukar kata laluan</h2>
        {form}
      </div>
    </div>
  );
}

const Info = ({ label, value }: { label: string; value?: string }) => (
  <div>
    <div className="label">{label}</div>
    <div className="font-medium text-slate-900">{value || '-'}</div>
  </div>
);
