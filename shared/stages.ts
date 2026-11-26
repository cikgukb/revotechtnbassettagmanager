import type { DefectStatus, PoleStatus, Stage } from './types';

/** Peralihan status defect yang dibenarkan. Apa-apa selain ini ditolak (409). */
export const DEFECT_ACTIONS = {
  start: { from: 'belum', to: 'sedang', stage: 'SEDANG' },
  complete: { from: 'sedang', to: 'selesai', stage: 'SELESAI' },
  verify: { from: 'selesai', to: 'disahkan', stage: 'DISAHKAN' },
  reject: { from: 'selesai', to: 'sedang', stage: 'DITOLAK' },
} as const satisfies Record<string, { from: DefectStatus; to: DefectStatus; stage: Stage }>;
export type DefectAction = keyof typeof DEFECT_ACTIONS;

export function nextDefectStatus(current: DefectStatus, action: DefectAction): DefectStatus | null {
  const t = DEFECT_ACTIONS[action];
  return t.from === current ? t.to : null;
}

/** Status tiang dikira dari defect: yang paling teruk menang. */
export function poleStatusFrom(defectStatuses: DefectStatus[], hasRondaan: boolean): PoleStatus {
  if (defectStatuses.includes('belum')) return 'defect';
  if (defectStatuses.includes('sedang')) return 'sedang';
  if (defectStatuses.includes('selesai')) return 'selesai';
  return hasRondaan ? 'ok' : 'baru';
}

/**
 * Langkah semasa pada stepper profil (1..6).
 * 1 Daftar, 2 Rondaan, 3 Defect dilapor, 4 Sedang disenggara, 5 Selesai, 6 Disahkan.
 */
export function poleStep(p: { status: PoleStatus; total_defects: number; last_rondaan_at: string | null }): number {
  switch (p.status) {
    case 'defect':
      return 3;
    case 'sedang':
      return 4;
    case 'selesai':
      return 5;
    case 'ok':
      return p.total_defects > 0 ? 6 : 2;
    default:
      return p.last_rondaan_at ? 2 : 1;
  }
}

/**
 * SQL yang mengira semula cache status tiang; dijalankan dalam batch yang sama dengan perubahan defect
 * supaya status tak boleh "lari" dari data defect. ?1 = cap masa; `where` guna ?2 (cth. 'id = ?2').
 */
export const recomputePoleSql = (where: string) => `
UPDATE poles SET
  open_defects = (SELECT COUNT(*) FROM defects d WHERE d.pole_id = poles.id AND d.status != 'disahkan'),
  total_defects = (SELECT COUNT(*) FROM defects d WHERE d.pole_id = poles.id),
  status = CASE
    WHEN EXISTS (SELECT 1 FROM defects d WHERE d.pole_id = poles.id AND d.status = 'belum') THEN 'defect'
    WHEN EXISTS (SELECT 1 FROM defects d WHERE d.pole_id = poles.id AND d.status = 'sedang') THEN 'sedang'
    WHEN EXISTS (SELECT 1 FROM defects d WHERE d.pole_id = poles.id AND d.status = 'selesai') THEN 'selesai'
    WHEN last_rondaan_at IS NOT NULL THEN 'ok'
    ELSE 'baru' END,
  updated_at = ?1
WHERE ${where}`;
