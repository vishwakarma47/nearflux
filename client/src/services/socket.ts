import { io, Socket } from 'socket.io-client';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinRoomPayload,
  TransferRequestPayload,
  TransferResponsePayload,
  WebRTCSignalPayload,
  TransferCancelPayload,
} from '../types/index.js';

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  public connect(serverUrl?: string): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (this.socket) return this.socket;

    const configuredUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SIGNALING_URL;
    const isViteDev = window.location.port === '5173';
    const defaultUrl = isViteDev
      ? `http://${window.location.hostname}:3000`
      : window.location.origin;

    this.socket = io(serverUrl || configuredUrl || defaultUrl, {
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    return this.socket;
  }

  public getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  public joinRoom(payload: JoinRoomPayload): void {
    this.socket?.emit('join-room', payload);
  }

  public leaveRoom(roomCode: string): void {
    this.socket?.emit('leave-room', { roomCode });
  }

  public closeRoom(roomCode: string): void {
    this.socket?.emit('close-room', { roomCode });
  }

  public sendTransferRequest(payload: TransferRequestPayload): void {
    this.socket?.emit('transfer-request', payload);
  }

  public sendTransferResponse(payload: TransferResponsePayload): void {
    this.socket?.emit('transfer-response', payload);
  }

  public sendWebRTCOffer(payload: WebRTCSignalPayload): void {
    this.socket?.emit('webrtc-offer', payload);
  }

  public sendWebRTCAnswer(payload: WebRTCSignalPayload): void {
    this.socket?.emit('webrtc-answer', payload);
  }

  public sendIceCandidate(payload: WebRTCSignalPayload): void {
    this.socket?.emit('webrtc-ice-candidate', payload);
  }

  public cancelTransfer(payload: TransferCancelPayload): void {
    this.socket?.emit('transfer-cancel', payload);
  }

  public disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketService = new SocketService();
