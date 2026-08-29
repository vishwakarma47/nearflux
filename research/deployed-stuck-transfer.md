# Deployed stuck-transfer diagnosis

The reported deployed URL is `https://nearfluxy.onrender.com/?room=FLUX-87TB`. The page loads the updated UI, but the visible status is `Offline` while the transfer modal remains at `Establishing a direct WebRTC connection...`.

The deployed `/health` endpoint is reachable and reports `status: ok`, `service: nearflux-signaling`, `fileDataRelay: false`, and three connected devices. This confirms that the Render server is alive and that the strict no-relay server is running.

The sandbox browser console did not expose an error. The confirmed root cause was server-side SDP answer routing. The receiver sent an answer with `targetId` set to the original offer sender, but the server authorization check incorrectly validated `senderId` and then emitted the answer back to `senderId`—the receiver itself. The original sender therefore never received the answer and stayed at `Establishing a direct WebRTC connection...`. The handler now authorizes and forwards answers to `targetId`. A direct-connection timeout was also added so any future failed handshake exits the stuck state safely.

The regression test now passes for same-room presence, different-room isolation, and SDP answer delivery to the original offer sender. The deployed Render instance must be redeployed with the fixed archive before the live URL will use this correction.
