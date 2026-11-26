import { type FormEvent, useState } from 'react';
import { DEFECT_CATEGORIES, DEFECT_CATEGORY_INFO, type DefectCategory, SEVERITIES, SEVERITY_LABEL, type Severity, TASK_TYPE_LABEL } from '../../shared/types';
import { api, errMsg } from '../api';
import { uploadPhotos } from '../photos';
import { useApp } from '../store';
import { Button, ErrorNote, Field, Modal, useToast } from '../ui';
import PhotoInput from './PhotoInput';

type Picked = Partial<Record<DefectCategory, { severity: Severity; description: string }>>;

/** Borang rondaan: tanda defect yang dijumpai (atau tiada), tambah catatan dan gambar. */
export default function RondaanForm({ poleId, poleNo, openCategories, onClose }: { poleId: number; poleNo: string; openCategories: string[]; onClose: () => void }) {
  const { touch } = useApp();
  const toast = useToast();
  const [picked, setPicked] = useState<Picked>({});
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = Object.keys(picked).length;

  const toggle = (c: DefectCategory) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[c]) delete n[c];
      else n[c] = { severity: 'sederhana', description: '' };
      return n;
    });
  const update = (c: DefectCategory, patch: Partial<{ severity: Severity; description: string }>) => setPicked((p) => ({ ...p, [c]: { ...p[c]!, ...patch } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const defects = Object.entries(picked).map(([category, d]) => ({ category, severity: d!.severity, description: d!.description.trim() || null }));
      const r = await api.post<{ event_id: number; defect_ids: number[] }>(`/poles/${poleId}/rondaan`, { note: note.trim() || null, defects });
      const failed = files.length ? await uploadPhotos(files, { pole_id: poleId, stage_event_id: r.event_id, kind: defects.length ? 'sebelum' : 'rondaan' }) : 0;
      touch();
      toast(failed ? `Rondaan direkod, tetapi ${failed} gambar gagal dimuat naik` : defects.length ? `Rondaan direkod dengan ${r.defect_ids.length} defect` : 'Rondaan direkod: tiada defect', failed ? 'err' : 'ok');
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Rondaan tiang ${poleNo}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="rondaan-form" variant={count ? 'danger' : 'success'} loading={busy} data-testid="rondaan-submit">
            {count ? `Lapor ${count} defect` : 'Tiada defect, simpan'}
          </Button>
        </>
      }
    >
      <form id="rondaan-form" onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <div>
          <span className="label">Defect dijumpai (tanda yang berkenaan)</span>
          <div className="space-y-1.5">
            {DEFECT_CATEGORIES.map((c) => {
              const info = DEFECT_CATEGORY_INFO[c];
              const on = !!picked[c];
              const already = openCategories.includes(c);
              return (
                <div key={c} className={`rounded-lg border ${on ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                  <label className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 ${already ? 'cursor-not-allowed opacity-50' : ''}`}>
                    <input type="checkbox" className="h-4 w-4 accent-red-600" checked={on} disabled={already} onChange={() => toggle(c)} data-testid={`defect-${c}`} />
                    <span className="flex-1 text-sm font-medium text-slate-800">{info.label}</span>
                    <span className="text-[11px] text-slate-500">{already ? 'sudah dilapor' : TASK_TYPE_LABEL[info.task]}</span>
                  </label>
                  {on && (
                    <div className="grid grid-cols-[auto_1fr] gap-2 px-3 pb-3">
                      <select aria-label="Tahap" className="input w-auto" value={picked[c]!.severity} onChange={(e) => update(c, { severity: e.target.value as Severity })}>
                        {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
                      </select>
                      <input className="input" placeholder="Keterangan ringkas (pilihan)" maxLength={500} value={picked[c]!.description} onChange={(e) => update(c, { description: e.target.value })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <Field label="Catatan rondaan">
          <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div>
          <span className="label">Gambar {count ? '(sebelum dibaiki)' : ''}</span>
          <PhotoInput files={files} onChange={setFiles} />
        </div>
      </form>
    </Modal>
  );
}
