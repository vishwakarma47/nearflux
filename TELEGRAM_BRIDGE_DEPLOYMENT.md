# NearFlux Telegram Bridge Deployment

## Architecture

NearFlux remains a Node.js/Express + React/Vite application. The Render web service continues to own the web application, temporary rooms, presence, Socket.IO signaling, health endpoints, and browser-to-browser WebRTC. The standalone bridge in `bridge/` owns Telegram Bot API updates and acts as the native Node WebRTC peer for Telegram transfers.

```text
Telegram user
     │ Telegram Bot API
     ▼
Public UDP-capable Telegram bridge host
     │ authenticated Socket.IO signaling
     ▼
Render NearFlux service
     │ existing WebRTC signaling and room state
     ▼
Browser / Mini App
```

The browser-to-browser WebRTC implementation is not replaced with a relay. The bridge is intentionally a separate service because the native WebRTC peer needs a host with public UDP reachability; Render's web-service ingress is designed around a single public HTTP port.

## Repository layout

| Path | Responsibility |
|---|---|
| `server/` | Render-hosted rooms, signaling, health, and existing application server |
| `client/` | Existing browser application and browser-to-browser WebRTC |
| `bridge/` | Independently deployable Telegram Bot API and native WebRTC peer |
| `bridge/Dockerfile` | Container build for the future bridge host |
| `bridge/.env.example` | Placeholder-only bridge configuration |

## Render configuration

Set the following variables on the existing Render web service:

```text
TELEGRAM_BRIDGE_MODE=remote
BRIDGE_SHARED_SECRET=<long-random-secret>
TELEGRAM_WEBAPP_URL=https://nearflux-p2p-share.onrender.com/
RENDER_EXTERNAL_URL=https://nearflux-p2p-share.onrender.com
```

`BRIDGE_SHARED_SECRET` must be identical on Render and the bridge host. The Render service uses it to authenticate a bridge Socket.IO connection when the bridge sends it as `auth.bridgeSecret`. Normal browser clients do not need this value.

The legacy `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` variables should not be used by the Render service when `TELEGRAM_BRIDGE_MODE=remote`; put those secrets on the bridge host instead.

## Bridge-host configuration

Copy `bridge/.env.example` to a private `.env` on the future host and fill in:

```text
NODE_ENV=production
PORT=8080
BRIDGE_PUBLIC_URL=https://bridge.example.com
TELEGRAM_WEBHOOK_URL=https://bridge.example.com/telegram/webhook
BRIDGE_SOCKET_URL=https://nearflux-p2p-share.onrender.com
BRIDGE_SHARED_SECRET=<same-value-as-Render>
TELEGRAM_BOT_TOKEN=<BotFather-token>
TELEGRAM_WEBHOOK_SECRET=<random-webhook-secret>
TELEGRAM_WEBAPP_URL=https://nearflux-p2p-share.onrender.com/
TELEGRAM_MAX_FILE_BYTES=20971520
WEBRTC_ICE_SERVERS=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478
WEBRTC_UDP_MIN_PORT=40000
WEBRTC_UDP_MAX_PORT=49999
```

The current bridge uses the STUN servers configured in its source. The `WEBRTC_ICE_SERVERS` and UDP range variables document the intended future host configuration; the runtime should be extended to consume them when the host is selected. The provider and host firewall must allow the native WebRTC UDP range. A TURN service can be added later only if direct public-host connectivity is insufficient.

## Build and run without credentials

From the repository root:

```bash
cd bridge
npm install
npm run build
TELEGRAM_WEBAPP_URL=https://nearflux-p2p-share.onrender.com/ \
BRIDGE_SOCKET_URL=https://nearflux-p2p-share.onrender.com \
PORT=8080 \
npm start
```

Without `TELEGRAM_BOT_TOKEN`, the process starts its HTTP health endpoint but leaves Telegram integration disabled. This is intentional and allows builds and container health checks without secrets.

For a container build, run from the repository root:

```bash
docker build -f bridge/Dockerfile -t nearflux-telegram-bridge .
docker run --env-file bridge/.env -p 8080:8080 nearflux-telegram-bridge
```

The bridge health endpoint is:

```text
GET /health
```

It reports whether the signaling URL, Telegram credentials, and public webhook URL are configured. It does not claim that a WebRTC peer is connected merely because the process is alive.

## Telegram webhook

The bridge calls Telegram `setWebhook` during startup when `BRIDGE_PUBLIC_URL` or `TELEGRAM_WEBHOOK_URL` is configured. The resulting endpoint is:

```text
https://bridge.example.com/telegram/webhook
```

Telegram must send the configured `TELEGRAM_WEBHOOK_SECRET` in the `X-Telegram-Bot-Api-Secret-Token` header. The bridge rejects a request with a missing or incorrect secret.

If the provider does not support HTTPS directly, place the bridge behind a TLS reverse proxy such as Caddy or Nginx and set `BRIDGE_PUBLIC_URL` to the HTTPS hostname. Keep the native WebRTC UDP ports open separately from the HTTPS proxy port.

## Manual testing after a host is available

First check:

```bash
curl -fsS https://bridge.example.com/health
curl -fsS https://nearflux-p2p-share.onrender.com/health
```

Then test the following separately:

1. Browser A to Browser B: confirm the existing direct P2P flow still works.
2. Telegram `/newroom`: confirm the bridge joins the generated room.
3. Telegram `/join FLUX-XXXX`: confirm the bridge joins an existing room.
4. Telegram `/status`: confirm bot, bridge, and web-peer states are reported independently.
5. Telegram `/leave`: confirm the bridge leaves the room and the web peer observes the device leaving.
6. Mini App room deep link: open the bot's web-app button and confirm the existing client joins the room parameter.
7. Telegram to Browser: send a small document or image, accept it in NearFlux, and verify actual byte progress and a downloaded file.
8. Browser to Telegram: select the bridge, send a small file, accept it in Telegram, and verify that Telegram receives the actual file.
9. Bridge reconnect: restart the bridge process and verify it reconnects to Socket.IO without leaving a stale room participant.
10. Error cases: invalid room, no web peer, bridge offline, failed WebRTC, file cancellation, and oversized file.

Do not mark Telegram file transfer as working until an actual file has travelled successfully in both directions on the future host.

## Known limitation of this preparation

The standalone package, authenticated signaling boundary, Dockerfile, environment templates, remote Render mode, and deployment instructions are prepared in the repository. End-to-end Telegram file transfer cannot be verified in the current sandbox or by the Render web service alone because no public UDP-capable bridge host and no real Telegram credentials have been supplied. The browser-to-browser path remains on Render and is not changed into a server relay.
