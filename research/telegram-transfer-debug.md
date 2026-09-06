# Telegram transfer debugging findings

The two supplied screenshots show both directions stuck at “Establishing a direct WebRTC connection…” while the Render room reports the Telegram bridge online and the browser peer connected.

Confirmed root cause in the native Node `wrtc` bridge: `event.candidate.toJSON()` was called when forwarding ICE candidates. The native Node candidate object does not implement the browser-only `toJSON()` method, so the bridge could not forward ICE candidates. This left the data channel or direct readiness handshake incomplete.

Fix committed and pushed as `84f1574` (`Fix Telegram WebRTC ICE interoperability`). The bridge now serializes native candidates explicitly and performs a symmetric non-relay direct-readiness handshake before transfer. Local server/client production builds passed. The existing two-client Socket.IO room/presence smoke test passed. A focused native WebRTC test established a connected data channel and a succeeded nominated candidate pair; the native library segfaulted only during test teardown after printing the success assertion.

Render deployment `dep-dad8665ckfvc7396ccv0` for `84f1574` was still Building at the latest check, with Node 20.19.1 selected and dependency installation/build command running. The previous live commit remained `9ea222f` at that point.


## Second live failure

After commit `84f1574` became Live, Render logs showed the bridge received transfer activity but crashed in `BridgeSession.createPeer` with `TypeError: RTCPeerConnection is not a constructor`. The dynamic ESM import of the CommonJS `wrtc` package exposed its constructors under `default`, while the bridge destructured named exports directly.

Commit `c594bbc` now unwraps `wrtcModule.default ?? wrtcModule` before destructuring `RTCPeerConnection`, `RTCSessionDescription`, and `RTCIceCandidate`. Local production builds and a runtime constructor import check passed. The redeploy for `c594bbc` was triggered; production verification is pending its Render deployment completion.
