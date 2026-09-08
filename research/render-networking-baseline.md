# Render networking baseline for the Telegram WebRTC bridge

## Official findings

Render web services must bind an HTTP server to `0.0.0.0` and Render forwards public inbound traffic to one HTTP port. The web-service documentation states that inbound traffic is forwarded to that port and is not directly reachable as an arbitrary public network port. Web services support public HTTP(S) and WebSockets, but the public ingress is an HTTP load-balanced path.

Render private-network documentation states that services in the same region can use private hostnames and almost any port/protocol. It also states that free web services can send private-network requests but cannot receive them. Private services can listen on almost any port and communicate using any protocol, but are not reachable from the public internet.

## Implication for the current bridge

The current Telegram bridge runs native Node `wrtc` inside the public Render web service. Its signaling is HTTP/WebSocket/Socket.IO and works through Render. Its ICE media/data path is different: it requires the native peer to exchange usable ICE candidates and establish a connectivity path with the browser. The current Render web-service deployment does not provide a documented public arbitrary UDP ingress for the native WebRTC endpoint. Therefore a successful Socket.IO room connection does not prove that the native WebRTC data channel can be reached from the browser.

Moving the bridge into a Render private service would not solve public browser-to-bridge connectivity, because private services are not internet-reachable. A separate publicly reachable UDP-capable host is required for a server-side WebRTC bridge, or the architecture must use a relay/file-transfer fallback instead of insisting on direct P2P for the Telegram leg.

## Sources

- https://render.com/docs/web-services
- https://render.com/docs/private-network
- https://render.com/docs/private-services
