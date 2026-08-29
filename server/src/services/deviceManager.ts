import { Device, JoinRoomPayload } from '../types/index.js';

type Room = {
  code: string;
  creatorId: string;
  devices: Map<string, Device>;
};

class DeviceManager {
  private rooms = new Map<string, Room>();
  private socketRooms = new Map<string, string>();

  public joinRoom(socketId: string, payload: JoinRoomPayload): { room: Room; device: Device; isCreator: boolean } | null {
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode || !payload.device?.name) return null;

    this.leaveRoom(socketId);

    let room = this.rooms.get(roomCode);
    if (!room) {
      room = { code: roomCode, creatorId: socketId, devices: new Map() };
      this.rooms.set(roomCode, room);
    }

    const device: Device = {
      id: socketId,
      name: payload.device.name.trim(),
      type: payload.device.type,
      os: payload.device.os,
      browser: payload.device.browser,
      joinedAt: Date.now(),
    };

    room.devices.set(socketId, device);
    this.socketRooms.set(socketId, roomCode);
    return { room, device, isCreator: room.creatorId === socketId };
  }

  public leaveRoom(socketId: string): { roomCode: string; removedDevice: Device; wasCreator: boolean } | null {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    this.socketRooms.delete(socketId);
    if (!room) return null;

    const removedDevice = room.devices.get(socketId);
    room.devices.delete(socketId);
    const wasCreator = room.creatorId === socketId;

    if (room.devices.size === 0) {
      this.rooms.delete(roomCode);
    } else if (wasCreator) {
      const nextCreator = room.devices.keys().next().value as string | undefined;
      if (nextCreator) room.creatorId = nextCreator;
    }

    return removedDevice ? { roomCode, removedDevice, wasCreator } : null;
  }

  public closeRoom(roomCode: string, socketId: string): string[] {
    const normalized = normalizeRoomCode(roomCode);
    const room = this.rooms.get(normalized);
    if (!room || room.creatorId !== socketId) return [];

    const sockets = Array.from(room.devices.keys());
    sockets.forEach((id) => this.socketRooms.delete(id));
    this.rooms.delete(normalized);
    return sockets;
  }

  public updateDeviceName(socketId: string, name: string): Device | null {
    const room = this.getRoom(socketId);
    const device = room?.devices.get(socketId);
    if (!device || !name.trim()) return null;
    device.name = name.trim();
    return device;
  }

  public getRoomCode(socketId: string): string | undefined {
    return this.socketRooms.get(socketId);
  }

  public getRoom(socketId: string): Room | undefined {
    const roomCode = this.socketRooms.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  public getOtherDevices(socketId: string): Device[] {
    const room = this.getRoom(socketId);
    if (!room) return [];
    return Array.from(room.devices.values()).filter((device) => device.id !== socketId);
  }

  public getDevice(socketId: string): Device | undefined {
    return this.getRoom(socketId)?.devices.get(socketId);
  }

  public getCount(): number {
    return Array.from(this.rooms.values()).reduce((count, room) => count + room.devices.size, 0);
  }
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
}

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `FLUX-${suffix}`;
}

export const deviceManager = new DeviceManager();
