// Profil tiang: "biodata", stages (timeline kitar hayat), defect, gambar dan tag QR.
// Dipapar sebagai panel sisi di peta, dan sebagai halaman penuh bila tag QR diimbas.
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { poleStep } from '../../shared/stages';
import {
  DEFECT_CATEGORY_INFO, DEFECT_STATUS_COLOR, DEFECT_STATUS_LABEL, PHOTO_KIND_LABEL, POLE_STATUS_COLOR, POLE_STATUS_LABEL,
  type PhotoRow, type PoleProfile as Profile, type PoleRow, SEVERITY_LABEL, STAGE_LABEL, STEPS, type SessionUser, type Stage,
  type StageEvent, TASK_TYPE_LABEL, can,
} from '../../shared/types';
import { api, errMsg } from '../api';
import { fmtAgo, fmtDateTime } from '../fmt';
import { photoUrl, uploadPhotos } from '../photos';
import { Link, navigate } from '../router';
import { useApp, useFetch } from '../store';
import { Badge, Button, Empty, ErrorNote, Icon, type IconName, Loading, Modal, Tabs, useToast } from '../ui';
import DefectActions from './DefectActions';
import PhotoInput from './PhotoInput';
import PoleForm from './PoleForm';
import RondaanForm from './RondaanForm';

type Tab = 'biodata' | 'stages' | 'defect' | 'gambar' | 'qr';

function canWrite(u: SessionUser | null | undefined, p: PoleRow) {
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  if (u.zone_id !== p.zone_id) return false;
  if (u.role === 'admin') return true;
  return u.role === 'operator' && u.team_id !== null && u.team_id === p.team_id;
}

const STAGE_STYLE: Record<Stage, { icon: IconName; color: string }> = {
  DAFTAR: { icon: 'pin', color: '#64748b' },
  RONDAAN: { icon: 'eye', color: '#0ea5e9' },
  DEFECT: { icon: 'alert', color: '#ef4444' },
  AGIH: { icon: 'users', color: '#8b5cf6' },
  SEDANG: { icon: 'tool', color: '#f59e0b' },
  SELESAI: { icon: 'check', color: '#3b82f6' },
  DISAHKAN: { icon: 'shield', color: '#22c55e' },
  DITOLAK: { icon: 'x', color: '#dc2626' },
  KEMASKINI: { icon: 'edit', color: '#64748b' },
};

