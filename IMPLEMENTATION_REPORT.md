# NearFlux Telegram Integration — Implementation Report

## Executive summary

The existing NearFlux application was inspected first and extended in place. The original React/Vite frontend, Express server, Socket.IO room/signaling system, browser WebRTC transfer service, `/health` and `/healthz` endpoints, direct-path policy, DataChannel transfer behavior, and 10-minute keep-alive were preserved.

The implementation adds an optional server-side Telegram Bot and WebRTC bridge. When `TELEGRAM_BOT_TOKEN` is not set, the integration is disabled and the existing application continues to run without Telegram code paths being activated. When enabled, the bot joins the same ephemeral room system as a named `NearFlux Telegram Bridge` device and uses the same Socket.IO room and signaling events as browser clients.

## Latest Telegram transfer fix

The screenshots exposed a concrete Node WebRTC interoperability bug. The bridge forwarded `event.candidate.toJSON()` from the native `wrtc` package, but native Node ICE candidate objects in this runtime do not implement the browser-only `toJSON()` method. The exception prevented bridge ICE candidates from reaching the browser, leaving both directions stuck at “Establishing a direct WebRTC connection…”.

The bridge now serializes native candidates explicitly (`candidate`, `sdpMid`, `sdpMLineIndex`, and `usernameFragment` when available). It also now performs the same symmetric direct-readiness handshake as the browser before either sending file bytes or accepting them: each side verifies a selected non-relay candidate pair, emits `DIRECT_READY`, waits for the peer's `DIRECT_READY`, and only then proceeds with the transfer. Per-peer readiness state is cleared on close or leave.

A focused native WebRTC smoke test established a data channel with `connectionState: connected`, `iceConnectionState: completed`, and a succeeded nominated candidate pair. The process emitted a native-library segmentation fault during teardown after printing the successful assertion; this did not affect the connection assertion, but the test process should be treated as an external validation helper rather than a production runtime path.

## Existing architecture preserved

| Area | Existing behavior retained |
| --- | --- |
| Rooms | Ephemeral in-memory rooms, creator tracking, join/leave/close, generated `FLUX-XXXX` codes, room-scoped presence, and cleanup when the last device leaves. |
| Invite flow | `?room=FLUX-####` deep links, copyable invite links, QR-code sharing, join-by-code, room regeneration, and close-room controls. |
| Browser transfer | Direct WebRTC DataChannel transfer with transfer approval, SDP, ICE candidates, cancellation, checksum verification, progress, and failure handling. |
| Network policy | STUN-only direct-path verification with no TURN relay fallback. |
| Chunking | Existing conservative DataChannel chunking and queue behavior remain untouched. |
| Hosting | One Render Node service, the current static-client serving path, `/health`, `/healthz`, and the 10-minute self-ping remain in place. |

## Telegram implementation

`server/src/telegram/telegramBridge.ts` contains the Telegram Bot API client, webhook handler, commands, inline keyboards, per-chat room sessions, Node WebRTC peer, compatible file-protocol handling, checksum verification, and Telegram photo/document delivery. The bridge connects to the local NearFlux Socket.IO endpoint using `socket.io-client`, so it reuses the existing room registry and signaling authorization instead of introducing a second room database or signaling server.

The bot supports `/start`, `/newroom`, `/join FLUX-XXXX`, `/status`, and `/leave`. `/newroom` generates a compatible room and joins it through the existing `join-room` event. `/join` joins an existing browser-created room. `/status` reports bridge and web-peer presence. `/leave` emits the existing `leave-room` event, closes bridge WebRTC peers, and clears temporary in-memory transfer state.

Telegram-originated files are downloaded temporarily, held in memory only for the active transfer, and sent through a compatible WebRTC data channel to the first connected web peer in the same room. The browser sees a normal NearFlux transfer request and must accept it. Browser-originated files targeted at the Telegram Bridge now produce an explicit Telegram Accept/Decline prompt; the bridge sends the Socket.IO acceptance only after the Telegram user accepts. The bridge receives the existing `FILE_START` / `FILE_CHUNK` / `FILE_END` protocol, acknowledges each chunk, checksum-verifies the complete file, and sends it back to the Telegram chat using `sendPhoto` for images or `sendDocument` for other files.

## Mini App behavior

No second frontend was created. The bot's `Open Mini App` button points to `TELEGRAM_WEBAPP_URL`, with the active room encoded as `?room=FLUX-XXXX`. The current `useSocket` hook already parses that parameter, auto-joins on connection, and keeps the canonical room URL synchronized. Therefore Chrome, Firefox, mobile browsers, the Telegram WebView, and the server-side bridge can participate in the same room.

## Files changed and added

