import { io } from '../client/node_modules/socket.io-client/build/esm/index.js';

const room = `FLUX-${Date.now().toString().slice(-4)}`;
const makeDevice = (name) => ({ name, type: 'desktop', os: 'Test OS', browser: 'Test Browser' });
const waitFor = (socket, event, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

const alpha = io('http://localhost:3000', { transports: ['websocket'] });
const beta = io('http://localhost:3000', { transports: ['websocket'] });
try {
  await Promise.all([waitFor(alpha, 'connect'), waitFor(beta, 'connect')]);
  alpha.emit('join-room', { roomCode: room, device: makeDevice('Alpha') });
  const alphaState = await waitFor(alpha, 'room-state');
  beta.emit('join-room', { roomCode: room, device: makeDevice('Beta') });
  const betaState = await waitFor(beta, 'room-state');
  await waitFor(alpha, 'device-joined');
  console.log({ room, alphaSocketId: alpha.id, alphaDeviceId: alphaState.currentDevice.id, betaSocketId: beta.id, betaDeviceId: betaState.currentDevice.id });

  alpha.on('webrtc-answer', (payload) => console.log('alpha received answer', payload));
  beta.on('webrtc-answer', (payload) => console.log('beta received answer', payload));
  const answerPromise = waitFor(alpha, 'webrtc-answer');
  const payload = { roomCode: room, senderId: betaState.currentDevice.id, targetId: alphaState.currentDevice.id, signal: { type: 'answer', sdp: 'test-answer' } };
  console.log('beta emits', payload);
  beta.emit('webrtc-answer', payload);
  const answer = await answerPromise;
  console.log(JSON.stringify({ ok: true, answer }));
} finally {
  alpha.disconnect();
  beta.disconnect();
}
