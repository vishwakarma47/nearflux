import { DeviceType } from './device.js';

export interface RegisterDevicePayload {
  name: string;
  type: DeviceType;
  os: string;
  browser: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  device: RegisterDevicePayload;
}

export interface UpdateDeviceNamePayload {
  name: string;
}

export interface TransferRequestPayload {
  roomCode: string;
  senderId: string;
  senderName: string;
  targetId: string;
  files: {
    name: string;
    size: number;
    type: string;
  }[];
}

export interface TransferResponsePayload {
  roomCode: string;
  senderId: string;
  targetId: string;
  accepted: boolean;
  reason?: string;
}

export interface WebRTCSignalPayload {
  roomCode: string;
  senderId: string;
  targetId: string;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export interface TransferCancelPayload {
  roomCode: string;
  senderId: string;
  targetId: string;
}

export interface RoomStatePayload {
  roomCode: string;
  isCreator: boolean;
  currentDevice: import('./device.js').Device;
  devices: import('./device.js').Device[];
}

export interface RoomErrorPayload {
  roomCode?: string;
  message: string;
}

export interface RoomClosedPayload {
  roomCode: string;
}

export interface ServerToClientEvents {
  'room-state': (payload: RoomStatePayload) => void;
  'room-error': (payload: RoomErrorPayload) => void;
  'room-closed': (payload: RoomClosedPayload) => void;
  'device-registered': (device: import('./device.js').Device) => void;
  'device-list': (devices: import('./device.js').Device[]) => void;
  'device-joined': (device: import('./device.js').Device) => void;
  'device-updated': (device: import('./device.js').Device) => void;
  'device-left': (data: { id: string }) => void;
  'transfer-request': (payload: TransferRequestPayload) => void;
  'transfer-response': (payload: TransferResponsePayload) => void;
  'webrtc-offer': (payload: WebRTCSignalPayload) => void;
  'webrtc-answer': (payload: WebRTCSignalPayload) => void;
  'webrtc-ice-candidate': (payload: WebRTCSignalPayload) => void;
  'transfer-cancel': (payload: TransferCancelPayload) => void;
}

export interface ClientToServerEvents {
  'join-room': (payload: JoinRoomPayload) => void;
  'leave-room': (payload: { roomCode: string }) => void;
  'close-room': (payload: { roomCode: string }) => void;
  'update-device-name': (data: UpdateDeviceNamePayload) => void;
  'transfer-request': (payload: TransferRequestPayload) => void;
  'transfer-response': (payload: TransferResponsePayload) => void;
  'webrtc-offer': (payload: WebRTCSignalPayload) => void;
  'webrtc-answer': (payload: WebRTCSignalPayload) => void;
  'webrtc-ice-candidate': (payload: WebRTCSignalPayload) => void;
  'transfer-cancel': (payload: TransferCancelPayload) => void;
}
