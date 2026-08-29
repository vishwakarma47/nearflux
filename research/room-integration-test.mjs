import { io } from '../client/node_modules/socket.io-client/build/esm/index.js';

const room = `FLUX-${Date.now().toString().slice(-4)}`;
const device = (name) => ({ name, type: 'desktop', os: 'Test OS', browser: 'Test Browser' });
const waitFor = (socket, event, timeout = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

const alpha = io('http://localhost:3000', { transports: ['websocket'] });
const beta = io('http://localhost:3000', { transports: ['websocket'] });
const outsider = io('http://localhost:3000', { transports: ['websocket'] });

try {
  await Promise.all([waitFor(alpha, 'connect'), waitFor(beta, 'connect'), waitFor(outsider, 'connect')]);
  alpha.emit('join-room', { roomCode: room, device: device('Alpha') });
  const alphaState = await waitFor(alpha, 'room-state');
  beta.emit('join-room', { roomCode: room, device: device('Beta') });
  const betaState = await waitFor(beta, 'room-state');
  const joined = await waitFor(alpha, 'device-joined');
  outsider.emit('join-room', { roomCode: `FLUX-${(Number(Date.now().toString().slice(-4)) + 1).toString().padStart(4, '0')}`, device: device('Outsider') });
  const outsiderState = await waitFor(outsider, 'room-state');

  if (alphaState.devices.length !== 0) throw new Error('Creator should initially see no peers');
  if (betaState.devices.length !== 1 || betaState.devices[0].name !== 'Alpha') throw new Error('Room presence is not isolated or complete');
  if (joined.name !== 'Beta') throw new Error('Room join event did not reach the existing peer');
  if (outsiderState.devices.length !== 0) throw new Error('Different room leaked presence');

  const answerPromise = waitFor(alpha, 'webrtc-answer');
  beta.emit('webrtc-answer', {
    roomCode: room,
    senderId: betaState.currentDevice.id,
    targetId: alphaState.currentDevice.id,
    signal: { type: 'answer', sdp: 'test-answer' },
  });
  const answer = await answerPromise;
  if (answer.senderId !== betaState.currentDevice.id || answer.targetId !== alphaState.currentDevice.id) throw new Error('SDP answer was not routed to the original offer sender');

  console.log(JSON.stringify({ ok: true, room, alphaPeers: alphaState.devices.length, betaPeers: betaState.devices.length, outsiderPeers: outsiderState.devices.length, answerRoutedTo: answer.targetId, serverDataPath: 'signaling-only' }));
} finally {
  alpha.disconnect();
  beta.disconnect();
  outsider.disconnect();
}
