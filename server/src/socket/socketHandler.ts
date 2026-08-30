import { Server, Socket } from 'socket.io';
import { deviceManager } from '../services/deviceManager.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinRoomPayload,
  TransferRequestPayload,
  TransferResponsePayload,
  WebRTCSignalPayload,
  TransferCancelPayload,
} from '../types/index.js';

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>
): void {
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    socket.on('keepalive', () => {});

    socket.on('join-room', (payload: JoinRoomPayload) => {
      const previousRoom = deviceManager.getRoomCode(socket.id);
      if (previousRoom) socket.leave(previousRoom);

      const joined = deviceManager.joinRoom(socket.id, payload);
      if (!joined) {
        socket.emit('room-error', { roomCode: payload?.roomCode, message: 'Enter a valid room code.' });
        return;
      }

      socket.join(joined.room.code);
      socket.emit('room-state', {
        roomCode: joined.room.code,
        isCreator: joined.isCreator,
        currentDevice: joined.device,
        devices: deviceManager.getOtherDevices(socket.id),
      });
      socket.to(joined.room.code).emit('device-joined', joined.device);
    });

    socket.on('leave-room', ({ roomCode }) => {
      if (deviceManager.getRoomCode(socket.id) !== roomCode) return;
      const result = deviceManager.leaveRoom(socket.id);
      socket.leave(roomCode);
      if (result) {
        socket.to(roomCode).emit('device-left', { id: result.removedDevice.id });
      }
    });

    socket.on('close-room', ({ roomCode }) => {
      if (deviceManager.getRoomCode(socket.id) !== roomCode) return;
      const socketIds = deviceManager.closeRoom(roomCode, socket.id);
      socketIds.forEach((id) => {
        io.to(id).emit('room-closed', { roomCode });
        io.sockets.sockets.get(id)?.leave(roomCode);
      });
    });

    socket.on('update-device-name', ({ name }) => {
      const updatedDevice = deviceManager.updateDeviceName(socket.id, name);
      const roomCode = deviceManager.getRoomCode(socket.id);
      if (updatedDevice && roomCode) {
        io.to(roomCode).emit('device-updated', updatedDevice);
      }
    });

    socket.on('transfer-request', (payload: TransferRequestPayload) => {
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.targetId)) return;
      io.to(payload.targetId).emit('transfer-request', payload);
    });

    socket.on('transfer-response', (payload: TransferResponsePayload) => {
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.senderId)) return;
      io.to(payload.senderId).emit('transfer-response', payload);
    });

    socket.on('webrtc-offer', (payload: WebRTCSignalPayload) => {
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.targetId)) return;
      io.to(payload.targetId).emit('webrtc-offer', payload);
    });

    socket.on('webrtc-answer', (payload: WebRTCSignalPayload) => {
      // The receiver creates the answer, so it must be forwarded to targetId: the original offer sender.
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.targetId)) {
        console.warn('[Signaling] Rejected answer from unauthorized peer', { senderId: socket.id, targetId: payload.targetId, roomCode: payload.roomCode });
        return;
      }
      const targetSocket = io.sockets.sockets.get(payload.targetId);
      if (!targetSocket) {
        console.warn('[Signaling] Answer target is no longer connected', { targetId: payload.targetId, roomCode: payload.roomCode });
        return;
      }
      targetSocket.emit('webrtc-answer', payload);
    });

    socket.on('webrtc-ice-candidate', (payload: WebRTCSignalPayload) => {
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.targetId)) return;
      io.to(payload.targetId).emit('webrtc-ice-candidate', payload);
    });

    socket.on('transfer-cancel', (payload: TransferCancelPayload) => {
      if (!isAuthorizedPeer(socket.id, payload.roomCode, payload.targetId)) return;
      io.to(payload.targetId).emit('transfer-cancel', payload);
      io.to(payload.senderId).emit('transfer-cancel', payload);
    });

    socket.on('disconnect', () => {
      const result = deviceManager.leaveRoom(socket.id);
      if (result) {
        socket.to(result.roomCode).emit('device-left', { id: result.removedDevice.id });
      }
    });
  });
}

function isAuthorizedPeer(socketId: string, roomCode: string, targetId: string): boolean {
  const room = deviceManager.getRoom(socketId);
  return Boolean(
    room &&
      room.code === normalizeRoomCode(roomCode) &&
      room.devices.has(targetId) &&
      room.devices.has(socketId)
  );
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
}
