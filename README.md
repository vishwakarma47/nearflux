# NearFlux

**NearFlux** is a private-room file-sharing web application that transfers files directly between browsers using WebRTC DataChannels. Friends can join the same ephemeral room from different locations by opening a secret link, scanning a QR code, or entering a room code.

> The signaling server handles room presence and WebRTC negotiation only. File data is never uploaded, stored, proxied, relayed, or streamed by the server.

## Features

NearFlux supports device-name onboarding, private rooms with `?room=FLUX-####` URLs, room creation and regeneration, join-by-code, copyable invite links, QR-code sharing, multiple connected devices, file and nested-folder selection, room-filtered presence, direct-connection diagnostics, transfer approval, chunked DataChannel streaming, cancellation, and client-side integrity verification. There is no application-level upload or download speed cap; transfers run as fast as the browser DataChannel and direct network path allow. Each file is sent in 1 MB application chunks. Adaptive queue control pauses only when the browser send queue is full and resumes as soon as capacity returns; it does not cap transfer speed.

The connection policy is intentionally strict. The client uses STUN for ICE discovery, does not configure TURN, rejects relay candidates, verifies the selected ICE candidate pair before sending, and cancels safely when a direct path cannot be established. There is no server or WebSocket file-transfer fallback.

## Technology

The client uses React, TypeScript, Vite, CSS variables, Lucide icons, and `qrcode.react`. The server uses Node.js, Express, and Socket.IO for ephemeral rooms and signaling. WebRTC `RTCPeerConnection` and `RTCDataChannel` carry file data directly between browsers.

## Development

Install all dependencies from the repository root:

```bash
npm run install:all
```

Run the signaling server and Vite client together:

```bash
npm run dev
```

The development client runs at `http://localhost:5173` and connects to the signaling server at `http://localhost:3000`. For a different public signaling origin, set the client-side `VITE_SIGNALING_URL` value. For a deployed server, set `FRONTEND_ORIGIN` to the allowed HTTPS frontend origin, or leave it unset during development.

## Production build

```bash
npm run build:client
npm run build:server
node server/dist/index.js
```

The server serves the built client when `client/dist` is present. It listens on `PORT` or port `3000` and exposes `/health` and `/healthz`. The health response explicitly reports that file-data relay is disabled.

## Signaling and data boundaries

The server accepts room join/leave/close messages, device presence updates, transfer requests and approvals, SDP offers and answers, ICE candidates, and transfer cancellation events. It does not define or accept a file-chunk event. All file metadata and bytes used during a transfer travel through the direct WebRTC DataChannel after both peers have verified an allowed `host` or `srflx` ICE path.

Direct connectivity is not guaranteed on every firewall or NAT combination. That limitation is intentional: when direct P2P is unavailable, NearFlux fails safely instead of using TURN, a relay, an upload endpoint, temporary storage, or any other indirect path.

## License

This project is licensed under the MIT License.