export default function PoleProfile({ id, onClose, page = false }: { id: number; onClose?: () => void; page?: boolean }) {
  const { user, touch } = useApp();
  const toast = useToast();
  const { data, error, loading } = useFetch<Profile>(`/poles/${id}`);
  const [tab, setTab] = useState<Tab>('biodata');
  const [rondaan, setRondaan] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoom, setZoom] = useState<PhotoRow | null>(null);
  useEffect(() => setTab('biodata'), [id]);

  if (error && !data) {
    return (
      <div className="p-4">
        <ErrorNote>{error}</ErrorNote>
        {onClose && <Button variant="secondary" className="mt-3" onClick={onClose}>Tutup</Button>}
      </div>
    );
  }
  if (!data || data.pole.id !== id) return loading ? <Loading label="Memuatkan profil…" /> : null;

  const { pole, defects, events, photos } = data;
  const step = poleStep(pole);
  const write = canWrite(user, pole);
  const open = defects.filter((d) => d.status !== 'disahkan');
  const color = POLE_STATUS_COLOR[pole.status];

  async function remove() {
    try {
      await api.del(`/poles/${pole.id}`);
      touch();
      toast('Tiang dipadam');
      setConfirmDelete(false);
      if (onClose) onClose();
      else navigate('/tiang');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pole-profile">
      {/* Kepala */}
      <div className="relative shrink-0 bg-navy-950 p-4 text-white">
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10" style={{ boxShadow: `0 0 0 2px ${color}` }}>
            {pole.photo_id ? <img src={photoUrl(pole.photo_id, true)} alt="Gambar tiang" className="h-full w-full object-cover" /> : <Icon name="bolt" size={28} className="text-volt-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{pole.substation_name}</div>
            <h2 className="truncate text-2xl font-bold leading-tight" data-testid="pole-no">{pole.no_tiang_rondaan}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge color={color} soft={false}>{POLE_STATUS_LABEL[pole.status]}</Badge>
              <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]">{pole.tag_code}</span>
            </div>
          </div>
          {onClose && (
            <button type="button" aria-label="Tutup profil" onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" data-testid="profile-close">
              <Icon name="x" />
            </button>
          )}
        </div>

        {/* Stepper: kedudukan tiang dalam kitar hayat */}
        <ol className="mt-4 grid grid-cols-6 gap-1" aria-label="Stage semasa">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = n < step || (n === step && (step === 6 || step === 2 || step === 1));
            const current = n === step;
            return (
              <li key={label} className="flex flex-col items-center gap-1 text-center" aria-current={current ? 'step' : undefined}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${current ? 'text-navy-950' : done ? 'bg-white/25 text-white' : 'bg-white/5 text-slate-500'}`} style={current ? { backgroundColor: n >= 3 && n <= 5 ? color : '#fbbf24' } : undefined}>
                  {done && !current ? <Icon name="check" size={12} /> : n}
                </span>
                <span className={`text-[9px] leading-tight ${current ? 'font-bold text-white' : n < step ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Tindakan */}
      {(write || page) && (
        <div className="no-print flex shrink-0 flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          {write && can(user?.role, 'rondaan.create') && <Button size="sm" icon="eye" onClick={() => setRondaan(true)} data-testid="btn-rondaan">Rondaan</Button>}
          {write && can(user?.role, 'pole.edit') && <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
          {page && <Button size="sm" variant="secondary" icon="cube" onClick={() => navigate(`/?tiang=${pole.id}`)}>Lihat di peta 3D</Button>}
          {write && can(user?.role, 'pole.delete') && <Button size="sm" variant="ghost" icon="trash" className="ml-auto text-red-600" onClick={() => setConfirmDelete(true)}>Padam</Button>}
        </div>
      )}

      <div className="shrink-0">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'biodata', label: 'Biodata' },
            { id: 'stages', label: 'Stages', count: events.length },
            { id: 'defect', label: 'Defect', count: open.length },
            { id: 'gambar', label: 'Gambar', count: photos.length },
            { id: 'qr', label: 'Tag QR' },
          ]}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'biodata' && <Biodata pole={pole} />}
        {tab === 'stages' && <Timeline events={events} photos={photos} onZoom={setZoom} />}
        {tab === 'defect' && (
          <div className="space-y-3">
            {defects.length === 0 && <Empty icon="check" title="Tiada defect direkod" hint={pole.last_rondaan_at ? 'Rondaan terakhir tidak menemui masalah.' : 'Tiang ini belum dironda.'} />}
            {defects.map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-200 p-3" data-testid="defect-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{DEFECT_CATEGORY_INFO[d.category]?.label ?? d.category}</div>
                    <div className="text-xs text-slate-500">{TASK_TYPE_LABEL[d.task_type]} · Tahap {SEVERITY_LABEL[d.severity].toLowerCase()} · {d.team_name ? `Team ${d.team_name}` : 'Belum diagih'}</div>
                  </div>
                  <Badge color={DEFECT_STATUS_COLOR[d.status]}>{DEFECT_STATUS_LABEL[d.status]}</Badge>
                </div>
                {d.description && <p className="mt-2 text-sm text-slate-700">{d.description}</p>}
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <div>Dilapor: <span className="text-slate-700">{fmtDateTime(d.reported_at)}</span></div>
                  <div>Oleh: <span className="text-slate-700">{d.reported_by_name ?? '-'}</span></div>
                  {d.started_at && <div>Mula: <span className="text-slate-700">{fmtDateTime(d.started_at)}</span></div>}
                  {d.completed_at && <div>Siap: <span className="text-slate-700">{fmtDateTime(d.completed_at)} ({d.completed_by_name ?? '-'})</span></div>}
                  {d.verified_at && <div className="col-span-2">Disahkan: <span className="text-slate-700">{fmtDateTime(d.verified_at)} ({d.verified_by_name ?? '-'})</span></div>}
                </dl>
                <PhotoStrip photos={photos.filter((p) => p.defect_id === d.id)} onZoom={setZoom} />
                <div className="mt-2"><DefectActions defect={d} /></div>
              </div>
            ))}
          </div>
        )}
        {tab === 'gambar' && <Gallery pole={pole} photos={photos} canUpload={write && can(user?.role, 'photo.upload')} canDelete={can(user?.role, 'photo.delete')} onZoom={setZoom} />}
        {tab === 'qr' && <TagQr pole={pole} />}
      </div>

      {rondaan && <RondaanForm poleId={pole.id} poleNo={pole.no_tiang_rondaan} openCategories={open.map((d) => d.category)} onClose={() => setRondaan(false)} />}
      {editing && <PoleForm pole={pole} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {confirmDelete && (
        <Modal title="Padam tiang ini?" onClose={() => setConfirmDelete(false)} footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Batal</Button><Button variant="danger" onClick={remove}>Ya, padam</Button></>}>
          <p className="text-sm text-slate-700">Tiang <b>{pole.no_tiang_rondaan}</b> akan dibuang dari peta dan senarai. Rekod lama kekal dalam audit log.</p>
        </Modal>
      )}
      {zoom && (
        <Modal title={`${PHOTO_KIND_LABEL[zoom.kind]} · ${fmtDateTime(zoom.created_at)}`} onClose={() => setZoom(null)} wide>
          <img src={photoUrl(zoom.id)} alt={`Gambar ${PHOTO_KIND_LABEL[zoom.kind]}`} className="mx-auto max-h-[70dvh] rounded-lg" />
          <p className="mt-2 text-center text-xs text-slate-500">Dimuat naik oleh {zoom.uploaded_by_name ?? '-'}</p>
        </Modal>
      )}
    </div>
  );
}

