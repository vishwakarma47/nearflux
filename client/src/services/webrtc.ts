import { TransferState } from '../types/index.js';
import { socketService } from './socket.js';

const CHUNK_SIZE = 512 * 1024;

const DIRECT_CONNECTION_TIMEOUT = 15_000;

const DATA_CHANNEL_HIGH_WATER_MARK = 4 * 1024 * 1024;
const DATA_CHANNEL_LOW_WATER_MARK = 1 * 1024 * 1024;

const QUEUE_WAIT_TIMEOUT = 30_000;
const TRANSFER_STALL_TIMEOUT = 60_000;
const TRANSFER_WATCHDOG_INTERVAL = 5_000;

const DIRECT_READY_TIMEOUT = 8_000;
const FILE_VERIFICATION_TIMEOUT = 30_000;
const CHUNK_ACK_TIMEOUT = 30_000;

type DirectCandidateType = 'host' | 'srflx' | 'relay' | 'unknown';

type CandidatePairLike = {
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId: string;
  remoteCandidateId: string;
};

type CandidateLike = {
  candidateType?: string;
};

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

type DirectReadyMessage = {
  type: 'DIRECT_READY';
};

type DirectReadyAckMessage = {
  type: 'DIRECT_READY_ACK';
};

type DirectVerifiedMessage = {
  type: 'DIRECT_VERIFIED';
};

type FileChunkAckMessage = {
  type: 'FILE_CHUNK_ACK';
  fileId: string;
  chunkIndex: number;
};

type FileVerifiedMessage = {
  type: 'FILE_VERIFIED';
  fileId: string;
  checksum: string;
};

type FileErrorMessage = {
  type: 'FILE_ERROR';
  fileId?: string;
  error: string;
};

type ControlMessage =
  | FileStartMessage
  | FileChunkMessage
  | FileEndMessage
  | DirectReadyMessage
  | DirectReadyAckMessage
  | DirectVerifiedMessage
  | FileChunkAckMessage
  | FileVerifiedMessage
  | FileErrorMessage;

