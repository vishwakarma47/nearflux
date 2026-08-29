# Render deployment notes

Render’s official Node/Express deployment guide says a repository is connected from the Render Dashboard using **New > Web Service**, then a Node runtime, build command, and start command are specified. Render deploys the service at an `onrender.com` URL and automatically redeploys linked-branch pushes. Source: https://render.com/docs/deploy-node-express-app

Render’s official WebSocket guidance confirms that Render web services accept inbound WebSocket connections from the public internet. WebSocket connections close when an instance is replaced, such as during a deploy, so NearFlux room state remains ephemeral and clients should reconnect. Source: https://render.com/docs/websocket

NearFlux can run as one Render web service because the Express server serves `client/dist` and hosts Socket.IO on the same origin. Production commands should install root, server, and client dependencies, build both TypeScript targets, and start `node server/dist/index.js`. The client’s production fallback uses `window.location.origin` for signaling, so no separate VITE_SIGNALING_URL is required for the single-service deployment. `FRONTEND_ORIGIN` can be set to the service origin for Socket.IO CORS.

Deployment blocker identified: the local project has no Git remote and `gh auth status` reports no GitHub login. Render therefore cannot connect to this codebase until a GitHub repository is provided or the user authorizes a repository/Render account through the browser.
