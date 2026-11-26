import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import PoleProfile from '../components/PoleProfile';
import { Link, navigate } from '../router';
import { Empty, Icon, Loading } from '../ui';

/** Halaman penuh profil tiang. `/t/:kod` ialah pautan dalam tag QR: cari tiang ikut kod tag dahulu. */
export default function ProfilePage({ id, tag }: { id?: number; tag?: string }) {
  const [resolved, setResolved] = useState<number | null>(id && Number.isInteger(id) ? id : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tag) return;
    let dead = false;
    api
      .get<{ id: number }>(`/poles/tag/${encodeURIComponent(tag)}`)
      .then((r) => !dead && navigate(`/tiang/${r.id}`, true))
      .catch((e) => !dead && setError(errMsg(e)));
    return () => {
      dead = true;
    };
  }, [tag]);
  useEffect(() => setResolved(id && Number.isInteger(id) ? id : null), [id]);

  if (error) return <Empty icon="qr" title="Tag tidak dijumpai" hint={`${error}. Tag mungkin dari zon lain atau tiang sudah dipadam.`} />;
  if (!resolved) return tag ? <Loading label="Mencari tag…" /> : <Empty title="Tiang tidak dijumpai" />;
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col md:p-4">
      <Link to="/tiang" className="no-print flex items-center gap-1 px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 md:px-0">
        <Icon name="chevron" size={14} className="rotate-180" /> Senarai tiang
      </Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white md:rounded-xl md:border md:border-slate-200 md:shadow-sm">
        <PoleProfile id={resolved} page />
      </div>
    </div>
  );
}
