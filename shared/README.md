# NearFlux shared types

This package contains the shared TypeScript contracts used by the NearFlux client and signaling server.

NearFlux uses ephemeral private rooms. The server coordinates room presence and WebRTC signaling, while file bytes travel only through the direct WebRTC DataChannel between participating browsers.

The shared contracts include room creation/joining, device presence, transfer requests and approvals, SDP offers and answers, ICE candidates, cancellation, and direct-connection diagnostics. There is intentionally no file-upload, file-download, file-chunk, storage, proxy, or relay event.

Direct P2P is strict. STUN may be used for ICE discovery, TURN is not configured, relay candidates are rejected, and a transfer is cancelled if the peers cannot verify an allowed `host` or `srflx` candidate pair.
