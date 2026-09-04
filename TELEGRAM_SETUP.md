# NearFlux Telegram Integration

The Telegram integration is an extension of the existing NearFlux application. It does not create a second frontend, signaling server, room database, or cloud-storage workflow. The bot joins the same Socket.IO room system as a named `NearFlux Telegram Bridge` device and negotiates WebRTC data channels with the existing browser clients.

## Environment variables

Set these in Render as service environment variables. Never put the bot token in frontend variables or commit it to GitHub.

| Variable | Required | Value |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes to enable the bot | The token issued by BotFather. Keep it secret. |
| `TELEGRAM_WEBAPP_URL` | Recommended | `https://nearflux-p2p-share.onrender.com/` or another HTTPS URL serving the existing NearFlux app. |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | A random secret used to validate Telegram webhook requests. |
| `TELEGRAM_MAX_FILE_BYTES` | Optional | Defaults to `20971520` (20 MiB), matching the current Bot API download constraint used by the bridge. |
| `RENDER_EXTERNAL_URL` | Existing | `https://nearflux-p2p-share.onrender.com`; also used for the webhook URL and existing keep-alive. |

When `TELEGRAM_BOT_TOKEN` is absent, the server continues to run exactly as before and logs that the Telegram integration is disabled.

## BotFather configuration

1. Create or select the bot in [@BotFather](https://t.me/BotFather) and copy the token into Render as `TELEGRAM_BOT_TOKEN`.
2. Configure the bot commands. The server also registers these commands at startup: `/start`, `/newroom`, `/join`, `/status`, and `/leave`.
3. Configure the bot's Mini App or menu button to use the value of `TELEGRAM_WEBAPP_URL`. For a room-specific link, the bot itself supplies `?room=FLUX-XXXX`.
4. Keep the Mini App URL on HTTPS and point it at the existing NearFlux deployment, not a second frontend.
5. After deployment, the server registers the webhook at `https://nearflux-p2p-share.onrender.com/telegram/webhook`. If a webhook secret is configured, Telegram must send the corresponding secret header; requests without it receive HTTP 401.

## Supported flow

`/newroom` creates a valid `FLUX-XXXX` room by using the same room-code generator and then joins that room through the existing Socket.IO `join-room` event. `/join FLUX-XXXX` joins an existing room. `/status` reports bridge and web-peer presence. `/leave` emits the existing `leave-room` event and closes WebRTC peers. The inline keyboard opens the same NearFlux app, optionally with the active room query parameter.

A Telegram upload is downloaded temporarily from Telegram, held in memory only for the active transfer, and sent through a WebRTC data channel to the first connected web peer in the same room. The browser sees a normal NearFlux transfer request and must accept it. A browser upload targeted at the Telegram Bridge is accepted automatically by the bridge, received through the existing FILE_START / FILE_CHUNK / FILE_END protocol, checksum-verified, and sent back to the Telegram chat as a photo or document. Temporary bytes are released after transfer completion or failure.

## Deployment

The existing `render.yaml` remains a single Node web service and preserves `/health`, `/healthz`, the client build, Socket.IO signaling, and the 10-minute keep-alive. The only added dependency is the Node WebRTC runtime used by the server-side bridge. Render's build command installs server dependencies before building both packages.

No Telegram token is present in source control. Add the secret in the Render dashboard or through the protected environment configuration, then redeploy. Do not add it to `VITE_*` variables.

## Testing procedure

1. Open `https://nearflux-p2p-share.onrender.com/` in two ordinary browsers and verify that browser-to-browser room joining and file transfer still work.
2. Send `/start` to the bot and verify that the welcome message and Mini App button appear.
3. Send `/newroom`, open the returned Mini App button, and confirm the existing app opens with `?room=FLUX-XXXX` and joins the same room.
4. In a normal browser, join the displayed room code and confirm `/status` changes to show a connected web peer.
5. Send a small document or photo to the bot, accept the NearFlux transfer request in the browser, and verify the file arrives through the existing transfer UI.
6. In the browser, select the `NearFlux Telegram Bridge` device as the target, send a small file, and verify Telegram receives a photo preview or document.
7. Repeat with a file near the configured limit, then verify an oversized file receives a clear error.
8. Exercise `/join`, `/status`, `/leave`, browser disconnect/reconnect, and room-expiration behavior.
9. Confirm `GET /health` and `GET /healthz` return JSON with `status: ok` and that the Render service remains healthy.
10. Review Render logs for `[telegram] bot configured` and confirm no token or file contents are logged.

## Limitations

Telegram Bot API file download and upload limits apply. The default bridge limit is 20 MiB and can be lowered with `TELEGRAM_MAX_FILE_BYTES`; larger transfers must use the normal browser-to-browser NearFlux path or another Telegram-compatible transport. The current bridge chooses the first connected web peer for Telegram-originated transfers. The existing NearFlux implementation intentionally has no TURN relay, so WebRTC connectivity is still subject to the same direct-path constraints as browser-to-browser transfers. Render's free service can cold-start, and Telegram webhook delivery may retry while the service is waking.
