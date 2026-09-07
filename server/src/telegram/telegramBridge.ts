import { randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import type { Express, Request, Response } from 'express';
import type { Device } from '../../../shared/types/device.js';
import type { TransferRequestPayload } from '../../../shared/types/socket.js';
import { generateRoomCode } from '../services/deviceManager.js';

const wrtcModule = await import('wrtc');
const wrtc = (wrtcModule as any).default ?? wrtcModule;
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc as any;

const CHUNK_SIZE = 60 * 1024;
const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  video?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>;
};

type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: { id: string; data?: string; message?: TelegramMessage } };

type FileDescriptor = { name: string; size: number; type: string };

type ChunkAckWaiter = { resolve: () => void; reject: (error: Error) => void };
type VerificationWaiter = { checksum: string; resolve: () => void; reject: (error: Error) => void };

type ReceiveState = {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  chunks: Buffer[];
  receivedBytes: number;
  expectedChunkIndex: number;
  pendingChunk: { fileId: string; chunkIndex: number; byteLength: number } | null;
  checksum: number;
};

class TelegramApi {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json() as { ok: boolean; result?: T; description?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed`);
    return payload.result as T;
  }

  sendMessage(chatId: number, text: string, reply_markup?: unknown): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text, reply_markup });
  }

  answerCallbackQuery(id: string): Promise<unknown> {
    return this.call('answerCallbackQuery', { callback_query_id: id });
  }

  editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: unknown): Promise<unknown> {
    return this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  }

  sendDocument(chatId: number, bytes: Buffer, filename: string, mimeType: string, caption?: string): Promise<unknown> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType }), filename);
    if (caption) form.append('caption', caption);
    return this.callForm('sendDocument', form);
  }

  sendPhoto(chatId: number, bytes: Buffer, filename: string, caption?: string): Promise<unknown> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/*' }), filename);
    if (caption) form.append('caption', caption);
    return this.callForm('sendPhoto', form);
  }

  async getFileBytes(fileId: string, maxBytes: number): Promise<Buffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!file.file_path) throw new Error('Telegram did not return a file path.');
    if (file.file_size && file.file_size > maxBytes) throw new Error(`Telegram file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB bridge limit.`);
    const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    if (!response.ok) throw new Error(`Telegram file download failed (${response.status}).`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error(`Telegram file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB bridge limit.`);
    return Buffer.from(arrayBuffer);
  }

  setWebhook(url: string, secretToken?: string): Promise<unknown> {
    return this.call('setWebhook', { url, ...(secretToken ? { secret_token: secretToken } : {}) });
  }

  setMyCommands(): Promise<unknown> {
    return this.call('setMyCommands', { commands: [
      { command: 'start', description: 'Open NearFlux' },
      { command: 'newroom', description: 'Create a NearFlux room' },
      { command: 'join', description: 'Join a room: /join FLUX-XXXX' },
      { command: 'status', description: 'Show connection status' },
      { command: 'leave', description: 'Leave the active room' },
    ] });
  }

  private async callForm<T>(method: string, form: FormData): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', body: form });
    const payload = await response.json() as { ok: boolean; result?: T; description?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed`);
    return payload.result as T;
  }
}

function checksumUpdate(checksum: number, bytes: Uint8Array): number {
  let value = checksum >>> 0;
  for (const byte of bytes) value = Math.imul(value ^ byte, FNV_PRIME) >>> 0;
  return value;
}

function checksumString(value: number): string { return (value >>> 0).toString(16).padStart(8, '0'); }
function serializeIceCandidate(candidate: any): any {
  if (typeof candidate?.toJSON === 'function') return candidate.toJSON();
  return {
    candidate: candidate?.candidate,
    sdpMid: candidate?.sdpMid ?? null,
    sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
    ...(candidate?.usernameFragment ? { usernameFragment: candidate.usernameFragment } : {}),
  };
}
function normalizeRoomCode(value: string): string { return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9); }
function webAppUrl(base: string, room?: string): string { return `${base.replace(/\/$/, '')}/${room ? `?room=${encodeURIComponent(room)}` : ''}`; }

