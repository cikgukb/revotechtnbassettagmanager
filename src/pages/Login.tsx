import { type FormEvent, useState } from 'react';
import type { SessionUser } from '../../shared/types';
import { api, errMsg } from '../api';
import logoUrl from '../assets/revotech-logo.png';
import { useApp } from '../store';
import { Button, ErrorNote, Field, Icon } from '../ui';

// Nisbah lebar:tinggi fail logo (361 x 218 px).
const LOGO_RATIO = 361 / 218;

/**
 * Logo Revotech Electrical Sdn Bhd. `size` ialah tinggi imej dalam px.
 * Tulisan logo berwarna gelap, jadi atas latar gelap guna `plate` (plat putih) supaya ia terbaca.
 */
export function Logo({ size = 36, plate = false }: { size?: number; plate?: boolean }) {
  const img = (
    <img
      src={logoUrl}
      alt="Revotech Electrical Sdn Bhd"
      width={Math.round(size * LOGO_RATIO)}
      height={size}
      className="block shrink-0"
      draggable={false}
    />
  );
  if (!plate) return img;
  return <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-1.5 py-1">{img}</span>;
}

const POINTS: { icon: 'cube' | 'pin' | 'tasks' | 'shield'; text: string }[] = [
  { icon: 'cube', text: 'Peta 3D: nampak terus tiang mana yang bermasalah' },
  { icon: 'pin', text: 'Profil setiap tiang dengan timeline stage dan gambar' },
  { icon: 'tasks', text: 'Tugasan senggaraan dari lapor defect sampai disahkan' },
  { icon: 'shield', text: 'Akses ikut role: Super Admin, Admin, Operator, Viewer' },
];

export default function LoginPage() {
  const { setUser } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/auth/login', { username: username.trim(), password });
      setUser(r.user);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 20% 15%, #26508a 0, transparent 45%), radial-gradient(circle at 85% 80%, #1a3a66 0, transparent 50%)' }} />
        <div className="relative flex items-center gap-3">
          <Logo size={64} plate />
          <div>
            <div className="text-lg font-bold leading-tight">Revotech Asset Tag Manager</div>
            <div className="text-xs text-slate-300">Pengurusan aset tiang dan respons defect</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="max-w-md text-3xl font-bold leading-tight">Setiap tiang ada profil. Setiap defect ada pemilik.</h1>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-sm text-slate-200">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-volt-400">
                  <Icon name={p.icon} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-slate-400">Sistem dalaman. Akses hanya untuk pengguna yang dibenarkan.</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <Logo size={48} />
            <div className="text-base font-bold leading-tight text-slate-900">Revotech Asset Tag Manager</div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Log masuk</h2>
            <p className="text-sm text-slate-500">Guna akaun yang diberi oleh Super Admin.</p>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Field label="Nama pengguna">
            <input className="input" autoComplete="username" autoCapitalize="none" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Kata laluan">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Log masuk
          </Button>
          <p className="text-center text-xs text-slate-500">Lupa kata laluan? Hubungi Super Admin untuk set semula.</p>
        </form>
      </div>
    </div>
  );
}
