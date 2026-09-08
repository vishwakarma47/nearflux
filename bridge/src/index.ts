import express from 'express';
import { createTelegramBridge } from './bridge.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '8080', 10);
const startedAt = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'nearflux-telegram-bridge',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    bridgeMode: 'standalone',
    signalingUrlConfigured: Boolean(process.env.BRIDGE_SOCKET_URL || process.env.NEARFLUX_SIGNALING_URL),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    publicUrlConfigured: Boolean(process.env.BRIDGE_PUBLIC_URL || process.env.TELEGRAM_WEBHOOK_URL),
    timestamp: new Date().toISOString(),
  });
});

const manager = createTelegramBridge(app, port);
if (!manager) {
  console.warn('[bridge] Telegram bridge disabled: configure TELEGRAM_BOT_TOKEN and TELEGRAM_WEBAPP_URL.');
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[bridge] listening on 0.0.0.0:${port}`);
  console.log('[bridge] browser-to-browser transfers remain on the Render NearFlux service.');
  console.log('[bridge] native WebRTC requires a future host with public UDP reachability.');
});