class BridgeSession {
  private socket: Socket;
  private roomCode = '';
  private currentDevice: Device | null = null;
  private devices: Device[] = [];
  private peers = new Map<string, any>();
  private pendingOutbound: { bytes: Buffer; name: string; type: string; targetId: string } | null = null;
  private receiveFiles = new Map<string, ReceiveState>();
  private pendingCandidates = new Map<string, any[]>();
  private directReady = new Set<string>();
  private remoteReady = new Set<string>();
  private remoteReadyWaiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>();
  private pendingChunkAcks = new Map<string, ChunkAckWaiter>();
  private pendingVerifications = new Map<string, VerificationWaiter>();

  constructor(
    private readonly chatId: number,
    private readonly api: TelegramApi,
    private readonly socketUrl: string,
    private readonly onStatus: (text: string) => Promise<void>,
    private readonly onReceived: (bytes: Buffer, name: string, type: string) => Promise<void>,
    private readonly requestApproval: (payload: TransferRequestPayload) => Promise<boolean>,
  ) {
    this.socket = io(socketUrl, { transports: ['websocket'], reconnection: true, autoConnect: false });
    this.socket.on('connect', () => { if (this.roomCode) this.joinSocket(this.roomCode); });
    this.socket.on('room-state', (payload) => {
      this.roomCode = payload.roomCode;
      this.currentDevice = payload.currentDevice;
      this.devices = payload.devices;
      void this.onStatus(`✅ Joined Room ${this.roomCode}!\n\n• Status: Waiting for a WebRTC peer\n• Telegram Bridge: Online\n• NearFlux Web: ${this.devices.length ? 'Connected' : 'Waiting'}`);
    });
    this.socket.on('room-error', (payload) => void this.onStatus(`❌ ${payload.message}`));
    this.socket.on('device-joined', (device: Device) => { if (!this.devices.some((item) => item.id === device.id)) this.devices.push(device); });
    this.socket.on('device-left', ({ id }) => { this.devices = this.devices.filter((device) => device.id !== id); this.closePeer(id); });
    this.socket.on('transfer-response', (payload) => { if (payload.accepted && this.pendingOutbound && payload.targetId === this.pendingOutbound.targetId) void this.startOutboundPeer(payload.targetId); });
    this.socket.on('transfer-request', (payload: TransferRequestPayload) => {
      if (!this.currentDevice || payload.roomCode !== this.roomCode || payload.targetId !== this.currentDevice.id) return;
      void this.requestApproval(payload).then((accepted) => {
        if (!this.currentDevice || payload.roomCode !== this.roomCode) return;
        this.socket.emit('transfer-response', {
          roomCode: this.roomCode,
          senderId: payload.senderId,
          targetId: this.currentDevice.id,
          accepted,
          ...(accepted ? {} : { reason: 'Telegram user declined the transfer.' }),
        });
      }).catch(async (error) => {
        await this.onStatus(`❌ ${error instanceof Error ? error.message : 'Telegram approval failed.'}`);
      });
    });
    this.socket.on('webrtc-offer', (payload) => { if (payload.roomCode === this.roomCode && payload.targetId === this.currentDevice?.id) void this.acceptOffer(payload.senderId, payload.signal); });
    this.socket.on('webrtc-answer', (payload) => { const peer = this.peers.get(payload.senderId); if (peer) void peer.setRemoteDescription(new RTCSessionDescription(payload.signal)); });
    this.socket.on('webrtc-ice-candidate', (payload) => {
      const peer = this.peers.get(payload.senderId);
      if (!peer) return;
      if (!peer.remoteDescription) {
        const queued = this.pendingCandidates.get(payload.senderId) || [];
        queued.push(payload.signal);
        this.pendingCandidates.set(payload.senderId, queued);
        return;
      }
      void peer.addIceCandidate(new RTCIceCandidate(payload.signal)).catch(() => undefined);
    });
    this.socket.on('transfer-cancel', ({ targetId }) => { if (targetId) this.closePeer(targetId); });
  }

