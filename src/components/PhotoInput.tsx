import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../ui';

/** Pemilih gambar: di telefon terus buka kamera belakang; di komputer buka pemilih fail. */
export default function PhotoInput({ files, onChange, label = 'Tambah gambar', max = 6 }: { files: File[]; onChange: (f: File[]) => void; label?: string; max?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
            <img src={u} alt={`Gambar ${i + 1}`} className="h-full w-full object-cover" />
            <button type="button" aria-label="Buang gambar" onClick={() => onChange(files.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-navy-950/80 p-0.5 text-white">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        {files.length < max && (
          <button type="button" onClick={() => ref.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-[10px] font-semibold text-slate-500 hover:border-navy-600 hover:text-navy-700">
            <Icon name="camera" size={20} />
            {label}
          </button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        data-testid="photo-input"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          onChange([...files, ...picked].slice(0, max));
          e.target.value = '';
        }}
      />
    </div>
  );
}
