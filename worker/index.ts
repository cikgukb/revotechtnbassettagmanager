import { Hono } from 'hono';
import { type AppEnv, HttpError, now, originGuard, requireAuth } from './lib';
import admin from './routes/admin';
import auth from './routes/auth';
import data from './routes/data';
import defects from './routes/defects';
import photos from './routes/photos';
import poles from './routes/poles';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'server_error', message: 'Ralat pelayan. Cuba lagi sebentar' }, 500);
});

// Respons API tidak boleh dicache oleh pelayar/proksi (kecuali gambar, yang tetapkan sendiri).
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  c.res.headers.set('x-content-type-options', 'nosniff');
});
app.use('/api/*', originGuard);

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ ok: true, ready: (row?.n ?? 0) > 0, time: now() });
});

app.route('/api/auth', auth);

// Semua laluan di bawah ini memerlukan sesi yang sah.
app.use('/api/*', requireAuth);
app.route('/api/poles', poles);
app.route('/api/defects', defects);
app.route('/api/photos', photos);
app.route('/api/admin', admin);
app.route('/api', data);

app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'Laluan tidak dijumpai' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
