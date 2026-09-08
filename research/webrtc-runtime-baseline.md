# WebRTC runtime baseline

## Current implementation observations

The NearFlux bridge uses `wrtc` 0.4.7 and creates `RTCPeerConnection` in the same Render web-service process as Express and Socket.IO. It configures STUN servers `stun:stun.l.google.com:19302` and `stun:stun.cloudflare.com:3478`, with no TURN server. It forwards SDP and ICE candidates through the Render Socket.IO signaling service. It permits host, server-reflexive, and peer-reflexive candidates but rejects a selected relay path.

The bridge gathers candidates through the native Node WebRTC implementation. A local diagnostic using the same STUN configuration produced host and server-reflexive UDP candidates and host TCP candidates, and SDP contained seven candidate lines. The local diagnostic remained in `iceGatheringState: gathering` at its timeout, so candidate discovery alone does not demonstrate that a remote browser can complete a connectivity check against the Render instance.

The existing native handshake smoke test established a data channel with `connectionState: connected`, `iceConnectionState: completed`, and a succeeded candidate pair when both peers ran locally. That validates the protocol/library path in one local network context, not public Render reachability.

## Authoritative protocol facts

MDN defines `host` candidates as local interface addresses, `srflx` candidates as NAT bindings learned through STUN, `prflx` candidates as peer-reflexive NAT bindings, and `relay` candidates as TURN-forwarded addresses. MDN defines ICE `connected` as a usable candidate pairing and `completed` as finished gathering with all components connected; `failed` means no compatible pair was found for all components.

The node-webrtc project provides native bindings to WebRTC M106 and exposes `RTCPeerConnection`; it does not itself provide a public network address, UDP ingress, or TURN relay. The host/network still determines whether the native peer's gathered candidates are reachable from the browser.

## Sources

- https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/type
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState
- https://github.com/node-webrtc/node-webrtc
