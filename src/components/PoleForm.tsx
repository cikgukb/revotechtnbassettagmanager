import { type FormEvent, useState } from 'react';
import { POLE_MATERIALS, POLE_TYPES, type PoleRow } from '../../shared/types';
import { api, errMsg } from '../api';
import { uploadPhotos } from '../photos';
import { useApp } from '../store';
import { Button, ErrorNote, Field, Modal, useToast } from '../ui';
import PhotoInput from './PhotoInput';

interface Props {
  /** Lokasi awal untuk tiang baharu (biasanya tengah peta). */
  initial?: { lat: number; lng: number };
  /** Jika diberi, borang dalam mod edit. */
  pole?: PoleRow;
  onClose: () => void;
  onSaved: (id: number) => void;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

export default function PoleForm({ initial, pole, onClose, onSaved }: Props) {
  const { user, meta, touch } = useApp();
  const toast = useToast();
  const editing = !!pole;
  const [f, setF] = useState({
    substation_id: String(pole?.substation_id ?? meta.substations[0]?.id ?? ''),
    no_tiang_rondaan: pole?.no_tiang_rondaan ?? '',
    no_tiang_lama: pole?.no_tiang_lama ?? '',
    street: pole?.street ?? '',
    pole_type: pole?.pole_type ?? 'LV',
    material: pole?.material ?? 'Konkrit',
    height_m: String(pole?.height_m ?? 9),
    install_year: String(pole?.install_year ?? ''),
    team_id: String(pole?.team_id ?? ''),
    lat: String(pole?.lat ?? initial?.lat.toFixed(6) ?? ''),
    lng: String(pole?.lng ?? initial?.lng.toFixed(6) ?? ''),
    notes: pole?.notes ?? '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const sub = meta.substations.find((s) => s.id === Number(f.substation_id));
  const teams = meta.teams.filter((t) => !sub || t.zone_id === sub.zone_id);
  const isOperator = user?.role === 'operator';

  function useGps() {
    if (!navigator.geolocation) return setError('Peranti ini tidak menyokong GPS');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((s) => ({ ...s, lat: p.coords.latitude.toFixed(7), lng: p.coords.longitude.toFixed(7) }));
        setLocating(false);
        toast(`Lokasi GPS diambil (ketepatan ±${Math.round(p.coords.accuracy)} m)`);
      },
      () => {
        setLocating(false);
        setError('Tidak dapat lokasi GPS. Benarkan akses lokasi atau isi koordinat sendiri');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lat = Number(f.lat), lng = Number(f.lng);
    if (!f.substation_id) return setError('Sila pilih pencawang');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || f.lat.trim() === '' || f.lng.trim() === '') return setError('Koordinat tidak sah');
    const body: Record<string, unknown> = {
      substation_id: Number(f.substation_id),
      no_tiang_rondaan: f.no_tiang_rondaan.trim(),
      no_tiang_lama: f.no_tiang_lama.trim() || null,
      street: f.street.trim() || null,
      pole_type: f.pole_type || null,
      material: f.material || null,
      height_m: num(f.height_m),
      install_year: num(f.install_year),
      lat,
      lng,
      notes: f.notes.trim() || null,
    };
    if (!isOperator) body.team_id = f.team_id ? Number(f.team_id) : null;
    setBusy(true);
    setError(null);
    try {
      let id: number;
      if (editing) {
        await api.patch(`/poles/${pole!.id}`, body);
        id = pole!.id;
      } else {
        id = (await api.post<{ id: number }>('/poles', body)).id;
      }
      const failed = files.length ? await uploadPhotos(files, { pole_id: id, kind: 'profil' }) : 0;
      touch();
      toast(failed ? `Tiang disimpan, tetapi ${failed} gambar gagal dimuat naik` : editing ? 'Maklumat tiang dikemas kini' : 'Tiang didaftar dan ditag', failed ? 'err' : 'ok');
      onSaved(id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!meta.substations.length) {
    return (
      <Modal title="Daftar tiang" onClose={onClose}>
        <p className="text-sm text-slate-600">Belum ada pencawang dalam zon ini. Minta admin tambah pencawang dahulu (Senarai Tiang → Import, atau Pengguna &amp; Tetapan).</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={editing ? `Edit tiang ${pole!.no_tiang_rondaan}` : 'Daftar tiang baharu'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="pole-form" loading={busy}>{editing ? 'Simpan' : 'Daftar tiang'}</Button>
        </>
      }
    >
      <form id="pole-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><ErrorNote>{error}</ErrorNote></div>
        <Field label="Pencawang" className="col-span-2">
          <select className="input" value={f.substation_id} onChange={set('substation_id')} required>
            {meta.substations.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </Field>
        <Field label="No tiang rondaan">
          <input className="input" name="no_tiang_rondaan" required maxLength={40} placeholder="cth. N 8/2" value={f.no_tiang_rondaan} onChange={set('no_tiang_rondaan')} />
        </Field>
        <Field label="No tiang lama">
          <input className="input" maxLength={40} placeholder="cth. JBT4A 7" value={f.no_tiang_lama} onChange={set('no_tiang_lama')} />
        </Field>
        <Field label="Nama jalan" className="col-span-2">
          <input className="input" maxLength={120} value={f.street} onChange={set('street')} />
        </Field>
        <Field label="Jenis tiang">
          <select className="input" value={f.pole_type} onChange={set('pole_type')}>
            {[...new Set([...POLE_TYPES, f.pole_type].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Bahan">
          <select className="input" value={f.material} onChange={set('material')}>
            {[...new Set([...POLE_MATERIALS, f.material].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Tinggi (m)">
          <input className="input" type="number" step="0.1" min="1" max="60" value={f.height_m} onChange={set('height_m')} />
        </Field>
        <Field label="Tahun pasang">
          <input className="input" type="number" min="1950" max="2100" value={f.install_year} onChange={set('install_year')} />
        </Field>
        {!isOperator && (
          <Field label="Team" className="col-span-2">
            <select className="input" value={f.team_id} onChange={set('team_id')}>
              <option value="">Tiada team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Latitud">
          <input className="input" name="lat" inputMode="decimal" required value={f.lat} onChange={set('lat')} />
        </Field>
        <Field label="Longitud">
          <input className="input" name="lng" inputMode="decimal" required value={f.lng} onChange={set('lng')} />
        </Field>
        <div className="col-span-2 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{editing ? 'Tukar koordinat jika lokasi asal tersasar.' : 'Koordinat diambil dari tengah peta. Di site, guna GPS.'}</span>
          <Button variant="secondary" size="sm" icon="locate" loading={locating} onClick={useGps}>Guna GPS</Button>
        </div>
        <Field label="Catatan" className="col-span-2">
          <textarea className="input" rows={2} maxLength={1000} value={f.notes} onChange={set('notes')} />
        </Field>
        <div className="col-span-2">
          <span className="label">Gambar tiang</span>
          <PhotoInput files={files} onChange={setFiles} max={3} />
        </div>
      </form>
    </Modal>
  );
}
