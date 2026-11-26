const dt = new Intl.DateTimeFormat('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' });
const d = new Intl.DateTimeFormat('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '-');
export const fmtDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : '-');

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '-';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'baru sahaja';
  if (s < 3600) return `${Math.floor(s / 60)} minit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} hari lalu`;
  return fmtDate(iso);
}

export const fmtNum = (n: number) => new Intl.NumberFormat('ms-MY').format(n);
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
