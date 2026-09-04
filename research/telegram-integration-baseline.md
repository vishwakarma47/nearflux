# Telegram Integration Baseline

## Existing NearFlux architecture

- Root project is a TypeScript monorepo with a Vite React client and an Express + Socket.IO server.
- `server/src/index.ts` serves `client/dist`, exposes `/health` and `/healthz`, creates the HTTP server and Socket.IO instance, and preserves a 10-minute self-ping using `RENDER_EXTERNAL_URL` or `CLIENT_ORIGIN`.
- `server/src/services/deviceManager.ts` owns ephemeral in-memory rooms, device membership, room-code normalization, room creation compatibility, and cleanup.
- `server/src/socket/socketHandler.ts` owns room join/leave/close, presence, transfer request/response, WebRTC offer/answer/ICE signaling, and transfer cancellation. It authorizes peer-directed events against the same in-memory room.
- `client/src/hooks/useSocket.ts` already supports `?room=FLUX-XXXX` deep links, auto-joins on Socket.IO connection, and preserves the room URL behavior needed by a Telegram Mini App.
- `shared/types/socket.ts` currently contains only room/presence, transfer approval, WebRTC signaling, and cancellation events; it has no bridge/file relay protocol.
- `client/src/services/webrtc.ts` is browser-oriented and transfers files directly over an RTCDataChannel using FILE_START / FILE_CHUNK / FILE_END messages, ACKs, checksum verification, and a conservative approximately 60 KiB chunk size. It relies on browser WebRTC APIs and DOM download behavior on receive.
- `render.yaml` deploys one Node web service named `nearflux`, builds server and client, starts `node server/dist/server/src/index.js`, health-checks `/health`, and defines `CLIENT_ORIGIN` and `RENDER_EXTERNAL_URL`.

## Architecture implication

The Telegram Mini App can reuse the existing deployed frontend directly at `https://nearflux-p2p-share.onrender.com/?room=FLUX-XXXX`; no second frontend or room system is needed. The bot must remain server-side. A Telegram bridge cannot simply be a normal Socket.IO client because the existing file protocol terminates in browser-only WebRTC APIs and DOM behavior. The implementation therefore needs a clean server-side bridge integration that either runs a compatible Node WebRTC peer or adds an explicit, authenticated bridge transport around the existing signaling and file protocol without weakening browser-to-browser P2P behavior.

## Telegram API verification

Official Telegram documentation confirms that the Bot API supports HTTPS webhooks through `setWebhook`, file receipt/download through the Bot API file methods, and outbound `sendPhoto`/`sendDocument` methods. Official Mini App documentation confirms that a JavaScript web app can be launched inside Telegram and that Mini Apps are configured through BotFather. The implementation must account for Telegram Bot API file-size and download/upload limits, validate webhook requests, and keep `TELEGRAM_BOT_TOKEN` server-only.

## Non-negotiable preservation requirements

Do not rewrite the app, create a second signaling server, duplicate room management, increase the existing chunk size, remove `/health` or `/healthz`, or remove the 10-minute keep-alive. Test browser-to-browser transfer and all Telegram flows separately after implementation.
