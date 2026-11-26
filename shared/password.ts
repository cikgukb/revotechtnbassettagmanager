// Hash kata laluan PBKDF2-SHA256 melalui WebCrypto (berfungsi dalam Workers, Node 22 dan pelayar).
// Format simpanan: pbkdf2$sha256$<iterasi>$<garam b64>$<hash b64>
// Workers mengehadkan PBKDF2 kepada 100,000 iterasi, jadi jangan naikkan nilai ini.

export const PBKDF2_ITERATIONS = 100_000;
const MAX_ITERATIONS = 100_000;

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = unb64(parts[3]);
    expected = unb64(parts[4]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Hash olok-olok supaya login pengguna yang tidak wujud ambil masa yang sama. */
export const DUMMY_HASH = `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64(new Uint8Array(16))}$${b64(new Uint8Array(32))}`;

/** Pulangkan mesej ralat jika kata laluan terlalu lemah, atau null jika lulus. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Kata laluan mesti sekurang-kurangnya 10 aksara';
  if (password.length > 128) return 'Kata laluan terlalu panjang';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Kata laluan mesti ada huruf dan nombor';
  return null;
}

export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Kod tag aset (untuk QR): RV- diikuti 8 aksara tanpa huruf yang mengelirukan. */
export function newTagCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  let out = 'RV-';
  for (const r of rnd) out += alphabet[r % alphabet.length];
  return out;
}