function Biodata({ pole }: { pole: PoleRow }) {
  const rows: [string, React.ReactNode][] = [
    ['No tiang rondaan', pole.no_tiang_rondaan],
    ['No tiang lama', pole.no_tiang_lama],
    ['Pencawang', `${pole.substation_name} (${pole.substation_code})`],
    ['Functional location', pole.functional_location],
    ['Mainhead / zon', pole.zone_name],
    ['Team', pole.team_name],
    ['Nama jalan', pole.street],
    ['Jenis tiang', pole.pole_type],
    ['Bahan', pole.material],
    ['Tinggi', pole.height_m ? `${pole.height_m} m` : null],
    ['Tahun pasang', pole.install_year ? `${pole.install_year} (${new Date().getFullYear() - pole.install_year} tahun)` : null],
    ['Rondaan terakhir', pole.last_rondaan_at ? `${fmtDateTime(pole.last_rondaan_at)} (${fmtAgo(pole.last_rondaan_at)})` : 'Belum dironda'],
    ['Defect terbuka / jumlah', `${pole.open_defects} / ${pole.total_defects}`],
    ['Didaftar', `${fmtDateTime(pole.created_at)}${pole.created_by_name ? ` oleh ${pole.created_by_name}` : ''}`],
  ];
  const coords = `${pole.lat.toFixed(6)}, ${pole.lng.toFixed(6)}`;
  return (
    <div>
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[42%_1fr] gap-2 py-2 text-sm">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-slate-900">{v || <span className="font-normal text-slate-400">-</span>}</dd>
          </div>
        ))}
        <div className="grid grid-cols-[42%_1fr] gap-2 py-2 text-sm">
          <dt className="text-slate-500">Koordinat</dt>
          <dd className="font-medium text-slate-900">
            <span className="font-mono text-xs">{coords}</span>
            <a className="ml-2 text-xs font-semibold text-navy-700 underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${pole.lat},${pole.lng}`}>
              Navigasi
            </a>
          </dd>
        </div>
      </dl>
      {pole.notes && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{pole.notes}</p>}
    </div>
  );
}

function PhotoStrip({ photos, onZoom }: { photos: PhotoRow[]; onZoom: (p: PhotoRow) => void }) {
  if (!photos.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {photos.map((p) => (
        <button key={p.id} type="button" onClick={() => onZoom(p)} className="relative h-14 w-14 overflow-hidden rounded-lg border border-slate-200" title={PHOTO_KIND_LABEL[p.kind]}>
          <img src={photoUrl(p.id, true)} alt={PHOTO_KIND_LABEL[p.kind]} loading="lazy" className="h-full w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-navy-950/70 text-center text-[8px] font-semibold uppercase text-white">{PHOTO_KIND_LABEL[p.kind]}</span>
        </button>
      ))}
    </div>
  );
}

