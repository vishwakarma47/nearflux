import { TransferState } from '../types/index.js';
import { socketService } from './socket.js';

const CHUNK_SIZE = 1 * 1024 * 1024;
const DIRECT_CONNECTION_TIMEOUT = 12_000;
const DATA_CHANNEL_HIGH_WATER_MARK = 4 * 1024 * 1024;
const DATA_CHANNEL_LOW_WATER_MARK = 1 * 1024 * 1024;
const QUEUE_WAIT_TIMEOUT = 30_000;

type DirectCandidateType = 'host' | 'srflx' | 'relay' | 'unknown';

type CandidatePairLike = {
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId: string;
  remoteCandidateId: string;
};

type CandidateLike = { candidateType?: string };

type FileStartMessage = {
  type: 'FILE_START';
  fileId: string;
  fileName: string;
  relativePath?: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  checksumAlgorithm: 'fnv1a32';
};

type FileChunkMessage = {
  type: 'FILE_CHUNK';
  fileId: string;
  chunkIndex: number;
  byteLength: number;
};

type FileEndMessage = {
  type: 'FILE_END';
  fileId: string;
  checksum: string;
};

type DirectReadyMessage = { type: 'DIRECT_READY' };
type FileChunkAckMessage = { type: 'FILE_CHUNK_ACK'; fileId: string; chunkIndex: number };

type ReceiveFile = FileStartMessage & {
  receivedChunks: Map<number, ArrayBuffer>;
  receivedBytes: number;
  checksum: number;
  expectedChunkIndex: number;
};

export interface TransferProgressCallback {
  (state: Partial<TransferState>): void;
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isInitiator = false;
  private remotePeerId = '';
  private localPeerId = '';
  private roomCode = '';
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private currentFile: ReceiveFile | null = null;
  private startTime = 0;
  private lastBytesCount = 0;
  private lastSpeedCheckTime = 0;
  private onProgressCallback: TransferProgressCallback | null = null;
  private onChannelOpenCallback: (() => void) | null = null;
  private channelOpened = false;
  private directConnectionVerified = false;
  private directCandidateType: DirectCandidateType = 'unknown';
  private remoteReady = false;
  private remoteReadyWaiters: Array<() => void> = [];
  private connectionTimeoutId: number | null = null;

  constructor(localPeerId: string, remotePeerId: string, isInitiator: boolean, roomCode: string) {
    this.localPeerId = localPeerId;
    this.remotePeerId = remotePeerId;
    this.isInitiator = isInitiator;
    this.roomCode = roomCode;
  }

  public setProgressCallback(callback: TransferProgressCallback): void {
    this.onProgressCallback = callback;
  }

  public onChannelOpen(callback: () => void): void {
    if (this.channelOpened) callback();
    else this.onChannelOpenCallback = callback;
  }

  public isChannelOpen(): boolean {
    return this.channelOpened;
  }

  public initialize(): RTCPeerConnection {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
      iceTransportPolicy: 'all',
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (event.candidate.type === 'relay' || event.candidate.candidate.includes(' typ relay ')) {
        this.failDirectConnection('A relay ICE candidate was detected. Strict direct P2P transfer is unavailable.');
        return;
      }
      socketService.sendIceCandidate({
        roomCode: this.roomCode,
        senderId: this.localPeerId,
        targetId: this.remotePeerId,
        signal: event.candidate.toJSON(),
      });
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      if (state === 'failed' || state === 'closed') {
        this.failDirectConnection('The devices could not establish a direct P2P connection.');
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'failed' || state === 'closed') {
        this.failDirectConnection('The direct P2P connection was interrupted.');
      }
    };

    this.connectionTimeoutId = window.setTimeout(() => {
      if (!this.directConnectionVerified) this.failDirectConnection('Direct P2P connection timed out. No relay fallback is available.');
    }, DIRECT_CONNECTION_TIMEOUT + 3_000);

    if (this.isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', { ordered: true });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }

    return this.peerConnection;
  }

