import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { initSchema } from './db';
import { authRouter } from './routes/auth';
import { ticketsRouter } from './routes/tickets';
import { formsRouter, rolesRouter, staffRouter } from './routes/admin';
import { eventsRouter } from './routes/events';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/forms', formsRouter);
app.use('/api/events', eventsRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

// Built SPA. `dist/server/index.js` → `dist/client`.
const clientDir = path.resolve(__dirname, '../client');
app.use(express.static(clientDir));
app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));

async function start(): Promise<void> {
  await initSchema();
  app.listen(port, () => {
    console.log(`Growth Ticketing System listening on :${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