type PendingChunkAck = {
  fileId: string;
  chunkIndex: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type PendingFileVerification = {
  fileId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type ReceiveFile = FileStartMessage & {
  receivedChunks: Map<number, ArrayBuffer>;
  receivedBytes: number;
  checksum: number;
  expectedChunkIndex: number;
  pendingChunkMetadata: FileChunkMessage | null;
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

  /**
   * True only after:
   *
   * Sender -> DIRECT_READY
   * Receiver -> DIRECT_READY_ACK
   * Sender -> DIRECT_VERIFIED
   */
  private directConnectionVerified = false;

  private directCandidateType: DirectCandidateType = 'unknown';

  private remoteReady = false;

  private remoteReadyWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  private connectionTimeoutId: number | null = null;

  private transferWatchdogId: number | null = null;

  private lastTransferActivity = 0;

  private pendingChunkAcks = new Map<string, PendingChunkAck>();

  private pendingFileVerification: PendingFileVerification | null = null;

  private pendingDirectVerification: {
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null = null;

  private receivedDirectReady = false;

  private intentionallyClosing = false;

  constructor(
    localPeerId: string,
    remotePeerId: string,
    isInitiator: boolean,
    roomCode: string
  ) {
    this.localPeerId = localPeerId;
    this.remotePeerId = remotePeerId;
    this.isInitiator = isInitiator;
    this.roomCode = roomCode;
  }

  public setProgressCallback(callback: TransferProgressCallback): void {
    this.onProgressCallback = callback;
  }

  public onChannelOpen(callback: () => void): void {
    if (this.channelOpened) {
      callback();
    } else {
      this.onChannelOpenCallback = callback;
    }
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

      /**
       * Relay candidates may be discovered, but we verify
       * the selected candidate pair and reject relay usage.
       */
      iceTransportPolicy: 'all',
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;

      /**
       * IMPORTANT:
       *
       * Do NOT reject relay candidates here.
       *
       * A relay candidate being discovered does NOT mean
       * that the actual connection is using TURN.
       *
       * We check the selected candidate pair later.
       */
      socketService.sendIceCandidate({
        roomCode: this.roomCode,
        senderId: this.localPeerId,
        targetId: this.remotePeerId,
        signal: event.candidate.toJSON(),
      });
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;

      if (state === 'failed') {
        this.failConnection(
          'ICE connection failed. A direct P2P connection could not be established.'
        );
      } else if (state === 'closed') {
        this.failConnection(
          'The ICE connection was closed.'
        );
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;

      if (state === 'failed') {
        this.failConnection(
          'The WebRTC connection failed.'
        );
      } else if (state === 'closed' && !this.intentionallyClosing) {
        this.failConnection(
          'The WebRTC connection was closed unexpectedly.'
        );
      }
    };

    this.connectionTimeoutId = window.setTimeout(() => {
      if (!this.directConnectionVerified) {
        this.failConnection(
          'Direct P2P connection timed out. No relay or server-upload fallback is configured.'
        );
      }
    }, DIRECT_CONNECTION_TIMEOUT);

    if (this.isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel(
        'fileTransfer',
        {
          ordered: true,
        }
      );

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
    if (!this.peerConnection) {
      throw new Error('WebRTC connection is not initialized.');
    }

    const offer = await this.peerConnection.createOffer();

    await this.peerConnection.setLocalDescription(offer);

    socketService.sendWebRTCOffer({
      roomCode: this.roomCode,
      senderId: this.localPeerId,
      targetId: this.remotePeerId,
      signal: offer,
    });
  }

  public async handleOffer(
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('WebRTC connection is not initialized.');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer)
    );

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

  public async handleAnswer(
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('WebRTC connection is not initialized.');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );

    await this.processPendingCandidates();
  }

  public async addIceCandidate(
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    if (!this.peerConnection) return;

    if (!this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch {
      this.failConnection(
        'Unable to add the received ICE candidate.'
      );
    }
  }

  /**
   * Performs actual direct connection verification.
   *
   * We do NOT consider the connection verified merely because
   * the DataChannel is open.
   *
   * We also verify the selected ICE candidate pair.
   */
  public async verifyDirectConnection(
    timeoutMs = DIRECT_CONNECTION_TIMEOUT
  ): Promise<{ type: 'host' | 'srflx' }> {
    if (this.directConnectionVerified) {
      return {
        type: this.directCandidateType as 'host' | 'srflx',
      };
    }

    if (!this.peerConnection || !this.dataChannel) {
      throw new Error(
        'WebRTC connection is not initialized.'
      );
    }

    this.onProgressCallback?.({
      status: 'checking_direct_connection',
      serverRole: 'signaling-only',
    });

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!this.peerConnection || !this.dataChannel) {
        throw new Error('WebRTC connection was closed.');
      }

      const connectionState =
        this.peerConnection.connectionState;

      const iceState =
        this.peerConnection.iceConnectionState;

      if (
        connectionState === 'failed' ||
        connectionState === 'closed' ||
        iceState === 'failed' ||
        iceState === 'closed'
      ) {
        throw new Error(
          'The direct WebRTC connection failed.'
        );
      }

      const selected =
        await this.getSelectedCandidateType();

      if (selected === 'relay') {
        this.failConnection(
          'A relay candidate pair was selected. Strict direct P2P transfer is disabled.'
        );

        throw new Error('Relay connection rejected.');
      }

      if (
        (selected === 'host' || selected === 'srflx') &&
        this.dataChannel.readyState === 'open'
      ) {
        this.directCandidateType = selected;

        await this.performDirectHandshake();

        this.directConnectionVerified = true;

        if (this.connectionTimeoutId !== null) {
          window.clearTimeout(this.connectionTimeoutId);
          this.connectionTimeoutId = null;
        }

        this.onProgressCallback?.({
          status: 'ready_for_transfer',
          connectionType: selected,
          serverRole: 'signaling-only',
        });

        return {
          type: selected,
        };
      }

      await wait(150);
    }

    this.failConnection(
      'Direct P2P connection failed. No relay or server-upload fallback is configured.'
    );

    throw new Error(
      'Direct P2P connection unavailable.'
    );
  }

  /**
   * Direct handshake:
   *
   * Sender -> DIRECT_READY
   * Receiver -> DIRECT_READY_ACK
   * Sender -> DIRECT_VERIFIED
   */
  private async performDirectHandshake(): Promise<void> {
    if (!this.dataChannel) {
      throw new Error('DataChannel is not available.');
    }

    /**
     * Receiver waits for DIRECT_READY.
     *
     * Initiator sends it.
     */
    if (this.isInitiator) {
      await this.sendData(
        JSON.stringify({
          type: 'DIRECT_READY',
        } satisfies DirectReadyMessage)
      );

      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          this.pendingDirectVerification = null;

          reject(
            new Error(
              'The recipient did not acknowledge the direct P2P connection.'
            )
          );
        }, DIRECT_READY_TIMEOUT);

        this.pendingDirectVerification = {
          resolve,
          reject,
          timeoutId,
        };
      });

      await this.sendData(
        JSON.stringify({
          type: 'DIRECT_VERIFIED',
        } satisfies DirectVerifiedMessage)
      );
    } else {
      /**
       * Receiver doesn't initiate the handshake.
       *
       * It waits for DIRECT_READY and responds from
       * handleControlMessage().
       */
      await new Promise<void>((resolve, reject) => {
        const deadline = window.setTimeout(() => {
          const index = this.remoteReadyWaiters.findIndex(
            (item) => item.resolve === resolve
          );

          if (index >= 0) {
            this.remoteReadyWaiters.splice(index, 1);
          }

          reject(
            new Error(
              'The sender did not start direct P2P verification.'
            )
          );
        }, DIRECT_READY_TIMEOUT);

        this.remoteReadyWaiters.push({
          resolve: () => {
            window.clearTimeout(deadline);
            resolve();
          },
          reject,
        });
      });
    }
  }

  private async getSelectedCandidateType(): Promise<DirectCandidateType> {
    if (!this.peerConnection) {
      return 'unknown';
    }

    const stats = await this.peerConnection.getStats();

    let selectedPair: CandidatePairLike | undefined;

    const candidates = new Map<string, CandidateLike>();

    stats.forEach((report) => {
      if (
        report.type === 'candidate-pair' &&
        (report as RTCIceCandidatePairStats).state === 'succeeded'
      ) {
        const pair =
          report as unknown as CandidatePairLike;

        if (
          pair.selected ||
          pair.nominated
        ) {
          selectedPair = pair;
        }
      }

      if (
        report.type === 'local-candidate' ||
        report.type === 'remote-candidate'
      ) {
        candidates.set(
          report.id,
          report as unknown as CandidateLike
        );
      }
    });

    if (!selectedPair) {
      return 'unknown';
    }

    const local = candidates.get(
      selectedPair.localCandidateId
    );

    const remote = candidates.get(
      selectedPair.remoteCandidateId
    );

    const localType =
      local?.candidateType as DirectCandidateType | undefined;

    const remoteType =
      remote?.candidateType as DirectCandidateType | undefined;

    if (
      localType === 'relay' ||
      remoteType === 'relay'
    ) {
      return 'relay';
    }

    if (
      localType === 'host' ||
      remoteType === 'host'
    ) {
      return 'host';
    }

    if (
      localType === 'srflx' ||
      remoteType === 'srflx'
    ) {
      return 'srflx';
    }

    return 'unknown';
  }

  private async processPendingCandidates(): Promise<void> {
    if (
      !this.peerConnection ||
      !this.peerConnection.remoteDescription
    ) {
      return;
    }

    while (this.pendingCandidates.length > 0) {
      const candidate =
        this.pendingCandidates.shift();

      if (candidate) {
        await this.addIceCandidate(candidate);
      }
    }
  }

  private startTransferWatchdog(): void {
    this.stopTransferWatchdog();

    this.lastTransferActivity = Date.now();

    this.transferWatchdogId = window.setInterval(() => {
      if (!this.peerConnection || !this.dataChannel) {
        return;
      }

      if (
        this.peerConnection.connectionState === 'connected' &&
        this.dataChannel.readyState === 'open'
      ) {
        if (
          Date.now() - this.lastTransferActivity >
          TRANSFER_STALL_TIMEOUT
        ) {
          this.stopTransferWatchdog();

          this.failTransfer(
            'Transfer stalled. The direct connection may have dropped.'
          );
        }
      }
    }, TRANSFER_WATCHDOG_INTERVAL);
  }

  private resetTransferWatchdog(): void {
    if (this.transferWatchdogId !== null) {
      this.lastTransferActivity = Date.now();
    }
  }

  private stopTransferWatchdog(): void {
    if (this.transferWatchdogId !== null) {
      window.clearInterval(
        this.transferWatchdogId
      );

      this.transferWatchdogId = null;
    }

    this.lastTransferActivity = 0;
  }

  private setupDataChannel(
    channel: RTCDataChannel
  ): void {
    channel.binaryType = 'arraybuffer';

    channel.bufferedAmountLowThreshold =
      DATA_CHANNEL_LOW_WATER_MARK;

    channel.onopen = () => {
      this.channelOpened = true;

      this.onProgressCallback?.({
        status: 'checking_direct_connection',
        serverRole: 'signaling-only',
      });

      this.onChannelOpenCallback?.();
    };

    channel.onmessage = (event) => {
      this.handleIncomingData(event.data);
    };

    channel.onerror = () => {
      if (!this.intentionallyClosing) {
        this.failConnection(
          'The direct data channel encountered an error.'
        );
      }
    };

    channel.onclose = () => {
      this.channelOpened = false;

      /**
       * Ignore close events generated by our own cleanup.
       */
      if (this.intentionallyClosing) {
        return;
      }

      /**
       * IMPORTANT:
       *
       * Do not automatically use the old:
       *
       * "closed before verification"
       *
       * logic.
       *
       * The close event can race with the verification
       * handshake.
       */
      if (!this.directConnectionVerified) {
        this.rejectPendingOperations(
          new Error(
            'The direct data channel closed before P2P verification completed.'
          )
        );

        this.failConnection(
          'The direct data channel closed before direct P2P verification completed.'
        );

        return;
      }

      this.failTransfer(
        'The direct data channel closed during file transfer.'
      );
    };
  }

  public async sendFiles(
    files: Array<{
      file: File;
      relativePath?: string;
    }>
  ): Promise<void> {
    await this.verifyDirectConnection();

    /**
     * Initiator performs the handshake.
     *
     * Receiver has already responded with DIRECT_READY_ACK.
     */
    if (!this.isInitiator) {
      await this.waitForRemoteReady();
    }

    if (
      !this.dataChannel ||
      this.dataChannel.readyState !== 'open'
    ) {
      throw new Error(
        'Direct data channel is not open.'
      );
    }

    this.startTime = Date.now();
    this.lastSpeedCheckTime = Date.now();
    this.lastBytesCount = 0;

    this.startTransferWatchdog();

    try {
      for (
        let fileIndex = 0;
        fileIndex < files.length;
        fileIndex += 1
      ) {
        const {
          file,
          relativePath,
        } = files[fileIndex];

        const totalChunks =
          Math.ceil(file.size / CHUNK_SIZE);

        const fileId =
          `${file.name}-${file.size}-${Date.now()}-${fileIndex}`;

        const startMessage: FileStartMessage = {
          type: 'FILE_START',
          fileId,
          fileName: file.name,
          relativePath,
          fileSize: file.size,
          fileType:
            file.type ||
            'application/octet-stream',
          totalChunks,
          checksumAlgorithm: 'fnv1a32',
        };

        await this.sendData(
          JSON.stringify(startMessage)
        );

        let offset = 0;
        let chunkIndex = 0;

        let checksum = 0x811c9dc5;

        while (offset < file.size) {
          if (
            !this.dataChannel ||
            this.dataChannel.readyState !== 'open'
          ) {
            throw new Error(
              'The direct data channel closed during transfer.'
            );
          }

          const buffer =
            await file
              .slice(
                offset,
                offset + CHUNK_SIZE
              )
              .arrayBuffer();

          const chunkMessage: FileChunkMessage = {
            type: 'FILE_CHUNK',
            fileId,
            chunkIndex,
            byteLength: buffer.byteLength,
          };

          /**
           * Send metadata first.
           */
          await this.sendData(
            JSON.stringify(chunkMessage)
          );

          /**
           * Then send the binary chunk.
           */
          await this.sendData(buffer);

          checksum = updateChecksum(
            checksum,
            new Uint8Array(buffer)
          );

          /**
           * Wait for receiver-level acknowledgement.
           *
           * This is the important reliability improvement.
           */
          await this.waitForChunkAck(
            fileId,
            chunkIndex
          );

          offset += buffer.byteLength;
          chunkIndex += 1;

          this.updateStats(
            offset,
            file.size,
            file.name,
            fileIndex + 1,
            files.length
          );
        }

        const endMessage: FileEndMessage = {
          type: 'FILE_END',
          fileId,
          checksum:
            checksumToString(checksum),
        };

        await this.sendData(
          JSON.stringify(endMessage)
        );

        /**
         * Wait until receiver reconstructs the file,
         * verifies checksum and confirms it.
         */
        await this.waitForFileVerification(
          fileId
        );
      }

      this.stopTransferWatchdog();

      this.onProgressCallback?.({
        status: 'completed',
        progress: 100,
        timeRemaining: 0,
        connectionType:
          this.directCandidateType,
      });
    } catch (error) {
      this.failTransfer(
        error instanceof Error
          ? error.message
          : 'File transfer failed.'
      );

      throw error;
    }
  }

  public handleIncomingData(
    data: string | ArrayBuffer
  ): void {
    if (typeof data === 'string') {
      this.handleControlMessage(data);
      return;
    }

    if (!(data instanceof ArrayBuffer)) {
      return;
    }

    this.resetTransferWatchdog();

    if (!this.directConnectionVerified) {
      this.failTransfer(
        'File data arrived before direct P2P verification.'
      );

      return;
    }

    if (!this.currentFile) {
      this.failTransfer(
        'Received file data without an active file transfer.'
      );

      return;
    }

    const metadata =
      this.currentFile.pendingChunkMetadata;

    if (!metadata) {
      this.failTransfer(
        'Received binary data without FILE_CHUNK metadata.'
      );

      return;
    }

    if (
      metadata.fileId !==
      this.currentFile.fileId
    ) {
      this.failTransfer(
        'Received chunk belongs to an unexpected file.'
      );

      return;
    }

    if (
      metadata.chunkIndex !==
      this.currentFile.expectedChunkIndex
    ) {
      this.failTransfer(
        'Duplicate or out-of-order chunk received.'
      );

      return;
    }

    if (
      metadata.byteLength !==
      data.byteLength
    ) {
      this.failTransfer(
        'Received chunk size does not match metadata.'
      );

      return;
    }

    this.currentFile.receivedChunks.set(
      metadata.chunkIndex,
      data
    );

    this.currentFile.receivedBytes +=
      data.byteLength;

    this.currentFile.checksum =
      updateChecksum(
        this.currentFile.checksum,
        new Uint8Array(data)
      );

    this.currentFile.expectedChunkIndex += 1;

    this.currentFile.pendingChunkMetadata =
      null;

    /**
     * Application-level ACK.
     */
    void this.sendData(
      JSON.stringify({
        type: 'FILE_CHUNK_ACK',
        fileId: this.currentFile.fileId,
        chunkIndex: metadata.chunkIndex,
      } satisfies FileChunkAckMessage)
    ).catch(() => {
      this.failTransfer(
        'Failed to acknowledge the received chunk.'
      );
    });

    this.updateStats(
      this.currentFile.receivedBytes,
      this.currentFile.fileSize,
      this.currentFile.fileName
    );
  }

  private handleControlMessage(
    data: string
  ): void {
    let parsed: ControlMessage;

    try {
      parsed = JSON.parse(data) as ControlMessage;
    } catch {
      this.failTransfer(
        'Invalid transfer metadata received.'
      );

      return;
    }

    this.resetTransferWatchdog();

    switch (parsed.type) {
      case 'DIRECT_READY': {
        this.receivedDirectReady = true;
        this.remoteReady = true;

        /**
         * Receiver responds immediately.
         */
        void this.sendData(
          JSON.stringify({
            type: 'DIRECT_READY_ACK',
          } satisfies DirectReadyAckMessage)
        ).catch(() => {
          this.failConnection(
            'Failed to acknowledge direct P2P verification.'
          );
        });

        this.remoteReadyWaiters
          .splice(0)
          .forEach((waiter) => {
            waiter.resolve();
          });

        break;
      }

      case 'DIRECT_READY_ACK': {
        if (
          this.pendingDirectVerification
        ) {
          const pending =
            this.pendingDirectVerification;

          this.pendingDirectVerification =
            null;

          window.clearTimeout(
            pending.timeoutId
          );

          pending.resolve();
        }

        break;
      }

      case 'DIRECT_VERIFIED': {
        this.directConnectionVerified = true;

        if (
          this.connectionTimeoutId !== null
        ) {
          window.clearTimeout(
            this.connectionTimeoutId
          );

          this.connectionTimeoutId = null;
        }

        break;
      }

      case 'FILE_START': {
        this.currentFile = {
          ...parsed,
          receivedChunks: new Map(),
          receivedBytes: 0,
          checksum: 0x811c9dc5,
          expectedChunkIndex: 0,
          pendingChunkMetadata: null,
        };

        this.startTime = Date.now();
        this.lastSpeedCheckTime = Date.now();
        this.lastBytesCount = 0;

        this.startTransferWatchdog();

        this.onProgressCallback?.({
          status: 'transferring',
          currentFileName:
            parsed.relativePath ||
            parsed.fileName,
          fileSize: parsed.fileSize,
          transferredBytes: 0,
          progress: 0,
          serverRole: 'signaling-only',
        });

        break;
      }

      case 'FILE_CHUNK': {
        if (
          !this.currentFile ||
          this.currentFile.fileId !==
            parsed.fileId
        ) {
          this.failTransfer(
            'Invalid or missing file chunk metadata.'
          );

          return;
        }

        if (
          parsed.chunkIndex !==
          this.currentFile.expectedChunkIndex
        ) {
          this.failTransfer(
            'Invalid chunk index received.'
          );

          return;
        }

        if (
          this.currentFile.pendingChunkMetadata
        ) {
          this.failTransfer(
            'Received new chunk metadata before previous chunk was processed.'
          );

          return;
        }

        this.currentFile.pendingChunkMetadata =
          parsed;

        break;
      }

      case 'FILE_CHUNK_ACK': {
        this.resolveChunkAck(
          parsed.fileId,
          parsed.chunkIndex
        );

        break;
      }

      case 'FILE_END': {
        this.finishReceivedFile(parsed);

        break;
      }

      case 'FILE_VERIFIED': {
        this.resolveFileVerification(
          parsed.fileId,
          parsed.checksum
        );

        break;
      }

      case 'FILE_ERROR': {
        this.rejectPendingOperations(
          new Error(parsed.error)
        );

        this.failTransfer(
          parsed.error
        );

        break;
      }
    }
  }

  private finishReceivedFile(
    message: FileEndMessage
  ): void {
    const current = this.currentFile;

    if (
      !current ||
      current.fileId !== message.fileId
    ) {
      this.sendFileError(
        message.fileId,
        'Received FILE_END for an unknown file.'
      );

      return;
    }

    if (
      current.receivedChunks.size !==
      current.totalChunks
    ) {
      this.sendFileError(
        current.fileId,
        'Not all file chunks were received.'
      );

      return;
    }

    if (
      current.receivedBytes !==
      current.fileSize
    ) {
      this.sendFileError(
        current.fileId,
        'Received file size does not match the expected size.'
      );

      return;
    }

    const calculatedChecksum =
      checksumToString(
        current.checksum
      );

    if (
      calculatedChecksum !==
      message.checksum
    ) {
      this.sendFileError(
        current.fileId,
        'File integrity check failed. The transfer was discarded.'
      );

      this.failTransfer(
        'File integrity check failed. The transfer was discarded.'
      );

      return;
    }

    if (
      current.pendingChunkMetadata
    ) {
      this.sendFileError(
        current.fileId,
        'A file chunk was not completely received.'
      );

      return;
    }

    const chunks =
      Array.from(
        current.receivedChunks.entries()
      )
        .sort(([a], [b]) => a - b)
        .map(([, chunk]) => chunk);

    this.downloadFile(
      chunks,
      current.relativePath ||
        current.fileName,
      current.fileType
    );

    /**
     * Tell sender that the entire file has
     * been reconstructed and verified.
     */
    void this.sendData(
      JSON.stringify({
        type: 'FILE_VERIFIED',
        fileId: current.fileId,
        checksum: calculatedChecksum,
      } satisfies FileVerifiedMessage)
    ).catch(() => {
      this.failTransfer(
        'File was verified locally, but the verification acknowledgement could not be sent.'
      );
    });

    this.currentFile = null;

    this.onProgressCallback?.({
      status: 'completed',
      progress: 100,
      timeRemaining: 0,
      connectionType:
        this.directCandidateType,
    });
  }

  private async sendData(
    data: string | ArrayBuffer
  ): Promise<void> {
    const channel = this.dataChannel;

    if (
      !channel ||
      channel.readyState !== 'open'
    ) {
      throw new Error(
        'Direct data channel is not open.'
      );
    }

    const byteLength =
      typeof data === 'string'
        ? new TextEncoder()
            .encode(data)
            .byteLength
        : data.byteLength;

    const deadline =
      Date.now() + QUEUE_WAIT_TIMEOUT;

    while (
      channel.bufferedAmount +
        byteLength >
      DATA_CHANNEL_HIGH_WATER_MARK
    ) {
      if (
        Date.now() >= deadline
      ) {
        throw new Error(
          'The direct data channel stayed full for too long.'
        );
      }

      await this.waitForBufferedAmountLow(
        channel
      );

      if (
        channel.readyState !== 'open'
      ) {
        throw new Error(
          'The direct data channel closed while waiting for buffer space.'
        );
      }
    }

    try {
      channel.send(data);

      this.resetTransferWatchdog();
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : 'The browser rejected the direct data channel payload.'
      );
    }
  }

  private async waitForBufferedAmountLow(
    channel: RTCDataChannel
  ): Promise<void> {
    if (
      channel.bufferedAmount <=
      DATA_CHANNEL_LOW_WATER_MARK
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;

        settled = true;

        window.clearTimeout(
          timer
        );

        channel.removeEventListener(
          'bufferedamountlow',
          onLow
        );

        resolve();
      };

      const onLow = () => {
        cleanup();
      };

      const timer =
        window.setTimeout(
          cleanup,
          120
        );

      channel.addEventListener(
        'bufferedamountlow',
        onLow,
        { once: true }
      );

      /**
       * Prevent race where buffer becomes low
       * between the initial check and listener setup.
       */
      if (
        channel.bufferedAmount <=
        DATA_CHANNEL_LOW_WATER_MARK
      ) {
        cleanup();
      }
    });
  }

  private async waitForRemoteReady(): Promise<void> {
    if (this.remoteReady) {
      return;
    }

    await new Promise<void>(
      (resolve, reject) => {
        const timeout =
          window.setTimeout(() => {
            const index =
              this.remoteReadyWaiters.findIndex(
                (item) =>
                  item.resolve === resolve
              );

            if (index >= 0) {
              this.remoteReadyWaiters.splice(
                index,
                1
              );
            }

            reject(
              new Error(
                'The recipient did not verify the direct P2P connection.'
              )
            );
          }, DIRECT_READY_TIMEOUT);

        this.remoteReadyWaiters.push({
          resolve: () => {
            window.clearTimeout(
              timeout
            );

            resolve();
          },
          reject,
        });
      }
    );
  }

  private async waitForChunkAck(
    fileId: string,
    chunkIndex: number
  ): Promise<void> {
    const key =
      `${fileId}:${chunkIndex}`;

    await new Promise<void>(
      (resolve, reject) => {
        const timeoutId =
          window.setTimeout(() => {
            this.pendingChunkAcks.delete(
              key
            );

            reject(
              new Error(
                `Chunk ${chunkIndex + 1} was not acknowledged by the receiver.`
              )
            );
          }, CHUNK_ACK_TIMEOUT);

        this.pendingChunkAcks.set(
          key,
          {
            fileId,
            chunkIndex,
            resolve,
            reject,
            timeoutId,
          }
        );
      }
    );
  }

  private resolveChunkAck(
    fileId: string,
    chunkIndex: number
  ): void {
    const key =
      `${fileId}:${chunkIndex}`;

    const pending =
      this.pendingChunkAcks.get(key);

    if (!pending) {
      return;
    }

    window.clearTimeout(
      pending.timeoutId
    );

    this.pendingChunkAcks.delete(
      key
    );

    pending.resolve();
  }

  private async waitForFileVerification(
    fileId: string
  ): Promise<void> {
    await new Promise<void>(
      (resolve, reject) => {
        const timeoutId =
          window.setTimeout(() => {
            if (
              this.pendingFileVerification
                ?.fileId === fileId
            ) {
              this.pendingFileVerification =
                null;
            }

            reject(
              new Error(
                'The receiver did not confirm final file verification.'
              )
            );
          }, FILE_VERIFICATION_TIMEOUT);

        this.pendingFileVerification = {
          fileId,
          resolve,
          reject,
          timeoutId,
        };
      }
    );
  }

  private resolveFileVerification(
    fileId: string,
    checksum: string
  ): void {
    const pending =
      this.pendingFileVerification;

    if (
      !pending ||
      pending.fileId !== fileId
    ) {
      return;
    }

    window.clearTimeout(
      pending.timeoutId
    );

    this.pendingFileVerification =
      null;

    pending.resolve();

    this.onProgressCallback?.({
      status: 'transferring',
      serverRole: 'signaling-only',
    });
  }

  private sendFileError(
    fileId: string,
    error: string
  ): void {
    void this.sendData(
      JSON.stringify({
        type: 'FILE_ERROR',
        fileId,
        error,
      } satisfies FileErrorMessage)
    ).catch(() => {
      // Connection may already be closed.
    });
  }

  private rejectPendingOperations(
    error: Error
  ): void {
    if (
      this.pendingDirectVerification
    ) {
      const pending =
        this.pendingDirectVerification;

      this.pendingDirectVerification =
        null;

      window.clearTimeout(
        pending.timeoutId
      );

      pending.reject(error);
    }

    for (
      const pending of
      this.pendingChunkAcks.values()
    ) {
      window.clearTimeout(
        pending.timeoutId
      );

      pending.reject(error);
    }

    this.pendingChunkAcks.clear();

    if (
      this.pendingFileVerification
    ) {
      const pending =
        this.pendingFileVerification;

      this.pendingFileVerification =
        null;

      window.clearTimeout(
        pending.timeoutId
      );

      pending.reject(error);
    }

    this.remoteReadyWaiters
      .splice(0)
      .forEach((waiter) => {
        waiter.reject(error);
      });
  }

  private updateStats(
    currentTransferred: number,
    totalSize: number,
    fileName: string,
    currentFileIndex = 1,
    totalFiles = 1
  ): void {
    const now = Date.now();

    const timeDelta =
      (now - this.lastSpeedCheckTime) /
      1000;

    let speed = 0;

    if (timeDelta > 0.3) {
      speed =
        (currentTransferred -
          this.lastBytesCount) /
        timeDelta;

      this.lastSpeedCheckTime =
        now;

      this.lastBytesCount =
        currentTransferred;
    }

    const remainingBytes =
      Math.max(
        0,
        totalSize -
          currentTransferred
      );

    this.onProgressCallback?.({
      currentFileName: fileName,
      currentFileIndex,
      totalFiles,
      fileSize: totalSize,
      transferredBytes:
        currentTransferred,
      progress:
        totalSize > 0
          ? Math.min(
              100,
              (currentTransferred /
                totalSize) *
                100
            )
          : 100,
      speed,
      timeRemaining:
        speed > 0
          ? remainingBytes / speed
          : 0,
      connectionType:
        this.directCandidateType,
      serverRole: 'signaling-only',
    });
  }

  private downloadFile(
    chunks: ArrayBuffer[],
    fileName: string,
    fileType: string
  ): void {
    const blob = new Blob(
      chunks,
      {
        type:
          fileType ||
          'application/octet-stream',
      }
    );

    const url =
      URL.createObjectURL(blob);

    const anchor =
      document.createElement('a');

    anchor.href = url;

    anchor.download =
      fileName.split('/').pop() ||
      fileName;

    document.body.appendChild(
      anchor
    );

    anchor.click();

    document.body.removeChild(
      anchor
    );

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1_000);
  }

  /**
   * Used for actual connection failures.
   *
   * Unlike the old failDirectConnection(),
   * this still works AFTER direct verification.
   */
  private failConnection(
    message: string
  ): void {
    if (this.intentionallyClosing) {
      return;
    }

    this.stopTransferWatchdog();

    this.rejectPendingOperations(
      new Error(message)
    );

    this.onProgressCallback?.({
      status: 'failed',
      error: message,
      connectionType:
        this.directCandidateType,
      serverRole: 'signaling-only',
    });

    this.close();
  }

  private failTransfer(
    message: string
  ): void {
    if (this.intentionallyClosing) {
      return;
    }

    this.stopTransferWatchdog();

    this.rejectPendingOperations(
      new Error(message)
    );

    this.onProgressCallback?.({
      status: 'failed',
      error: message,
      connectionType:
        this.directCandidateType,
      serverRole: 'signaling-only',
    });

    this.close();
  }

  public close(): void {
    this.intentionallyClosing = true;

    this.stopTransferWatchdog();

    if (
      this.connectionTimeoutId !== null
    ) {
      window.clearTimeout(
        this.connectionTimeoutId
      );

      this.connectionTimeoutId =
        null;
    }

    this.rejectPendingOperations(
      new Error(
        'WebRTC transfer was closed.'
      )
    );

    if (this.dataChannel) {
      try {
        this.dataChannel.onopen =
          null;

        this.dataChannel.onmessage =
          null;

        this.dataChannel.onerror =
          null;

        this.dataChannel.onclose =
          null;

        this.dataChannel.close();
      } catch {
        // Ignore close errors.
      }
    }

    this.dataChannel = null;

    if (this.peerConnection) {
      try {
        this.peerConnection.onicecandidate =
          null;

        this.peerConnection.oniceconnectionstatechange =
          null;

        this.peerConnection.onconnectionstatechange =
          null;

        this.peerConnection.ondatachannel =
          null;

        this.peerConnection.close();
      } catch {
        // Ignore close errors.
      }
    }

    this.peerConnection = null;

    this.channelOpened = false;
    this.directConnectionVerified = false;
    this.directCandidateType = 'unknown';

    this.currentFile = null;

    this.remoteReady = false;
    this.receivedDirectReady = false;

    this.remoteReadyWaiters = [];

    this.pendingCandidates = [];

    this.pendingChunkAcks.clear();
    this.pendingFileVerification = null;
    this.pendingDirectVerification = null;

    this.intentionallyClosing = false;
  }
}

function updateChecksum(
  current: number,
  bytes: Uint8Array
): number {
  let checksum =
    current >>> 0;

  for (const byte of bytes) {
    checksum ^= byte;

    checksum =
      Math.imul(
        checksum,
        0x010001f3
      ) >>> 0;
  }

  return checksum >>> 0;
}

function checksumToString(
  checksum: number
): string {
  return (
    checksum >>> 0
  )
    .toString(16)
    .padStart(8, '0');
}

function wait(
  ms: number
): Promise<void> {
  return new Promise(
    (resolve) => {
      window.setTimeout(
        resolve,
        ms
      );
    }
  );
}
