# Strict direct-P2P audit

## Requirement interpretation

The user-provided specification overrides the earlier architecture options. NearFlux must use strict direct WebRTC P2P only. The server may handle room/session metadata, presence, SDP offers/answers, and ICE candidates, but it must never receive, relay, store, proxy, or stream file data.

TURN is explicitly forbidden. No `turn:` or `turns:` ICE configuration may be added. Direct connectivity must be verified before sending any file bytes. Allowed candidate types are `host` and `srflx`; a selected `relay` candidate must terminate the transfer. If direct connectivity cannot be established, the transfer must fail safely without fallback.

## Violations in the current project

1. `client/src/context/AppContext.tsx` starts a Socket.IO fallback after a 3.5-second WebRTC timeout by calling `webrtc.sendFiles(filesToTransfer, true)`.
2. `client/src/services/webrtc.ts` accepts `forceSocketFallback`, sends headers and binary file chunks through `socketService.sendFileChunk`, and contains a Socket.IO pacing path.
3. `client/src/services/socket.ts` exposes `sendFileChunk`.
4. `server/src/socket/socketHandler.ts` listens for `file-chunk` and forwards file payloads to the target socket.
5. `shared/types/socket.ts` declares `file-chunk` in both client/server event maps and defines `FileChunkPayload`.
6. Existing connection handling treats a data channel opening as sufficient to begin transfer; it does not verify the selected ICE candidate pair before sending bytes.

## Safe existing behavior

The client-side `downloadFile` method creates a Blob locally from received DataChannel chunks and triggers a browser download; this is not server storage or server-mediated transfer. The existing WebRTC signaling events can be retained and room-scoped.

## Planned changes

- Remove the Socket.IO file-chunk event and all fallback arguments/branches.
- Add room create/join/leave events and room-scoped presence/signaling.
- Keep only STUN ICE servers; expose no TURN configuration.
- Track ICE connection state and selected candidate pair via `RTCPeerConnection.getStats()`.
- Allow file sending only after a verified `host` or `srflx` candidate pair and direct connection state.
- Implement direct-only failure messages and cancellation.
- Add explicit transfer protocol metadata, backpressure, cancellation, integrity checks, and large-file-safe streaming.
- Preserve the target live-reference UI: room query URL, copy link, QR modal, join-by-code, device onboarding, nested folder selection, and room-filtered devices.

## Remaining user decisions

The strict-P2P specification fixes the transfer architecture. Only deployment/public URL, room access/lifetime/participant rules, and whether to include all live-reference UI features in the first implementation remain to be confirmed.
