// Jenis & pemalar yang dikongsi antara Worker (API) dan SPA.

export const ROLES = ['super_admin', 'admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};
export const ROLE_DESC: Record<Role, string> = {
  super_admin: 'Kawal pengguna, role, zon dan semua data',
  admin: 'Urus data zon sendiri, agih tugasan dan sahkan siap',
  operator: 'Kerja di site: daftar tiang, rondaan, senggaraan',
  viewer: 'Lihat sahaja: peta, dashboard, profil dan laporan',
};

// Status tiang (cache, dikira dari defect). Susunan = indeks dalam payload peta.
export const POLE_STATUS = ['baru', 'ok', 'defect', 'sedang', 'selesai'] as const;
export type PoleStatus = (typeof POLE_STATUS)[number];
export const POLE_STATUS_LABEL: Record<PoleStatus, string> = {
  baru: 'Belum dironda',
  ok: 'Baik',
  defect: 'Belum disenggara',
  sedang: 'Sedang disenggara',
  selesai: 'Selesai, tunggu pengesahan',
};
export const POLE_STATUS_COLOR: Record<PoleStatus, string> = {
  baru: '#94a3b8',
  ok: '#22c55e',
  defect: '#ef4444',
  sedang: '#f59e0b',
  selesai: '#3b82f6',
};
export const PROBLEM_STATUSES: PoleStatus[] = ['defect', 'sedang', 'selesai'];

export const DEFECT_STATUS = ['belum', 'sedang', 'selesai', 'disahkan'] as const;
export type DefectStatus = (typeof DEFECT_STATUS)[number];
export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = {
  belum: 'Belum disenggara',
  sedang: 'Sedang disenggara',
  selesai: 'Senggaraan selesai',
  disahkan: 'Disahkan',
};
export const DEFECT_STATUS_COLOR: Record<DefectStatus, string> = {
  belum: '#ef4444',
  sedang: '#f59e0b',
  selesai: '#3b82f6',
  disahkan: '#22c55e',
};

export const TASK_TYPES = ['T1', 'T2', 'RENTIS', 'CAT'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  T1: 'Senggaraan T1',
  T2: 'Senggaraan T2',
  RENTIS: 'Rentis',
  CAT: 'Cat Tiang',
};

export const DEFECT_CATEGORIES = [
  'TIANG_REPUT',
  'TIANG_CONDONG',
  'TIANG_NOMBOR',
  'PENGALIR_MIDSPAN',
  'PENGALIR_KAWASAN',
  'IKLAN_HARAM',
  'LAIN',
] as const;
export type DefectCategory = (typeof DEFECT_CATEGORIES)[number];
export const DEFECT_CATEGORY_INFO: Record<DefectCategory, { label: string; task: TaskType }> = {
  TIANG_REPUT: { label: 'Tiang: Reput/Retak', task: 'T1' },
  TIANG_CONDONG: { label: 'Tiang: Condong', task: 'T1' },
  TIANG_NOMBOR: { label: 'Tiang: Nombor Pudar', task: 'CAT' },
  PENGALIR_MIDSPAN: { label: 'Pengalir: Mid-Span', task: 'T2' },
  PENGALIR_KAWASAN: { label: 'Pengalir: Kawasan (pokok/semak)', task: 'RENTIS' },
  IKLAN_HARAM: { label: 'Iklan Haram', task: 'T2' },
  LAIN: { label: 'Lain-lain', task: 'T2' },
};

export const SEVERITIES = ['rendah', 'sederhana', 'tinggi'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { rendah: 'Rendah', sederhana: 'Sederhana', tinggi: 'Tinggi' };

// Peristiwa dalam log kitar hayat.
export const STAGES = ['DAFTAR', 'RONDAAN', 'DEFECT', 'AGIH', 'SEDANG', 'SELESAI', 'DISAHKAN', 'DITOLAK', 'KEMASKINI'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  DAFTAR: 'Tiang didaftar & ditag',
  RONDAAN: 'Rondaan dibuat',
  DEFECT: 'Defect dilapor',
  AGIH: 'Tugasan diagih',
  SEDANG: 'Senggaraan dimulakan',
  SELESAI: 'Senggaraan selesai',
  DISAHKAN: 'Disahkan admin',
  DITOLAK: 'Ditolak, perlu dibaiki semula',
  KEMASKINI: 'Maklumat dikemas kini',
};

// Enam langkah utama pada "stepper" profil tiang.
export const STEPS = ['Daftar / Tag', 'Rondaan', 'Defect dilapor', 'Sedang disenggara', 'Selesai', 'Disahkan'] as const;

export const PHOTO_KINDS = ['profil', 'rondaan', 'sebelum', 'selepas'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  profil: 'Profil',
  rondaan: 'Rondaan',
  sebelum: 'Sebelum',
  selepas: 'Selepas',
};

export const POLE_TYPES = ['LV', 'LV + Lampu Jalan', 'Servis', '11kV', 'Stay'] as const;
export const POLE_MATERIALS = ['Konkrit', 'Spun', 'Kayu', 'Besi'] as const;

// ---- Kebenaran (digunakan oleh UI untuk sorok butang dan oleh API untuk kuat kuasa) ----
export const PERMS = {
  'pole.create': ['super_admin', 'admin', 'operator'],
  'pole.edit': ['super_admin', 'admin'],
  'pole.delete': ['super_admin', 'admin'],
  'rondaan.create': ['super_admin', 'admin', 'operator'],
  'defect.assign': ['super_admin', 'admin'],
  'defect.work': ['super_admin', 'admin', 'operator'],
  'defect.verify': ['super_admin', 'admin'],
  'photo.upload': ['super_admin', 'admin', 'operator'],
  'photo.delete': ['super_admin', 'admin'],
  'data.import': ['super_admin', 'admin'],
  'data.export': ['super_admin', 'admin', 'viewer'],
  'master.manage': ['super_admin', 'admin'],
  'user.manage': ['super_admin'],
  'audit.view': ['super_admin'],
  'sample.manage': ['super_admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;
export const can = (role: Role | undefined | null, perm: Perm): boolean =>
  !!role && (PERMS[perm] as readonly Role[]).includes(role);

// ---- Bentuk data API ----
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  zone_id: number | null;
  team_id: number | null;
  must_change_password: boolean;
}

export interface Zone { id: number; name: string }
export interface Team { id: number; zone_id: number; name: string }
export interface Substation {
  id: number; zone_id: number; name: string; code: string;
  functional_location: string | null; lat: number | null; lng: number | null;
}
export interface Meta { zones: Zone[]; teams: Team[]; substations: Substation[] }

/** Baris padat untuk peta: [id, lat, lng, indeks status, no tiang, id pencawang, id tiang sebelum, id team] */
export type GeoRow = [number, number, number, number, string, number, number | null, number | null];

export interface PoleRow {
  id: number; tag_code: string; zone_id: number; substation_id: number; team_id: number | null;
  no_tiang_rondaan: string; no_tiang_lama: string | null; street: string | null;
  pole_type: string | null; material: string | null; height_m: number | null; install_year: number | null;
  lat: number; lng: number; prev_pole_id: number | null; status: PoleStatus;
  open_defects: number; total_defects: number; last_rondaan_at: string | null; photo_id: number | null;
  notes: string | null; created_by_name: string | null; created_at: string; updated_at: string;
  substation_name: string; substation_code: string; functional_location: string | null;
  zone_name: string; team_name: string | null;
}

export interface DefectRow {
  id: number; pole_id: number; zone_id: number; category: DefectCategory; task_type: TaskType;
  severity: Severity; description: string | null; status: DefectStatus;
  assigned_team_id: number | null; team_name: string | null;
  reported_by_name: string | null; reported_at: string;
  started_at: string | null; completed_by: number | null; completed_by_name: string | null; completed_at: string | null;
  verified_by_name: string | null; verified_at: string | null;
  // medan gabungan untuk papan tugasan
  no_tiang_rondaan?: string; street?: string | null; substation_name?: string; pole_team_id?: number | null;
}

export interface StageEvent {
  id: number; pole_id: number; defect_id: number | null; stage: Stage;
  actor_name: string | null; note: string | null; at: string;
  no_tiang_rondaan?: string;
}

export interface PhotoRow {
  id: number; pole_id: number; defect_id: number | null; stage_event_id: number | null;
  kind: PhotoKind; uploaded_by_name: string | null; created_at: string;
}

export interface PoleProfile {
  pole: PoleRow;
  defects: DefectRow[];
  events: StageEvent[];
  photos: PhotoRow[];
}

export interface UserRow {
  id: number; username: string; name: string; role: Role;
  zone_id: number | null; team_id: number | null; zone_name: string | null; team_name: string | null;
  active: number; must_change_password: number; created_at: string; last_login_at: string | null;
}

export interface Stats {
  poles: Record<PoleStatus, number>;
  total_poles: number;
  tasks: { task_type: TaskType; status: DefectStatus; n: number }[];
  categories: { category: DefectCategory; n: number; open: number }[];
  teams: { team_id: number | null; team_name: string; poles: number; dironda: number; open_defects: number; closed_defects: number }[];
  substations: { id: number; name: string; code: string; poles: number; problem: number; dironda: number }[];
  daily: { day: string; rondaan: number; siap: number }[];
  recent: StageEvent[];
}
