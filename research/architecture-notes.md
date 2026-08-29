# NearFlux cross-network architecture notes

## Existing project findings

NearFlux currently uses a Socket.IO server for device registration, global presence, WebRTC signaling, and a fallback file-chunk relay. Devices are registered into one in-memory global list, and there is no room ID, invite token, room membership, or join-by-link flow. The client socket wrapper connects to a local server during Vite development and same-origin in production. The current WebRTC service uses public STUN servers but has no configurable TURN server path.

## Verified web guidance

MDN explains that WebRTC ICE uses STUN and/or TURN to establish peer connectivity. STUN helps discover a public address and determine whether direct connectivity is possible. TURN bypasses restrictive or symmetric NAT by relaying packets through a server, with additional overhead. Source: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols

Socket.IO documents rooms as server-side channels that sockets can join and leave, with room-scoped broadcasts such as `io.to(room).emit(...)`. This is suitable for isolating device presence and signaling to a private share room. Source: https://socket.io/docs/v4/rooms/

## Architectural implication

The target “share anywhere” behavior requires more than UI changes:

1. A public HTTPS deployment for the web app and Socket.IO signaling server.
2. Room creation and joining by a short code or invite URL, with server-side room membership.
3. Room-scoped device presence and signaling instead of globally broadcasting all devices.
4. Configurable STUN/TURN ICE servers for reliable cross-network WebRTC. The existing Socket.IO file relay can remain as a fallback, but it means the server may carry file data when direct WebRTC cannot connect.
5. A decision on whether the product promises best-effort direct P2P with fallback, or reliable transfers that may intentionally use a relay.

## Questions that materially change the design

- Whether to implement real room behavior now or only mimic the target screen.
- Whether a public deployment/domain already exists or should be prepared as part of the work.
- Whether the user can provide a TURN service/credentials, or whether the first version should use STUN plus the existing Socket.IO relay fallback.
- Whether room access is open to anyone with the link/code or requires a stronger access control model.
- Whether the maximum room size is two people or multiple devices/users.