  async join(roomCode: string): Promise<void> {
    const normalized = normalizeRoomCode(roomCode);
    if (!/^FLUX-[A-Z0-9]{4}$/.test(normalized)) throw new Error('Enter a valid room code such as FLUX-8291.');
    this.roomCode = normalized;
    if (!this.socket.connected) this.socket.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('NearFlux room connection is taking too long.')), 15_000);
      const onState = () => { clearTimeout(timer); this.socket.off('room-error', onError); resolve(); };
      const onError = (payload: { message: string }) => { clearTimeout(timer); this.socket.off('room-state', onState); reject(new Error(payload.message)); };
      this.socket.once('room-state', onState);
      this.socket.once('room-error', onError);
      if (this.socket.connected) this.joinSocket(normalized);
    });
  }

  createRoom(): string {
    const room = generateRoomCode();
    void this.join(room);
    return room;
  }

  private joinSocket(roomCode: string): void {
    this.socket.emit('join-room', { roomCode, device: { name: 'NearFlux Telegram Bridge', type: 'desktop', os: 'Telegram', browser: 'Bot API' } });
  }

  getRoomCode(): string { return this.roomCode; }

  status(): string {
    if (!this.roomCode) return '❌ Not connected to a NearFlux room.';
    return `🔗 NearFlux Status\n\nRoom: ${this.roomCode}\nStatus: ${this.socket.connected ? 'Connected' : 'Reconnecting'}\nTelegram Bridge: ${this.currentDevice ? 'Online' : 'Starting'}\nWeb Peer: ${this.devices.length ? 'Connected' : 'Waiting'}`;
  }

  async sendToWeb(bytes: Buffer, name: string, type: string): Promise<void> {
    if (!this.currentDevice || !this.roomCode) throw new Error('Join a NearFlux room first.');
    const target = this.devices[0];
    if (!target) throw new Error('No NearFlux web peer is connected to this room.');
    if (bytes.length > DEFAULT_MAX_DOWNLOAD_BYTES) throw new Error('File exceeds the Telegram bridge limit.');
    this.pendingOutbound = { bytes, name, type: type || 'application/octet-stream', targetId: target.id };
    this.socket.emit('transfer-request', { roomCode: this.roomCode, senderId: this.currentDevice.id, senderName: this.currentDevice.name, targetId: target.id, files: [{ name, size: bytes.length, type: type || 'application/octet-stream' }] });
    await this.onStatus(`📤 Transfer request sent for ${name}. Accept it in NearFlux to start the direct transfer.`);
  }

  private async startOutboundPeer(targetId: string): Promise<void> {
    const item = this.pendingOutbound;
    if (!item || !this.currentDevice) return;
    const peer = this.createPeer(targetId, true);
    this.peers.set(targetId, peer);
    const channel = peer.createDataChannel('fileTransfer', { ordered: true });
    this.setupChannel(channel, targetId, true, item);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.socket.emit('webrtc-offer', { roomCode: this.roomCode, senderId: this.currentDevice.id, targetId, signal: offer });
    this.pendingOutbound = null;
  }

  private async acceptOffer(senderId: string, offer: any): Promise<void> {
    const peer = this.createPeer(senderId, false);
    this.peers.set(senderId, peer);
    peer.ondatachannel = (event: any) => this.setupChannel(event.channel, senderId, false);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const queued = this.pendingCandidates.get(senderId) || [];
    this.pendingCandidates.delete(senderId);
    for (const candidate of queued) await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (this.currentDevice) this.socket.emit('webrtc-answer', { roomCode: this.roomCode, senderId: this.currentDevice.id, targetId: senderId, signal: answer });
  }

  private createPeer(remoteId: string, initiator: boolean): any {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }], iceCandidatePoolSize: 4 });
    peer.onicecandidate = (event: any) => { if (event.candidate && this.currentDevice) this.socket.emit('webrtc-ice-candidate', { roomCode: this.roomCode, senderId: this.currentDevice.id, targetId: remoteId, signal: serializeIceCandidate(event.candidate) }); };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'closed' || peer.connectionState === 'failed') this.closePeer(remoteId);
    };
    return peer;
  }

  private setupChannel(channel: any, remoteId: string, sender: boolean, outbound?: { bytes: Buffer; name: string; type: string }): void {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      void this.establishDirectReady(channel, remoteId, sender, outbound).catch(async (error) => {
        await this.onStatus(`❌ ${error instanceof Error ? error.message : 'Direct WebRTC readiness failed.'}`);
        this.closePeer(remoteId);
      });
    };
    channel.onmessage = (event: any) => void this.handleMessage(channel, remoteId, event.data);
    channel.onerror = () => void this.onStatus('❌ The direct WebRTC data channel failed.');
    channel.onclose = () => this.closePeer(remoteId);
  }

  private async establishDirectReady(channel: any, remoteId: string, sender: boolean, outbound?: { bytes: Buffer; name: string; type: string }): Promise<void> {
    const type = await this.waitForDirectCandidateType(this.peers.get(remoteId));
    if (type === 'relay' || type === 'unknown') {
      await this.onStatus('❌ No allowed direct WebRTC path was verified.');
      this.closePeer(remoteId);
      return;
    }
    this.directReady.add(remoteId);
    channel.send(JSON.stringify({ type: 'DIRECT_READY' }));
    await this.waitForRemoteReady(remoteId);
    if (sender && outbound && this.peers.has(remoteId)) await this.transmit(channel, outbound);
  }

  private async waitForRemoteReady(remoteId: string): Promise<void> {
    if (this.remoteReady.has(remoteId)) return;

    await new Promise<void>((resolve, reject) => {
      const waiters = this.remoteReadyWaiters.get(remoteId) || [];
      waiters.push({ resolve, reject });
      this.remoteReadyWaiters.set(remoteId, waiters);
    });
  }

  private async waitForDirectCandidateType(peer: any): Promise<'host' | 'srflx' | 'prflx' | 'relay' | 'unknown'> {
    if (!peer) return 'unknown';

    /**
     * Native `wrtc` can open the DataChannel before candidate-pair stats are
     * published. This is intentionally a state wait, not a clock deadline:
     * direct transfers must not be torn down while ICE is still checking.
     */
    for (;;) {
      const type = await this.selectedCandidateType(peer);
      if (type !== 'unknown') return type;
      if (peer.connectionState === 'closed' || peer.connectionState === 'failed' || peer.iceConnectionState === 'closed' || peer.iceConnectionState === 'failed') return 'unknown';
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async selectedCandidateType(peer: any): Promise<'host' | 'srflx' | 'prflx' | 'relay' | 'unknown'> {
    try {
      const stats = await peer.getStats();
      const pairs = new Map<string, any>();
      const candidates = new Map<string, any>();
      let selectedId: string | undefined;
      stats.forEach((entry: any) => {
        if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') selectedId = entry.selectedCandidatePairId;
        if (entry.type === 'candidate-pair') pairs.set(entry.id, entry);
        if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') candidates.set(entry.id, entry);
      });
      let pair = selectedId ? pairs.get(selectedId) : undefined;
      if (!pair) pair = [...pairs.values()].find((candidatePair: any) => candidatePair.state === 'succeeded' && (candidatePair.selected || candidatePair.nominated));
      if (!pair && peer.connectionState === 'connected') pair = [...pairs.values()].find((candidatePair: any) => candidatePair.state === 'succeeded');
      if (!pair) {
        /**
         * `wrtc` can report a connected SCTP/DataChannel transport before it
         * publishes the selected candidate-pair record. This bridge config has
         * STUN only and no TURN servers, so a connected transport at this point
         * is an allowed direct path rather than proof of a relay.
         */
        if (peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
          return 'host';
        }
        return 'unknown';
      }
      const types = [candidates.get(pair.localCandidateId)?.candidateType, candidates.get(pair.remoteCandidateId)?.candidateType].filter(Boolean);
      if (types.includes('relay')) return 'relay';
      if (types.every((value) => value === 'host')) return 'host';
      if (types.includes('srflx')) return 'srflx';
      if (types.includes('prflx')) return 'prflx';
      if (types.includes('host')) return 'host';
      if (peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') return 'host';
    } catch { /* stats may be unavailable during ICE startup */ }
    return 'unknown';
  }

  private async transmit(channel: any, item: { bytes: Buffer; name: string; type: string }): Promise<void> {
    const fileId = `${item.name}-${item.bytes.length}-${Date.now()}`;
    const totalChunks = Math.ceil(item.bytes.length / CHUNK_SIZE);
    const start = { type: 'FILE_START', fileId, fileName: item.name, fileSize: item.bytes.length, fileType: item.type, totalChunks, checksumAlgorithm: 'fnv1a32' };
    channel.send(JSON.stringify(start));
    let checksum = FNV_OFFSET_BASIS;
    for (let offset = 0, index = 0; offset < item.bytes.length; offset += CHUNK_SIZE, index += 1) {
      const chunk = item.bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, item.bytes.length));
      checksum = checksumUpdate(checksum, chunk);
      const acknowledged = this.waitForChunkAck(fileId, index);
      channel.send(JSON.stringify({ type: 'FILE_CHUNK', fileId, chunkIndex: index, byteLength: chunk.byteLength }));
      channel.send(chunk);
      await acknowledged;
    }
    const finalChecksum = checksumString(checksum);
    const verified = this.waitForFileVerification(fileId, finalChecksum);
    channel.send(JSON.stringify({ type: 'FILE_END', fileId, checksum: finalChecksum }));
    await verified;
    await this.onStatus(`✅ ${item.name} sent through NearFlux.`);
  }

  private waitForChunkAck(fileId: string, chunkIndex: number): Promise<void> {
    const key = `${fileId}:${chunkIndex}`;
    return new Promise<void>((resolve, reject) => {
      /** No elapsed-time deadline: peer closure and FILE_ERROR are terminal. */
      this.pendingChunkAcks.set(key, {
        resolve: () => { this.pendingChunkAcks.delete(key); resolve(); },
        reject: (error) => { this.pendingChunkAcks.delete(key); reject(error); },
      });
    });
  }

  private waitForFileVerification(fileId: string, checksum: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      /** No elapsed-time deadline: peer closure and FILE_ERROR are terminal. */
      this.pendingVerifications.set(fileId, {
        checksum,
        resolve: () => { this.pendingVerifications.delete(fileId); resolve(); },
        reject: (error) => { this.pendingVerifications.delete(fileId); reject(error); },
      });
    });
  }

  private async handleMessage(channel: any, remoteId: string, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') {
      const state = [...this.receiveFiles.values()].find((item) => item.pendingChunk);
      if (!state || !state.pendingChunk) return;
      const bytes = Buffer.from(raw as ArrayBuffer);
      if (bytes.length !== state.pendingChunk.byteLength) return;
      state.chunks.push(bytes); state.receivedBytes += bytes.length; state.checksum = checksumUpdate(state.checksum, bytes); state.expectedChunkIndex += 1; const ack = state.pendingChunk; state.pendingChunk = null;
      channel.send(JSON.stringify({ type: 'FILE_CHUNK_ACK', fileId: ack.fileId, chunkIndex: ack.chunkIndex }));
      return;
    }
    let message: any; try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'DIRECT_READY') {
      this.remoteReady.add(remoteId);
      const waiters = this.remoteReadyWaiters.get(remoteId) || [];
      this.remoteReadyWaiters.delete(remoteId);
      waiters.forEach(({ resolve }) => resolve());
      channel.send(JSON.stringify({ type: 'DIRECT_READY_ACK' }));
      return;
    }
    if (message.type === 'DIRECT_READY_ACK') return;
    if (message.type === 'FILE_CHUNK_ACK') {
      const waiter = this.pendingChunkAcks.get(`${message.fileId}:${message.chunkIndex}`);
      waiter?.resolve();
      return;
    }
    if (message.type === 'FILE_VERIFIED') {
      const waiter = this.pendingVerifications.get(message.fileId);
      if (!waiter) return;
      if (waiter.checksum === message.checksum) waiter.resolve();
      else waiter.reject(new Error('Browser reported a different checksum for the transferred file.'));
      return;
    }
    if (message.type === 'FILE_ERROR') {
      const error = new Error(message.error || 'Browser reported a file-transfer error.');
      for (const waiter of this.pendingChunkAcks.values()) waiter.reject(error);
      for (const waiter of this.pendingVerifications.values()) waiter.reject(error);
      return;
    }
    if (message.type === 'FILE_START') {
      this.receiveFiles.set(message.fileId, { fileId: message.fileId, fileName: message.fileName, fileSize: message.fileSize, fileType: message.fileType, chunks: [], receivedBytes: 0, expectedChunkIndex: 0, pendingChunk: null, checksum: FNV_OFFSET_BASIS });
      return;
    }
    if (message.type === 'FILE_CHUNK') {
      const state = this.receiveFiles.get(message.fileId); if (!state || message.chunkIndex !== state.expectedChunkIndex) return;
      state.pendingChunk = message; return;
    }
    if (message.type === 'FILE_END') {
      const state = this.receiveFiles.get(message.fileId); if (!state || state.pendingChunk || state.receivedBytes !== state.fileSize || checksumString(state.checksum) !== message.checksum) { channel.send(JSON.stringify({ type: 'FILE_ERROR', fileId: message.fileId, error: 'File verification failed.' })); return; }
      const bytes = Buffer.concat(state.chunks); this.receiveFiles.delete(message.fileId); channel.send(JSON.stringify({ type: 'FILE_VERIFIED', fileId: message.fileId, checksum: message.checksum })); await this.onReceived(bytes, state.fileName, state.fileType);
      return;
    }
  }

  private closePeer(remoteId: string): void {
    const peer = this.peers.get(remoteId);
    this.peers.delete(remoteId);
    this.pendingCandidates.delete(remoteId);
    this.directReady.delete(remoteId);
    this.remoteReady.delete(remoteId);
    const waiters = this.remoteReadyWaiters.get(remoteId) || [];
    this.remoteReadyWaiters.delete(remoteId);
    const error = new Error('The direct WebRTC peer closed before readiness was confirmed.');
    waiters.forEach(({ reject }) => reject(error));
    for (const waiter of this.pendingChunkAcks.values()) waiter.reject(error);
    for (const waiter of this.pendingVerifications.values()) waiter.reject(error);
    this.pendingChunkAcks.clear();
    this.pendingVerifications.clear();
    try { peer?.close(); } catch {}
  }
  leave(): void { if (this.roomCode && this.socket.connected) this.socket.emit('leave-room', { roomCode: this.roomCode }); for (const id of this.peers.keys()) this.closePeer(id); this.roomCode = ''; this.currentDevice = null; this.devices = []; }
}

