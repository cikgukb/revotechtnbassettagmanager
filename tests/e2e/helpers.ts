import { type APIRequestContext, type Page, expect } from '@playwright/test';

export const BASE = 'http://localhost:8788';
export const PASSWORD = 'Revotech#2026';

type PW = { request: { newContext(o: object): Promise<APIRequestContext> } };

/** Konteks API tanpa sesi (dengan Origin yang sah, seperti pelayar). */
export const anon = (playwright: PW) => playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });

/** Konteks API yang sudah log masuk sebagai `username`. */
export async function apiAs(playwright: PW, username: string, password = PASSWORD): Promise<APIRequestContext> {
  const ctx = await anon(playwright);
  const res = await ctx.post('/api/auth/login', { data: { username, password } });
  expect(res.status(), `login ${username}`).toBe(200);
  return ctx;
}

/** Sekat hos tile luar supaya ujian tidak bergantung pada internet; lapisan tiang datang dari API sendiri. */
export async function stubTiles(page: Page) {
  await page.route(/openfreemap\.org|arcgisonline\.com/, (route) => route.abort());
}

export async function uiLogin(page: Page, username: string, password = PASSWORD) {
  await page.goto('/');
  await page.fill('input[autocomplete=username]', username);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
}

export async function waitForMap(page: Page, min = 1) {
  await page.waitForSelector('[data-testid=map] canvas');
  await page.waitForFunction((n) => (window as any).__poleMap?.visibleCount >= n, min, { timeout: 30_000 });
}

// JPEG dan PNG 1x1 piksel.
export const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
