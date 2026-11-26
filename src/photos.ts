// Gambar dikecilkan di telefon sebelum dimuat naik: jimat data di site dan storan di cloud.
import type { PhotoKind } from '../shared/types';
import { api } from './api';

async function scale(file: File, maxSide: number, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar'))), 'image/jpeg', quality));
}

export interface PhotoTarget { pole_id: number; defect_id?: number | null; stage_event_id?: number | null; kind: PhotoKind }

export async function uploadPhoto(file: File, target: PhotoTarget): Promise<number> {
  const [full, thumb] = await Promise.all([scale(file, 1600, 0.82), scale(file, 360, 0.7)]);
  const form = new FormData();
  form.set('file', full, 'gambar.jpg');
  form.set('thumb', thumb, 'thumb.jpg');
  form.set('pole_id', String(target.pole_id));
  form.set('kind', target.kind);
  if (target.defect_id) form.set('defect_id', String(target.defect_id));
  if (target.stage_event_id) form.set('stage_event_id', String(target.stage_event_id));
  return (await api.upload<{ id: number }>('/photos', form)).id;
}

/** Muat naik beberapa gambar; pulangkan bilangan yang gagal supaya pengguna tahu. */
export async function uploadPhotos(files: File[], target: PhotoTarget): Promise<number> {
  let failed = 0;
  for (const f of files) {
    try {
      await uploadPhoto(f, target);
    } catch {
      failed++;
    }
  }
  return failed;
}

export const photoUrl = (id: number, thumb = false) => `/api/photos/${id}${thumb ? '?thumb=1' : ''}`;