export class TelegramBridgeManager {
  private readonly api: TelegramApi;
  private readonly sessions = new Map<number, BridgeSession>();
  private readonly pendingApprovals = new Map<string, { payload: TransferRequestPayload; resolve: (accepted: boolean) => void; timer: NodeJS.Timeout }>();
  private readonly maxFileBytes: number;
  private readonly webAppUrl: string;

  constructor(private readonly config: { token: string; socketUrl: string; webAppUrl: string; webhookSecret?: string }) {
    this.api = new TelegramApi(config.token);
    this.maxFileBytes = Number(process.env.TELEGRAM_MAX_FILE_BYTES || DEFAULT_MAX_DOWNLOAD_BYTES);
    this.webAppUrl = config.webAppUrl;
  }

  register(app: Express): void {
    app.use('/telegram/webhook', (request: Request, response: Response, next) => {
      if (this.config.webhookSecret && request.header('x-telegram-bot-api-secret-token') !== this.config.webhookSecret) return response.status(401).send('Unauthorized');
      next();
    });
    app.post('/telegram/webhook', (request: Request, response: Response) => { response.sendStatus(200); void this.handleUpdate(request.body as TelegramUpdate); });
    void this.configureWebhook();
  }

  private async configureWebhook(): Promise<void> {
    try { await this.api.setMyCommands(); const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.CLIENT_ORIGIN; if (publicUrl) await this.api.setWebhook(`${publicUrl.replace(/\/$/, '')}/telegram/webhook`, this.config.webhookSecret); console.log('[telegram] bot configured'); } catch (error) { console.warn(`[telegram] configuration failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private session(chatId: number): BridgeSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = new BridgeSession(chatId, this.api, this.config.socketUrl, async (text) => { await this.api.sendMessage(chatId, text); }, async (bytes, name, type) => {
        const caption = `📁 File from NearFlux\n${name}\n${bytes.length} bytes`;
        if (type.startsWith('image/')) await this.api.sendPhoto(chatId, bytes, name, caption); else await this.api.sendDocument(chatId, bytes, name, type, caption);
      }, async (payload) => this.requestApproval(chatId, payload));
      this.sessions.set(chatId, session);
    }
    return session;
  }

  private async requestApproval(chatId: number, payload: TransferRequestPayload): Promise<boolean> {
    const token = randomUUID();
    const fileSummary = payload.files.map((file) => `• ${file.name} (${Math.ceil(file.size / 1024)} KB)`).join('\n');
    const decision = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(token);
        resolve(false);
        void this.api.sendMessage(chatId, `⌛ Transfer request from ${payload.senderName} expired.`);
      }, 60_000);
      this.pendingApprovals.set(token, { payload, resolve, timer });
    });
    try {
      await this.api.sendMessage(chatId, `📥 Incoming NearFlux transfer request\n\nFrom: ${payload.senderName}\nRoom: ${payload.roomCode}\n${fileSummary}\n\nDo you want to receive these files?`, {
        inline_keyboard: [[
          { text: '✅ Accept', callback_data: `transfer:accept:${token}` },
          { text: '❌ Decline', callback_data: `transfer:decline:${token}` },
        ]],
      });
    } catch (error) {
      const pending = this.pendingApprovals.get(token);
      if (pending) { clearTimeout(pending.timer); this.pendingApprovals.delete(token); }
      throw error;
    }
    return decision;
  }

  private async resolveApproval(chatId: number, messageId: number | undefined, token: string, accepted: boolean): Promise<void> {
    const pending = this.pendingApprovals.get(token);
    if (!pending) {
      await this.api.sendMessage(chatId, '⌛ This transfer request has expired or was already handled.');
      return;
    }
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(token);
    if (messageId) await this.api.editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] }).catch(() => undefined);
    await this.api.sendMessage(chatId, accepted ? '✅ Transfer accepted. Establishing the direct NearFlux connection…' : '❌ Transfer declined.');
    pending.resolve(accepted);
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    const message = update.message || callback?.message;
    if (!message) return;
    if (callback) {
      await this.api.answerCallbackQuery(callback.id).catch(() => undefined);
      if (callback.data === 'newroom') return this.command(message.chat.id, '/newroom');
      if (callback.data === 'status') return this.command(message.chat.id, '/status');
      if (callback.data === 'leave') return this.command(message.chat.id, '/leave');
      const approval = /^(?:transfer):(accept|decline):([a-f0-9-]+)$/.exec(callback.data || '');
      if (approval) return this.resolveApproval(message.chat.id, callback.message?.message_id, approval[2], approval[1] === 'accept');
    }
    if (message.document || message.video || message.photo) return this.handleFile(message);
    if (message.text) return this.command(message.chat.id, message.text);
  }

  private async command(chatId: number, text: string): Promise<void> {
    const [command, argument] = text.trim().split(/\s+/, 2); const session = this.session(chatId);
    if (command === '/start') return void this.api.sendMessage(chatId, '🌐 Welcome to NearFlux P2P Bridge!\n\nNearFlux lets you transfer files between devices using a secure peer-to-peer connection.\n\n1. Create a room using /newroom.\n2. Join an existing room using /join ROOM-CODE.\n3. Files sent through Telegram are transferred to the connected NearFlux device.\n4. The NearFlux Web App can join the same room.', this.keyboard());
    if (command === '/newroom') { const room = session.createRoom(); return void this.api.sendMessage(chatId, `✅ Room created: ${room}\n\nStatus: Waiting for connection`, this.keyboard(room)); }
    if (command === '/join') { if (!argument) return void this.api.sendMessage(chatId, 'Usage: /join FLUX-8821'); try { await session.join(argument); await this.api.sendMessage(chatId, `✅ Joined Room ${normalizeRoomCode(argument)}!`, this.keyboard(normalizeRoomCode(argument))); } catch (error) { await this.api.sendMessage(chatId, `❌ ${error instanceof Error ? error.message : 'Could not join room.'}`); } return; }
    if (command === '/status') return void this.api.sendMessage(chatId, session.status(), this.keyboard(session.getRoomCode()));
    if (command === '/leave') { const room = session.getRoomCode(); session.leave(); return void this.api.sendMessage(chatId, room ? `🚪 Left room ${room}.` : '❌ No active NearFlux room.'); }
    return void this.api.sendMessage(chatId, 'Use /newroom, /join FLUX-XXXX, /status, or /leave.', this.keyboard(session.getRoomCode()));
  }

  private async handleFile(message: TelegramMessage): Promise<void> {
    const file = message.document || message.video || (message.photo ? message.photo[message.photo.length - 1] : undefined); if (!file) return;
    const type = ('mime_type' in file && file.mime_type) || (message.photo ? 'image/jpeg' : 'application/octet-stream');
    const name = ('file_name' in file && file.file_name) || (message.photo ? `telegram-photo-${Date.now()}.jpg` : `telegram-file-${Date.now()}`);
    try { const bytes = await this.api.getFileBytes(file.file_id, this.maxFileBytes); await this.session(message.chat.id).sendToWeb(bytes, name, type); } catch (error) { await this.api.sendMessage(message.chat.id, `❌ ${error instanceof Error ? error.message : 'Could not transfer the file.'}`); }
  }

  private keyboard(room?: string): unknown { return { inline_keyboard: [[{ text: '🚀 Open Mini App', web_app: { url: webAppUrl(this.webAppUrl, room) } }], [{ text: '✨ Create Secret Room', callback_data: 'newroom' }, { text: '🔍 Status', callback_data: 'status' }], ...(room ? [[{ text: '🚪 Leave Room', callback_data: 'leave' }]] : [])] }; }
}

export function createTelegramBridge(app: Express, port: number): TelegramBridgeManager | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const webApp = process.env.TELEGRAM_WEBAPP_URL?.trim() || process.env.RENDER_EXTERNAL_URL || process.env.CLIENT_ORIGIN;
  if (!token || !webApp) { console.log('[telegram] disabled: set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBAPP_URL/RENDER_EXTERNAL_URL to enable'); return null; }
  const manager = new TelegramBridgeManager({ token, webAppUrl: webApp, socketUrl: process.env.NEARFLUX_INTERNAL_URL || `http://127.0.0.1:${port}`, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET });
  manager.register(app); return manager;
}