function Timeline({ events, photos, onZoom }: { events: StageEvent[]; photos: PhotoRow[]; onZoom: (p: PhotoRow) => void }) {
  if (!events.length) return <Empty icon="clock" title="Belum ada rekod stage" />;
  return (
    <ol className="relative ml-3 border-l-2 border-slate-200" data-testid="timeline">
      {events.map((e) => {
        const st = STAGE_STYLE[e.stage] ?? STAGE_STYLE.KEMASKINI;
        return (
          <li key={e.id} className="relative pb-4 pl-6 last:pb-0">
            <span className="absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full text-white ring-4 ring-white" style={{ backgroundColor: st.color }}>
              <Icon name={st.icon} size={12} />
            </span>
            <div className="text-sm font-semibold text-slate-900">{STAGE_LABEL[e.stage] ?? e.stage}</div>
            {e.note && <div className="text-sm text-slate-700">{e.note}</div>}
            <div className="text-[11px] text-slate-500">{fmtDateTime(e.at)} · {e.actor_name ?? 'Sistem'}</div>
            <PhotoStrip photos={photos.filter((p) => p.stage_event_id === e.id)} onZoom={onZoom} />
          </li>
        );
      })}
    </ol>
  );
}

function Gallery({ pole, photos, canUpload, canDelete, onZoom }: { pole: PoleRow; photos: PhotoRow[]; canUpload: boolean; canDelete: boolean; onZoom: (p: PhotoRow) => void }) {
  const { touch } = useApp();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload() {
    setBusy(true);
    const failed = await uploadPhotos(files, { pole_id: pole.id, kind: 'profil' });
    setBusy(false);
    setFiles([]);
    touch();
    toast(failed ? `${failed} gambar gagal dimuat naik` : 'Gambar dimuat naik', failed ? 'err' : 'ok');
  }
  async function remove(p: PhotoRow) {
    try {
      await api.del(`/photos/${p.id}`);
      touch();
      toast('Gambar dipadam');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="rounded-xl border border-slate-200 p-3">
          <PhotoInput files={files} onChange={setFiles} />
          {files.length > 0 && <Button size="sm" className="mt-2" icon="upload" loading={busy} onClick={upload}>Muat naik {files.length} gambar</Button>}
        </div>
      )}
      {photos.length === 0 ? (
        <Empty icon="image" title="Belum ada gambar" />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              <button type="button" onClick={() => onZoom(p)} className="h-full w-full">
                <img src={photoUrl(p.id, true)} alt={PHOTO_KIND_LABEL[p.kind]} loading="lazy" className="h-full w-full object-cover" />
              </button>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-navy-950/70 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">{PHOTO_KIND_LABEL[p.kind]} · {fmtAgo(p.created_at)}</span>
              {canDelete && (
                <button type="button" aria-label="Padam gambar" onClick={() => remove(p)} className="absolute right-1 top-1 rounded-full bg-navy-950/80 p-1 text-white opacity-0 focus:opacity-100 group-hover:opacity-100">
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagQr({ pole }: { pole: PoleRow }) {
  const url = useMemo(() => `${location.origin}/t/${pole.tag_code}`, [pole.tag_code]);
  const [src, setSrc] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    let dead = false;
    QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' }).then((d) => !dead && setSrc(d));
    return () => {
      dead = true;
    };
  }, [url]);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="rounded-2xl border-2 border-navy-900 p-3">
        {src ? <img src={src} alt={`Kod QR ${pole.tag_code}`} className="h-48 w-48" data-testid="qr-image" /> : <div className="h-48 w-48" />}
        <div className="mt-1 font-mono text-lg font-bold tracking-wider text-navy-900">{pole.tag_code}</div>
        <div className="text-[11px] text-slate-500">{pole.substation_code} · {pole.no_tiang_rondaan}</div>
      </div>
      <p className="max-w-xs text-xs text-slate-500">Lekat tag ini pada tiang. Imbas dengan kamera telefon untuk terus buka profil ini (perlu log masuk).</p>
      <div className="no-print flex flex-wrap justify-center gap-2">
        {src && <a href={src} download={`tag-${pole.tag_code}.png`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-navy-800 px-2.5 text-xs font-semibold text-white hover:bg-navy-700"><Icon name="download" size={14} /> Muat turun PNG</a>}
        <Button size="sm" variant="secondary" icon="file" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Pautan disalin'), () => toast('Tidak dapat salin', 'err'))}>Salin pautan</Button>
        <Link to={`/tiang/${pole.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Icon name="eye" size={14} /> Halaman penuh</Link>
      </div>
    </div>
  );
}