  public async createOffer(): Promise<void> {
    if (!this.peerConnection) return;
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    socketService.sendWebRTCOffer({
      roomCode: this.roomCode,
      senderId: this.localPeerId,
      targetId: this.remotePeerId,
      signal: offer,
    });
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await this.processPendingCandidates();
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    socketService.sendWebRTCAnswer({
      roomCode: this.roomCode,
      senderId: this.localPeerId,
      targetId: this.remotePeerId,
      signal: answer,
    });
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await this.processPendingCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (isRelayCandidate(candidate)) {
      this.failDirectConnection('A relay ICE candidate was received. Strict direct P2P transfer is unavailable.');
      return;
    }
    if (!this.peerConnection) return;
    if (!this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      this.failDirectConnection('Unable to add a direct ICE candidate. Transfer cancelled safely.');
    }
  }

  public async verifyDirectConnection(timeoutMs = DIRECT_CONNECTION_TIMEOUT): Promise<{ type: 'host' | 'srflx' }> {
    if (this.directConnectionVerified) return { type: this.directCandidateType as 'host' | 'srflx' };
    if (!this.peerConnection || !this.dataChannel) throw new Error('WebRTC connection is not initialized.');

    this.onProgressCallback?.({ status: 'checking_direct_connection', serverRole: 'signaling-only' });
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.peerConnection.connectionState === 'failed' || this.peerConnection.iceConnectionState === 'failed') {
        break;
      }
      const selected = await this.getSelectedCandidateType();
      if (selected === 'relay') {
        this.failDirectConnection('A relay connection was selected. Transfer cancelled because relay is disabled.');
        throw new Error('Relay connection rejected.');
      }
      if ((selected === 'host' || selected === 'srflx') && this.dataChannel.readyState === 'open') {
        this.directConnectionVerified = true;
        this.directCandidateType = selected;
        await this.sendData(JSON.stringify({ type: 'DIRECT_READY' } satisfies DirectReadyMessage));
        this.onProgressCallback?.({
          status: 'ready_for_transfer',
          connectionType: selected,
          serverRole: 'signaling-only',
        });
        return { type: selected };
      }
      await wait(150);
    }

    this.failDirectConnection('Direct P2P connection failed. No relay or server fallback is available.');
    throw new Error('Direct P2P connection unavailable.');
  }

  private async getSelectedCandidateType(): Promise<DirectCandidateType> {
    if (!this.peerConnection) return 'unknown';
    const stats = await this.peerConnection.getStats();
    let selectedPair: CandidatePairLike | undefined;
    const candidates = new Map<string, CandidateLike>();

    stats.forEach((report) => {
      if (report.type === 'candidate-pair' && (report as RTCIceCandidatePairStats).state === 'succeeded') {
        const pair = report as unknown as CandidatePairLike;
        if (pair.selected || pair.nominated) selectedPair = pair;
      }
      if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
        candidates.set(report.id, report as unknown as CandidateLike);
      }
    });

    if (!selectedPair) return 'unknown';
    const local = candidates.get(selectedPair.localCandidateId);
    const remote = candidates.get(selectedPair.remoteCandidateId);
    const localType = local?.candidateType as DirectCandidateType | undefined;
    const remoteType = remote?.candidateType as DirectCandidateType | undefined;
    if (localType === 'relay' || remoteType === 'relay') return 'relay';
    if (localType === 'host' || remoteType === 'host') return 'host';
    if (localType === 'srflx' || remoteType === 'srflx') return 'srflx';
    return 'unknown';
  }

  private async processPendingCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) await this.addIceCandidate(candidate);
    }
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER_MARK;
    channel.onopen = () => {
      this.channelOpened = true;
      this.onProgressCallback?.({ status: 'checking_direct_connection', serverRole: 'signaling-only' });
      this.onChannelOpenCallback?.();
    };
    channel.onmessage = (event) => this.handleIncomingData(event.data);
    channel.onerror = () => this.failDirectConnection('The direct data channel encountered an error.');
    channel.onclose = () => {
      if (!this.directConnectionVerified) this.failDirectConnection('The direct data channel closed before verification.');
    };
  }

  public async sendFiles(files: Array<{ file: File; relativePath?: string }>): Promise<void> {
    await this.verifyDirectConnection();
    await this.waitForRemoteReady();
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') throw new Error('Direct data channel is not open.');

    this.startTime = Date.now();
    this.lastSpeedCheckTime = Date.now();
    this.lastBytesCount = 0;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const { file, relativePath } = files[fileIndex];
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const fileId = `${file.name}-${file.size}-${Date.now()}-${fileIndex}`;
      const startMessage: FileStartMessage = {
        type: 'FILE_START',
        fileId,
        fileName: file.name,
        relativePath,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        totalChunks,
        checksumAlgorithm: 'fnv1a32',
      };
      await this.sendData(JSON.stringify(startMessage));

      let offset = 0;
      let chunkIndex = 0;
      let checksum = 0x811c9dc5;
      while (offset < file.size) {
        const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        const chunkMessage: FileChunkMessage = {
          type: 'FILE_CHUNK',
          fileId,
          chunkIndex,
          byteLength: buffer.byteLength,
        };
        await this.sendData(JSON.stringify(chunkMessage));
        await this.sendData(buffer);
        checksum = updateChecksum(checksum, new Uint8Array(buffer));
        offset += buffer.byteLength;
        chunkIndex += 1;
        this.updateStats(offset, file.size, file.name, fileIndex + 1, files.length);
      }

      const endMessage: FileEndMessage = {
        type: 'FILE_END',
        fileId,
        checksum: checksumToString(checksum),
      };
      await this.sendData(JSON.stringify(endMessage));
    }

    this.onProgressCallback?.({ status: 'completed', progress: 100, timeRemaining: 0, connectionType: this.directCandidateType });
  }

  public handleIncomingData(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      this.handleControlMessage(data);
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;
    if (!this.directConnectionVerified) {
      this.failTransfer('File data arrived before direct P2P verification.');
      return;
    }
    if (!this.currentFile) return;

    const pendingIndex = this.currentFile.expectedChunkIndex;
    if (this.currentFile.receivedChunks.has(pendingIndex)) {
      this.failTransfer('Duplicate or out-of-order chunk received.');
      return;
    }
    this.currentFile.receivedChunks.set(pendingIndex, data);
    this.currentFile.receivedBytes += data.byteLength;
    this.currentFile.checksum = updateChecksum(this.currentFile.checksum, new Uint8Array(data));
    this.currentFile.expectedChunkIndex += 1;
    this.updateStats(this.currentFile.receivedBytes, this.currentFile.fileSize, this.currentFile.fileName);
  }

  private handleControlMessage(data: string): void {
    try {
      const parsed = JSON.parse(data) as FileStartMessage | FileChunkMessage | FileEndMessage | DirectReadyMessage;
      if (parsed.type === 'DIRECT_READY') {
        this.remoteReady = true;
        this.remoteReadyWaiters.splice(0).forEach((resolve) => resolve());
      } else if (parsed.type === 'FILE_START') {
        this.currentFile = {
          ...parsed,
          receivedChunks: new Map(),
          receivedBytes: 0,
          checksum: 0x811c9dc5,
          expectedChunkIndex: 0,
        };
        this.startTime = Date.now();
        this.lastSpeedCheckTime = Date.now();
        this.lastBytesCount = 0;
        this.onProgressCallback?.({
          status: 'transferring',
          currentFileName: parsed.relativePath || parsed.fileName,
          fileSize: parsed.fileSize,
          transferredBytes: 0,
          progress: 0,
          serverRole: 'signaling-only',
        });
      } else if (parsed.type === 'FILE_CHUNK') {
        if (!this.currentFile || this.currentFile.fileId !== parsed.fileId || parsed.chunkIndex !== this.currentFile.expectedChunkIndex) {
          this.failTransfer('Invalid or missing file chunk metadata.');
        }
      } else if (parsed.type === 'FILE_END') {
        this.finishReceivedFile(parsed);
      }
    } catch {
      this.failTransfer('Invalid transfer metadata received.');
    }
  }

  private finishReceivedFile(message: FileEndMessage): void {
    const current = this.currentFile;
    if (!current || current.fileId !== message.fileId) return;
    const valid = current.receivedBytes === current.fileSize && checksumToString(current.checksum) === message.checksum;
    if (!valid) {
      this.failTransfer('File integrity check failed. The transfer was discarded.');
      return;
    }
    const chunks = Array.from(current.receivedChunks.entries()).sort(([a], [b]) => a - b).map(([, chunk]) => chunk);
    this.downloadFile(chunks, current.relativePath || current.fileName, current.fileType);
    this.currentFile = null;
    this.onProgressCallback?.({ status: 'completed', progress: 100, timeRemaining: 0, connectionType: this.directCandidateType });
  }

  private async sendData(data: string | ArrayBuffer): Promise<void> {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open') throw new Error('Direct data channel is not open.');
    const byteLength = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    const deadline = Date.now() + QUEUE_WAIT_TIMEOUT;
    while (channel.bufferedAmount + byteLength > DATA_CHANNEL_HIGH_WATER_MARK) {
      if (Date.now() >= deadline) throw new Error('The direct data channel stayed full for too long.');
      await new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          channel.removeEventListener('bufferedamountlow', settle);
          resolve();
        };
        const timer = window.setTimeout(settle, 120);
        channel.addEventListener('bufferedamountlow', settle, { once: true });
      });
    }
    try {
      if (typeof data === 'string') channel.send(data);
      else channel.send(data);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'The browser rejected the direct data channel payload.');
    }
  }

  private async waitForRemoteReady(): Promise<void> {
    if (this.remoteReady) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('The recipient did not verify a direct P2P connection.')), 5_000);
      this.remoteReadyWaiters.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
  }

  private updateStats(currentTransferred: number, totalSize: number, fileName: string, currentFileIndex = 1, totalFiles = 1): void {
    const now = Date.now();
    const timeDelta = (now - this.lastSpeedCheckTime) / 1000;
    let speed = 0;
    if (timeDelta > 0.3) {
      speed = (currentTransferred - this.lastBytesCount) / timeDelta;
      this.lastSpeedCheckTime = now;
      this.lastBytesCount = currentTransferred;
    }
    const remainingBytes = totalSize - currentTransferred;
    this.onProgressCallback?.({
      currentFileName: fileName,
      currentFileIndex,
      totalFiles,
      fileSize: totalSize,
      transferredBytes: currentTransferred,
      progress: Math.min(100, (currentTransferred / totalSize) * 100),
      speed,
      timeRemaining: speed > 0 ? remainingBytes / speed : 0,
      connectionType: this.directCandidateType,
      serverRole: 'signaling-only',
    });
  }

  private downloadFile(chunks: ArrayBuffer[], fileName: string, fileType: string): void {
    const blob = new Blob(chunks, { type: fileType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName.split('/').pop() || fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  private failDirectConnection(message: string): void {
    if (this.directConnectionVerified) return;
    this.directConnectionVerified = false;
    this.onProgressCallback?.({
      status: 'failed',
      error: message,
      connectionType: this.directCandidateType,
      serverRole: 'signaling-only',
    });
    this.close();
  }

  private failTransfer(message: string): void {
    this.onProgressCallback?.({ status: 'failed', error: message, serverRole: 'signaling-only' });
    this.close();
  }

  public close(): void {
    if (this.connectionTimeoutId !== null) {
      window.clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    this.channelOpened = false;
    this.currentFile = null;
    this.remoteReady = false;
    this.remoteReadyWaiters = [];
  }
}

function isRelayCandidate(candidate: RTCIceCandidateInit): boolean {
  return Boolean(candidate.candidate?.includes(' typ relay '));
}

function updateChecksum(current: number, bytes: Uint8Array): number {
  let checksum = current >>> 0;
  for (const byte of bytes) {
    checksum ^= byte;
    checksum = Math.imul(checksum, 0x01000193) >>> 0;
  }
  return checksum >>> 0;
}

function checksumToString(checksum: number): string {
  return (checksum >>> 0).toString(16).padStart(8, '0');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
