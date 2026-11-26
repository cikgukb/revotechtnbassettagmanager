import { useState } from 'react';
import Papa from 'papaparse';
import { DEFECT_COLUMNS, type ImportRowInput, SAVR_COLUMNS, mapSavrRow, toCsv } from '../../shared/savr';
import { api, errMsg } from '../api';
import { fmtNum } from '../fmt';
import { useApp } from '../store';
import { Button, ErrorNote, Field, Icon, Modal, useToast } from '../ui';

interface Parsed { rows: { line: number; row: ImportRowInput }[]; errors: { line: number; message: string }[] }
interface ApiResult { inserted: number; updated: number; errors: number; new_substations: string[]; new_teams: string[]; results: { row: number; action: string; message?: string }[] }
interface Summary { inserted: number; updated: number; errors: { line: number; message: string }[]; newSubs: string[]; newTeams: string[] }

const CHUNK = 100;

/** Baca CSV atau Excel menjadi senarai objek (tajuk lajur -> nilai). */
async function readFile(file: File): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const sheet = (await readSheet(file)) as unknown[][];
    const [head, ...body] = sheet;
    return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [String(h ?? `lajur${i}`), r[i]])));
  }
  const text = await file.text();
  const out = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: 'greedy' });
  return out.data;
}

function downloadTemplate() {
  const header = [...SAVR_COLUMNS.filter((c) => c.key !== 'latlng').map((c) => c.header), ...Object.values(DEFECT_COLUMNS)];
  const sample = ['PE CONTOH 1', 'SHAH ALAM', 'ALPHA', 'BSAM/PCE/J00000', 'CTH1', 'N 1', 'JBT1A 1', '29/12/2025, 09:15:00 am', 'Jalan Contoh 1', 'LV', 'Konkrit', 9, 2005, 3.0731, 101.5183, 1, '', '', '', '', '', ''];
  const blob = new Blob(['﻿' + toCsv([header, sample])], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'templat-senarai-tiang.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ImportWizard({ onClose }: { onClose: () => void }) {
  const { user, meta, touch, reloadMeta } = useApp();
  const toast = useToast();
  const [zoneId, setZoneId] = useState(String(user?.zone_id ?? meta.zones[0]?.id ?? ''));
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(p: Parsed, dry: boolean): Promise<Summary> {
    const sum: Summary = { inserted: 0, updated: 0, errors: [...p.errors], newSubs: [], newTeams: [] };
    for (let i = 0; i < p.rows.length; i += CHUNK) {
      const chunk = p.rows.slice(i, i + CHUNK);
      setBusy(`${dry ? 'Menyemak' : 'Mengimport'} baris ${i + 1}-${i + chunk.length} daripada ${p.rows.length}…`);
      const r = await api.post<ApiResult>('/import', { zone_id: zoneId ? Number(zoneId) : undefined, dry_run: dry, rows: chunk.map((c) => c.row) });
      sum.inserted += r.inserted;
      sum.updated += r.updated;
      for (const x of r.results) if (x.action === 'ralat') sum.errors.push({ line: chunk[x.row].line, message: x.message ?? 'Ralat' });
      for (const s of r.new_substations) if (!sum.newSubs.includes(s)) sum.newSubs.push(s);
      for (const t of r.new_teams) if (!sum.newTeams.includes(t)) sum.newTeams.push(t);
    }
    sum.errors.sort((a, b) => a.line - b.line);
    return sum;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setDone(null);
    setParsed(null);
    setFileName(file.name);
    try {
      setBusy('Membaca fail…');
      const raw = await readFile(file);
      if (!raw.length) throw new Error('Fail kosong atau tiada baris data');
      if (raw.length > 20000) throw new Error('Maksimum 20,000 baris setiap fail');
      const p: Parsed = { rows: [], errors: [] };
      raw.forEach((r, i) => {
        const m = mapSavrRow(r);
        // +2: baris 1 ialah tajuk, dan Excel bermula dari 1.
        if (m.row) p.rows.push({ line: i + 2, row: m.row });
        else p.errors.push({ line: i + 2, message: m.error ?? 'Baris tidak sah' });
      });
      setParsed(p);
      if (p.rows.length) setPreview(await send(p, true));
      else setPreview({ inserted: 0, updated: 0, errors: p.errors, newSubs: [], newTeams: [] });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!parsed) return;
    setError(null);
    try {
      const sum = await send(parsed, false);
      setDone(sum);
      setPreview(null);
      await reloadMeta();
      touch();
      toast(`Import siap: ${sum.inserted} baharu, ${sum.updated} dikemas kini`);
    } catch (e) {
      setError(`${errMsg(e)}. Baris yang sudah diimport kekal; import semula fail yang sama adalah selamat.`);
    } finally {
      setBusy(null);
    }
  }

  const sum = done ?? preview;
  return (
    <Modal
      title="Import senarai tiang (CSV / Excel)"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{done ? 'Tutup' : 'Batal'}</Button>
          {preview && !done && <Button icon="upload" loading={!!busy} disabled={preview.inserted + preview.updated === 0} onClick={commit} data-testid="import-commit">Import {fmtNum(preview.inserted + preview.updated)} baris</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Guna format lajur SENARAI TIANG SAVR. Wajib: <b>NAMA PENCAWANG, KOD PENCAWANG, No Tiang RONDAAN, LATITUDE, LONGITUDE</b>. Lajur defect (cth. "TIANG - Condong") diisi nombor 1 jika ada.
          Tiang yang sudah wujud (pencawang + no tiang sama) dikemas kini, bukan diganda.
          <button type="button" onClick={downloadTemplate} className="ml-1 font-semibold text-navy-700 underline">Muat turun templat</button>
        </div>
        {user?.role === 'super_admin' && (
          <Field label="Import ke zon">
            <select className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!!busy}>
              {meta.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Field>
        )}
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-navy-600">
          <Icon name="upload" size={24} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">{fileName || 'Pilih fail .csv atau .xlsx'}</span>
          <input type="file" accept=".csv,.xlsx,text/csv" hidden disabled={!!busy} data-testid="import-file" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {busy && <div className="text-sm text-slate-600">{busy}</div>}
        {sum && (
          <div data-testid="import-summary">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={done ? 'Ditambah' : 'Akan ditambah'} value={sum.inserted} color="text-emerald-600" />
              <Stat label={done ? 'Dikemas kini' : 'Akan dikemas kini'} value={sum.updated} color="text-sky-600" />
              <Stat label="Baris ralat (dilangkau)" value={sum.errors.length} color={sum.errors.length ? 'text-red-600' : 'text-slate-400'} />
            </div>
            {(sum.newSubs.length > 0 || sum.newTeams.length > 0) && !done && (
              <p className="mt-2 text-xs text-slate-600">
                {sum.newSubs.length > 0 && <>Pencawang baharu akan dicipta: <b>{sum.newSubs.join(', ')}</b>. </>}
                {sum.newTeams.length > 0 && <>Team baharu: <b>{sum.newTeams.join(', ')}</b>.</>}
              </p>
            )}
            {sum.errors.length > 0 && (
              <ul className="scroll-thin mt-2 max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {sum.errors.slice(0, 200).map((e, i) => <li key={i}>Baris {e.line}: {e.message}</li>)}
                {sum.errors.length > 200 && <li>…dan {sum.errors.length - 200} lagi</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

const Stat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="rounded-lg border border-slate-200 p-3">
    <div className={`text-2xl font-bold tabular-nums ${color}`}>{fmtNum(value)}</div>
    <div className="text-[11px] text-slate-500">{label}</div>
  </div>
);
