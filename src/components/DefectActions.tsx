import { useState } from 'react';
import { type DefectRow, type SessionUser, TASK_TYPES, TASK_TYPE_LABEL, type TaskType, can } from '../../shared/types';
import { api, errMsg } from '../api';
import { uploadPhotos } from '../photos';
import { useApp } from '../store';
import { Button, ErrorNote, Field, Modal, useToast } from '../ui';
import PhotoInput from './PhotoInput';

/** Cerminan semakan pelayan, supaya butang yang tak dibenarkan tidak dipapar. Pelayan tetap kuat kuasa. */
export function canWorkDefect(u: SessionUser | null | undefined, d: { zone_id: number; assigned_team_id: number | null }) {
  if (!u || !can(u.role, 'defect.work')) return false;
  if (u.role === 'super_admin') return true;
  if (u.zone_id !== d.zone_id) return false;
  return u.role === 'admin' || (u.team_id !== null && u.team_id === d.assigned_team_id);
}

type Dialog = null | 'assign' | 'complete' | 'reject';

/** Butang tindakan untuk satu defect, mengikut status semasa dan role pengguna. */
export default function DefectActions({ defect, size = 'sm' }: { defect: DefectRow; size?: 'sm' | 'md' }) {
  const { user, meta, touch } = useApp();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [teamId, setTeamId] = useState(String(defect.assigned_team_id ?? ''));
  const [taskType, setTaskType] = useState<TaskType>(defect.task_type);

  const work = canWorkDefect(user, defect);
  const verify = can(user?.role, 'defect.verify') && (user!.role === 'super_admin' || user!.zone_id === defect.zone_id);
  const assign = can(user?.role, 'defect.assign') && (user!.role === 'super_admin' || user!.zone_id === defect.zone_id) && defect.status !== 'disahkan';
  const ownWork = user?.role !== 'super_admin' && defect.completed_by === user?.id;
  const teams = meta.teams.filter((t) => t.zone_id === defect.zone_id);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const msg = await fn();
      touch();
      toast(msg);
      setDialog(null);
      setNote('');
      setFiles([]);
    } catch (e) {
      if (dialog) setError(errMsg(e));
      else toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => (await api.post(`/defects/${defect.id}/start`, {}), 'Senggaraan dimulakan'));
  const complete = () =>
    run(async () => {
      const r = await api.post<{ event_id: number }>(`/defects/${defect.id}/complete`, { note: note.trim() || null });
      const failed = files.length ? await uploadPhotos(files, { pole_id: defect.pole_id, defect_id: defect.id, stage_event_id: r.event_id, kind: 'selepas' }) : 0;
      return failed ? `Ditanda siap, tetapi ${failed} gambar gagal dimuat naik` : 'Ditanda siap. Menunggu pengesahan admin';
    });
  const approve = () => run(async () => (await api.post(`/defects/${defect.id}/verify`, {}), 'Kerja disahkan. Defect ditutup'));
  const reject = () => run(async () => (await api.post(`/defects/${defect.id}/reject`, { note: note.trim() }), 'Ditolak. Dihantar semula untuk dibaiki'));
  const doAssign = () => run(async () => (await api.post(`/defects/${defect.id}/assign`, { team_id: teamId ? Number(teamId) : null, task_type: taskType }), 'Tugasan diagih'));

  const buttons = (
    <div className="flex flex-wrap gap-1.5">
      {defect.status === 'belum' && work && <Button size={size} variant="volt" icon="tool" loading={busy && !dialog} onClick={start} data-testid="defect-start">Mula senggara</Button>}
      {defect.status === 'sedang' && work && <Button size={size} variant="success" icon="check" onClick={() => setDialog('complete')} data-testid="defect-complete">Tanda siap</Button>}
      {defect.status === 'selesai' && verify && !ownWork && (
        <>
          <Button size={size} variant="success" icon="check" loading={busy && !dialog} onClick={approve} data-testid="defect-verify">Sahkan</Button>
          <Button size={size} variant="secondary" icon="x" onClick={() => setDialog('reject')} data-testid="defect-reject">Tolak</Button>
        </>
      )}
      {defect.status === 'selesai' && verify && ownWork && <span className="text-[11px] text-slate-500">Perlu disahkan oleh admin lain</span>}
      {assign && <Button size={size} variant="ghost" icon="users" onClick={() => setDialog('assign')} data-testid="defect-assign">Agih</Button>}
    </div>
  );

  return (
    <>
      {buttons}
      {dialog === 'complete' && (
        <Modal title="Tanda senggaraan siap" onClose={() => setDialog(null)} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Batal</Button><Button variant="success" loading={busy} onClick={complete} data-testid="complete-submit">Hantar untuk pengesahan</Button></>}>
          <div className="space-y-3">
            <ErrorNote>{error}</ErrorNote>
            <Field label="Catatan kerja"><textarea className="input" rows={3} maxLength={1000} placeholder="Apa yang dibaiki / diganti" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div><span className="label">Gambar selepas dibaiki</span><PhotoInput files={files} onChange={setFiles} /></div>
          </div>
        </Modal>
      )}
      {dialog === 'reject' && (
        <Modal title="Tolak kerja ini" onClose={() => setDialog(null)} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Batal</Button><Button variant="danger" loading={busy} disabled={!note.trim()} onClick={reject}>Tolak dan hantar semula</Button></>}>
          <div className="space-y-3">
            <ErrorNote>{error}</ErrorNote>
            <Field label="Sebab ditolak" hint="Operator akan nampak catatan ini dalam timeline"><textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
          </div>
        </Modal>
      )}
      {dialog === 'assign' && (
        <Modal title="Agih tugasan" onClose={() => setDialog(null)} footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Batal</Button><Button loading={busy} onClick={doAssign}>Simpan</Button></>}>
          <div className="space-y-3">
            <ErrorNote>{error}</ErrorNote>
            <Field label="Team">
              <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Tiada team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Jenis tugasan">
              <select className="input" value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
