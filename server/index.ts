import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { initSchema } from './db';
import { logMailStatus } from './mailer';
import { authRouter } from './routes/auth';
import { ticketsRouter } from './routes/tickets';
import { formsRouter, rolesRouter, staffRouter } from './routes/admin';
import { notificationsRouter } from './routes/notifications';
import { importRouter } from './routes/import';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.set('trust proxy', 1);
// Bulk CSV imports can run well past 1mb once paragraph fields and a few
// hundred historical rows are involved.
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/forms', formsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/import', importRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

// Built SPA. `dist/server/index.js` → `dist/client`.
const clientDir = path.resolve(__dirname, '../client');

// Vite fingerprints every file under /assets, so a new build is a new URL and
// these can be cached for a year. Without this they default to max-age=0 and
// the browser revalidates all of them on every single load.
app.use(
  '/assets',
  express.static(path.join(clientDir, 'assets'), {
    immutable: true,
    maxAge: '1y',
  }),
);

// index.html carries the asset hashes, so it must never be cached.
app.use(express.static(clientDir, { etag: true, maxAge: 0 }));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDir, 'index.html'));
});

async function start(): Promise<void> {
  await initSchema();
  logMailStatus();
  app.listen(port, () => {
    console.log(`Growth Ticketing System listening on :${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