| File | Change |
| --- | --- |
| `server/src/telegram/telegramBridge.ts` | Added Telegram Bot API client, webhook, commands, inline keyboards, room sessions, Node WebRTC peer, transfer protocol, checksum verification, and Telegram delivery. |
| `server/src/index.ts` | Added JSON webhook parsing and bridge registration while preserving existing HTTP, Socket.IO, health, and keep-alive setup. |
| `server/package.json` and `server/package-lock.json` | Added `socket.io-client`, `wrtc`, and the native dependency helper required by `wrtc`. |
| `server/src/types/wrtc.d.ts` | Added a local TypeScript declaration for `wrtc`. |
| `render.yaml` | Added Telegram environment variables and a default 20 MiB bridge limit. |
| `.node-version` and root `package.json` | Pinned Render to Node 20 for native WebRTC runtime compatibility. |
| `.env.example` | Added a credential-free configuration template. |
| `TELEGRAM_SETUP.md` | Added BotFather, Render, webhook, testing, architecture, and limitation documentation. |
| `README.md` | Added a link to the Telegram documentation. |
| `research/socket-room-smoke.mjs` | Added a two-client room/presence smoke test. |
| `research/wrtc-handshake-smoke.mjs` | Added a focused native Node WebRTC candidate-pair smoke test. |
| `research/telegram-approval-smoke.mjs` | Added a focused Accept callback smoke test using a mocked Telegram API. |
| `research/telegram-integration-baseline.md` | Recorded the inspected architecture and API findings. |

## Configuration required

Set these in Render as service environment variables:

| Variable | Required | Value |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes to enable Telegram | The secret token issued by BotFather. |
| `TELEGRAM_WEBAPP_URL` | Recommended | `https://nearflux-p2p-share.onrender.com/`. |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | A random secret for webhook verification. |
| `TELEGRAM_MAX_FILE_BYTES` | Optional | Defaults to `20971520` bytes (20 MiB). |
| `RENDER_EXTERNAL_URL` | Existing | `https://nearflux-p2p-share.onrender.com`. |

The bot token is never exposed through frontend variables and is not present in the repository. When a token is configured, startup registers commands and attempts to register the HTTPS webhook at `/telegram/webhook`.

## BotFather and Render steps

Create or select the bot in [@BotFather](https://t.me/BotFather), copy its token into Render as `TELEGRAM_BOT_TOKEN`, configure the Mini App/menu button to use `TELEGRAM_WEBAPP_URL`, and keep that URL on HTTPS. Render should deploy the `main` branch using the checked-in `render.yaml`. After the token and webhook secret are added, restart or redeploy the service and verify the server logs contain `[telegram] bot configured` without any token or file contents.

Telegram's official Bot API supports HTTPS webhooks and file send/download methods, and its official Mini App documentation supports launching a JavaScript web app inside Telegram.[1] [2]

## Verification performed

The server TypeScript build passed. The existing client TypeScript and Vite production build passed. A local compiled-server smoke test returned successful JSON responses from both `/health` and `/healthz` and served the built frontend. A two-client Socket.IO smoke test joined two clients to `FLUX-ABCD` and confirmed room state and `device-joined` presence behavior. A focused Telegram approval smoke test confirmed that an inline Accept callback resolves the waiting transfer decision.

The changes were committed and pushed to `vishwakarma47/nearflux-p2p-share` on `main`:

| Commit | Description |
| --- | --- |
| `40af3cc` | Add Telegram bot WebRTC bridge and Mini App setup. |
| `3bd3fdc` | Pin Render runtime for WebRTC bridge. |

Render accepted the first commit and began an auto-deploy. The public service still reported the previous commit while the build was in progress. The subsequent Node 20 pin was pushed to reduce the risk of the native `wrtc` package being built under Render's default Node 24 runtime. Telegram end-to-end testing remains blocked until a real BotFather token is configured in Render.

## Exact test procedure after token setup

First verify browser-to-browser transfer with two ordinary browsers. Then send `/start` to the bot, run `/newroom`, open the Mini App button, and confirm the existing app opens with the room query parameter. Join the same room from a normal browser and check `/status`. Send a small document or photo to the bot, accept the NearFlux transfer request in the browser, and verify that it arrives through the existing transfer UI. Next, select `NearFlux Telegram Bridge` as the browser transfer target and verify that Telegram receives a photo preview or document. Repeat near the configured size limit, test an oversized file error, exercise `/join`, `/status`, `/leave`, browser disconnect/reconnect, and room expiration, and confirm both health endpoints remain successful.

## Limitations

The bridge defaults to 20 MiB because Telegram Bot API file download and upload limits apply; method-specific limits may vary.[1] The bridge currently chooses the first connected web peer for Telegram-originated transfers. The existing no-TURN direct-path policy remains in effect, so WebRTC connectivity has the same NAT and firewall constraints as browser-to-browser transfers. Render's free service may cold-start, which can delay webhook processing. No claim is made that Telegram end-to-end transfer has been tested until a real bot token and connected Telegram chat are available.

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
[2]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"


## Candidate-verification timing fix

The latest production screenshot showed the approval flow working but the data channel closing with `Candidate: unknown` before direct verification. The remaining defect was a timing race in candidate-pair statistics combined with the Node bridge closing peers immediately on a transient ICE `failed` state. The browser already has bounded ICE-restart recovery, so the bridge now keeps the peer alive until a true close and waits through transient candidate-stat availability. Both browser and bridge treat a connected STUN-only channel with temporarily missing candidate mapping as direct, while still rejecting an explicitly reported relay candidate.

After this correction, the full server/client production build passed, the Telegram approval callback smoke test passed, `/health` passed, and the two-client Socket.IO room smoke test passed against a local compiled server.
