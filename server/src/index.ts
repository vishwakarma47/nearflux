import express, { Request, Response } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { deviceManager } from './services/deviceManager.js';
import { setupSocketHandlers } from './socket/socketHandler.js';
import { ClientToServerEvents, ServerToClientEvents } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
const clientDistPath = path.join(process.cwd(), 'client/dist');
const frontendOrigin = process.env.CLIENT_ORIGIN || process.env.FRONTEND_ORIGIN || '*';
const app = express();
const startTime = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(clientDistPath));

app.get(['/health', '/healthz'], (_request: Request, response: Response) => {
  response.json({
    status: 'ok',
    service: 'nearflux-signaling',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    connectedDevices: deviceManager.getCount(),
    fileDataRelay: false,
    timestamp: new Date().toISOString(),
  });
});

app.get('*', (_request: Request, response: Response) => {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexPath)) return response.sendFile(indexPath);
  response.status(200).send('NearFlux signaling server is online. Build the client to serve the web application.');
});

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: frontendOrigin, methods: ['GET', 'POST'] },
});

setupSocketHandlers(io);
if (process.env.TELEGRAM_BRIDGE_MODE === 'remote') {
  console.log('[telegram] remote bridge mode enabled; Telegram Bot/WebRTC runs on the standalone bridge host.');
} else {
  void import('./telegram/telegramBridge.js')
    .then(({ createTelegramBridge }) => createTelegramBridge(app, PORT))
    .catch((error: unknown) => console.warn(`[telegram] legacy bridge failed to load: ${error instanceof Error ? error.message : String(error)}`));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NearFlux signaling server listening on port ${PORT}`);
  console.log('Server responsibility: ephemeral rooms, presence, and WebRTC signaling only.');
  console.log('File relay: disabled. TURN: not configured.');

  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.CLIENT_ORIGIN;
  if (selfUrl) {
    const selfPing = () => {
      fetch(`${selfUrl.replace(/\/$/, '')}/health`)
        .then((response) => response.json() as Promise<{ status?: string }>)
        .then((payload) => console.log(`[keepalive] ${payload.status || 'ok'}`))
        .catch((error: Error) => console.warn(`[keepalive] failed: ${error.message}`));
    };
    setTimeout(selfPing, 30_000);
    setInterval(selfPing, 10 * 60 * 1000);
    console.log('[keepalive] self-ping scheduled every 10 minutes.');
  }
});
