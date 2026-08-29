# NearFlux strict direct-P2P implementation report

## Result

NearFlux has been upgraded from global LAN discovery to ephemeral private rooms that can be joined through a `?room=FLUX-####` URL, a secret code, or a locally generated QR invite. The project remains deployment-ready and does not hard-code the provided Render URL.

The transfer architecture follows the strict requirement: the server handles room lifecycle, presence, transfer approval, SDP, ICE candidates, and cancellation only. File metadata and bytes are sent through the direct WebRTC DataChannel after both peers verify a direct `host` or `srflx` ICE path. TURN is not configured, relay candidates are rejected, and failed direct connectivity cancels the transfer without a fallback.

## Main changes

| Area | Implementation |
|---|---|
| Rooms | Added ephemeral in-memory rooms, creator tracking, join/leave/close, generated codes, room-scoped presence, and cleanup when the last device leaves. |
| Invite flow | Added query-parameter room handling, copyable share links, locally rendered QR codes, join-by-code, room regeneration, and close-room controls. |
| UI | Matched the supplied reference with device onboarding, private-room header and device section, file/folder dropzone, footer information dialogs, responsive styling, and direct-P2P status messaging. |
| Transfer | Removed all Socket.IO file chunks and relay fallback branches. Added STUN-only ICE, relay-candidate rejection, selected candidate-pair verification, a two-sided direct-ready handshake, DataChannel chunking, cancellation, checksum validation, and unrestricted application-level throughput. The prior fixed 8 MB buffered-amount throttle was replaced with adaptive queue control: the sender waits only while the browser queue is full, then resumes immediately. There is still no application upload or download speed cap. The application chunk size is now 1 MB, selected as a safer throughput improvement over 128 KB without the larger browser-compatibility and retransmission risks of 2–5 MB messages. |
| Configuration | Added `VITE_SIGNALING_URL` support for deployment flexibility and `FRONTEND_ORIGIN` support for server CORS configuration. |

## Important files

`server/src/services/deviceManager.ts` contains the ephemeral room registry. `server/src/socket/socketHandler.ts` contains room-scoped presence and signaling handlers. `client/src/hooks/useSocket.ts` manages URL-aware room membership. `client/src/services/webrtc.ts` contains STUN-only direct-path verification and DataChannel transfer. `client/src/context/AppContext.tsx` coordinates room state and transfer lifecycle. `client/src/components/RoomShareModal.tsx` contains link, QR, regeneration, close, and join controls.

## Verification performed

Both production builds passed with `npm run build:server` and `npm run build:client`. The signaling server integration test passed for same-room presence isolation, different-room isolation, and correct SDP answer routing from the receiver back to the original offer sender. A deployed-transfer fix also adds a direct-connection timeout so a failed handshake cannot remain stuck indefinitely. The health endpoint reported `fileDataRelay: false`. A final source audit found no TURN configuration, no file-chunk event, no Socket.IO file-transfer method, no forced fallback path, and no HTTP upload/download path. Browser checks passed for onboarding, QR rendering, room regeneration, URL updates, join-by-code, and console cleanliness.

## Deployment

Install with `npm run install:all`. Build with `npm run build:client && npm run build:server`. Start with `node server/dist/index.js`. Set `PORT` for the server and optionally set `FRONTEND_ORIGIN` to the deployed HTTPS frontend origin. For a separately hosted frontend, set `VITE_SIGNALING_URL` at client build time to the public signaling-server origin.

## Guest-mode history and workspace navigation

The client now supports guest use without authentication. Ended transfer metadata is retained locally in the browser under `NearFlux_transfer_history`, bounded to a small recent-history list and clearable from the Transfers view. File contents and `File` objects are never persisted, and no server account or synchronization claim is made. The icon rail now switches real Home, Transfers, Devices, Rooms, and Settings views. The latest CSS pass adds translucent theme-aware surfaces, smooth light/dark interpolation, overflow containment, long-label ellipsis, safe wrapping, and responsive grid collapse.

This pass was UI/state-only and did not change the signaling, ICE, WebRTC DataChannel, or direct-P2P enforcement paths.

## Limitation

Strict direct P2P cannot succeed on every NAT or firewall combination. The app intentionally fails safely when no allowed direct `host` or `srflx` path can be verified. A two-browser cross-network test must be run with real devices and a public HTTPS signaling deployment; this sandbox verification covered room signaling, UI behavior, builds, source audit, and local server integration.
