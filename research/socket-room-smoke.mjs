import { io } from '../server/node_modules/socket.io-client/build/esm/index.js';

const url = process.env.NEARFLUX_URL || 'http://127.0.0.1:4318';
const roomCode = 'FLUX-ABCD';
const first = io(url, { transports: ['websocket'] });
const second = io(url, { transports: ['websocket'] });

const waitFor = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

try {
  await Promise.all([waitFor(first, 'connect'), waitFor(second, 'connect')]);
  first.emit('join-room', { roomCode, device: { name: 'Smoke A', type: 'desktop', os: 'Test', browser: 'Node' } });
  const firstState = await waitFor(first, 'room-state');
  second.emit('join-room', { roomCode, device: { name: 'Smoke B', type: 'desktop', os: 'Test', browser: 'Node' } });
  const [secondState, joined] = await Promise.all([waitFor(second, 'room-state'), waitFor(first, 'device-joined')]);
  if (firstState.roomCode !== roomCode || secondState.roomCode !== roomCode || joined.name !== 'Smoke B') throw new Error('Room smoke assertion failed');
  console.log(JSON.stringify({ ok: true, roomCode, firstDevices: firstState.devices.length, secondDevices: secondState.devices.length, joined: joined.name }));
} finally {
  first.disconnect();
  second.disconnect();
}
