# Render deployment notes

Render’s official Node/Express deployment guide says a repository is connected from the Render Dashboard using **New > Web Service**, then a Node runtime, build command, and start command are specified. Render deploys the service at an `onrender.com` URL and automatically redeploys linked-branch pushes. Source: https://render.com/docs/deploy-node-express-app

Render’s official WebSocket guidance confirms that Render web services accept inbound WebSocket connections from the public internet. WebSocket connections close when an instance is replaced, such as during a deploy, so NearFlux room state remains ephemeral and clients should reconnect. Source: https://render.com/docs/websocket

NearFlux can run as one Render web service because the Express server serves `client/dist` and hosts Socket.IO on the same origin. Production commands should install root, server, and client dependencies, build both TypeScript targets, and start `node server/dist/index.js`. The client’s production fallback uses `window.location.origin` for signaling, so no separate VITE_SIGNALING_URL is required for the single-service deployment. `FRONTEND_ORIGIN` can be set to the service origin for Socket.IO CORS.

Deployment blocker identified: the local project has no Git remote and `gh auth status` reports no GitHub login. Render therefore cannot connect to this codebase until a GitHub repository is provided or the user authorizes a repository/Render account through the browser.

## 2026-08-29 production deployment checkpoint

Render service: https://nearflux-p2p-share.onrender.com
Render dashboard service ID: srv-da97f6942hec73f00udg
Source repository: https://github.com/vishwakarma47/nearflux-p2p-share

The first Render deploy failed because NODE_ENV=production caused npm ci to omit TypeScript development dependencies, producing TS7016 for express. The service build command was corrected directly in Render to `npm ci --include=dev && npm --prefix server ci --include=dev && npm --prefix client ci --include=dev && npm run build`.

The corrected redeploy built successfully, uploaded the client build, and started `node server/dist/server/src/index.js`. Render logs reported `NearFlux signaling server listening on port 10000`, `Server responsibility: ephemeral rooms, presence, and WebRTC signaling only.`, and `File relay: disabled. TURN: not configured.` The corrected local source and render.yaml change are committed locally but the follow-up push was blocked by GitHub credential routing; Render’s service-level build setting is already corrected for the live deployment.


Public verification: `https://nearflux-p2p-share.onrender.com/` returned HTTP 200 with the NearFlux title. `https://nearflux-p2p-share.onrender.com/health` returned HTTP 200 with `status: ok`, `service: nearflux-signaling`, `fileDataRelay: false`, and `connectedDevices: 0` at verification time. The browser screenshot renderer briefly showed a blank page, but direct HTTPS probing confirmed the frontend and health route are live.
