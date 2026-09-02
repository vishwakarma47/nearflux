import type { TransferState } from '../types/index.js';
import { socketService } from './socket.js';

/**
 * Strict direct-P2P transfer service.
 *
 * TIMEOUT POLICY
 * --------------
 * There are no time-based failures anywhere in this file: no connection
 * timeout, no stall watchdog, no ready/ack/verification deadlines and no
 * send-queue deadline. A transfer only fails on an observable event:
 *
 *   - ICE / peer connection reports 'failed' (after the ICE restart budget is
 *     spent) or 'closed'
 *   - the data channel errors or closes
 *   - the selected ICE candidate pair is a relay pair
 *   - a protocol violation (bad order, size mismatch, checksum mismatch)
 *   - the peer sends FILE_ERROR
 *   - close() is called locally
 *
 * Consequence to be aware of: if the network goes quiet without the browser
 * surfacing a state change (for example ICE 'disconnected' that never
 * recovers and never escalates to 'failed'), a pending operation waits
 * indefinitely instead of erroring out. That is the intended behaviour here.
 *
 * NO RELAY
 * --------
 * TURN is deliberately absent: STUN discovers addresses, and the selected
 * candidate pair is inspected so a relay pair is rejected outright. When ICE
 * fails there is therefore no fallback, only recovery, so 'failed' triggers an
 * ICE restart (MAX_ICE_RESTART_ATTEMPTS, counted in attempts and never in
 * seconds) before the transfer is given up. If it is still impossible, the
 * gathered candidate types are used to explain WHY (STUN unreachable vs.
 * symmetric NAT) instead of reporting a bare "ICE connection failed".
 */

/**
 * Keep each SCTP message below the browser-to-browser default maximum. A
 * 512 KiB message is rejected by Chromium on connections that negotiate a
 * smaller maxMessageSize. 60 KiB is conservative for Chromium, Firefox,
 * Safari, mobile browsers, and older SDP peers while still keeping message
 * overhead low for large files.
 */
const CHUNK_SIZE = 60 * 1024;
const MESSAGE_SIZE_HEADROOM = 4 * 1024;

const DATA_CHANNEL_HIGH_WATER_MARK = 4 * 1024 * 1024;
const DATA_CHANNEL_LOW_WATER_MARK = 1 * 1024 * 1024;

/**
 * Chunks may stay unacknowledged while the sender keeps going. This keeps
 * throughput independent of round-trip time while still bounding memory and
 * guaranteeing the receiver stays in step with the sender.
 */
const MAX_UNACKED_CHUNKS = 16;

/**
 * Wake-up interval only. Not a failure deadline: 'bufferedamountlow' is not
 * fired by every browser in every state, so buffer space is re-checked
 * periodically. Nothing fails when it elapses.
 */
const BUFFER_WAKEUP_INTERVAL = 100;

/**
 * Poll interval for ICE candidate-pair inspection. Also not a deadline: the
 * loop runs until the pair is known or the connection reports failure.
 */
const CANDIDATE_POLL_INTERVAL = 200;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * ICE restart budget. Bounded by ATTEMPTS, not by time: every retry is
 * triggered by an observable ICE 'failed' event, never by a clock. A restart
 * re-gathers candidates and forces new NAT bindings, which is the only
 * recovery available when relay/TURN is disabled.
 */
const MAX_ICE_RESTART_ATTEMPTS = 2;


type DirectCandidateType =
  | 'host'
  | 'srflx'
  | 'prflx'
  | 'relay'
  | 'unknown';

/** Candidate types that count as a direct path. */
type DirectConnectionType = 'host' | 'srflx' | 'prflx';

/** Narrower shape reported to the UI layer via TransferState. */
type ReportedConnectionType = 'host' | 'srflx' | 'relay' | 'unknown';

type StatsLike = {
  id: string;
  type: string;
  [key: string]: unknown;
};

type CandidatePairLike = {
  id: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
};

type CandidateLike = {
  candidateType?: string;
};

/**
 * What ICE actually managed to gather on each side. With relay disabled this is
 * the only way to explain a failure: no reflexive candidate means STUN itself
 * was unreachable, while reflexive candidates on both sides that still fail to
 * pair means at least one NAT is symmetric and no direct path exists.
 */
export type IceDiagnostics = {
  localTypes: string[];
  remoteTypes: string[];
  localReflexive: boolean;
  remoteReflexive: boolean;
  gatheringState: RTCIceGatheringState | 'unknown';
  restartAttempts: number;
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

/**
 * Readiness handshake, symmetric and role-free:
 *
 *   each peer -> DIRECT_READY once its OWN candidate pair is confirmed direct
 *   each peer -> DIRECT_READY_ACK as a liveness echo (carries no readiness)
 *
 * A peer is considered ready only when its own DIRECT_READY arrives, which it
 * only sends after confirming its own path. Neither side has a role-specific
 * step, so the two sides cannot end up waiting on each other, and data never
 * starts flowing towards a peer that has not confirmed its path yet.
 */
type DirectReadyMessage = { type: 'DIRECT_READY' };
type DirectReadyAckMessage = { type: 'DIRECT_READY_ACK' };

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
  | FileChunkAckMessage
  | FileVerifiedMessage
  | FileErrorMessage;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingFileVerification = Deferred & {
  fileId: string;
  expectedChecksum: string;
};

type ReceiveFile = FileStartMessage & {
  /** Ordered chunk list. Order is enforced by chunkIndex validation. */
  chunks: ArrayBuffer[];
  receivedBytes: number;
  checksum: number;
  expectedChunkIndex: number;
  pendingChunkMetadata: FileChunkMessage | null;
};

export interface TransferProgressCallback {
  (state: Partial<TransferState>): void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  /**
   * Mark the promise as handled. rejectPendingOperations() may reject entries
   * nobody is currently awaiting; without this, that surfaces as an unhandled
   * rejection. Awaiting the same promise elsewhere still throws.
   */
  void promise.catch(() => undefined);

  return { promise, resolve, reject };
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;

  private isInitiator = false;

  private remotePeerId = '';
  private localPeerId = '';
  private roomCode = '';

  private pendingCandidates: RTCIceCandidateInit[] = [];

  /** Candidate types seen locally and from the peer, for failure diagnosis. */
  private localCandidateTypes = new Set<string>();
  private remoteCandidateTypes = new Set<string>();

  private iceRestartAttempts = 0;
  private iceRestartInFlight = false;

  /** Cached so diagnostics survive the teardown that follows a failure. */
  private lastGatheringState: RTCIceGatheringState | 'unknown' = 'unknown';

  private currentFile: ReceiveFile | null = null;

  private startTime = 0;
  private lastBytesCount = 0;
  private lastSpeedCheckTime = 0;
  private lastSpeed = 0;

  private onProgressCallback: TransferProgressCallback | null = null;
  private onChannelOpenCallback: (() => void) | null = null;

  private channelOpened = false;

  /**
   * True only after the local candidate pair was inspected and found direct AND
   * the peer sent its own DIRECT_READY. An open DataChannel alone is not enough.
   * Required before sending file data.
   */
  private directConnectionVerified = false;

  /** Our own candidate pair was inspected and is direct. */
  private localDirectConfirmed = false;

  private directCandidateType: DirectCandidateType = 'unknown';

  private verificationPromise: Promise<{ type: DirectConnectionType }> | null =
    null;

  private localReadySent = false;
  private remoteReady = false;
  private remoteReadyWaiters: Deferred[] = [];

  private pendingChunkAcks = new Map<string, Deferred>();
  private pendingFileVerification: PendingFileVerification | null = null;

  /** Sticky: once closed, this instance never reports failures again. */
  private isClosed = false;
  private hasFailed = false;

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

  public isDirectConnectionVerified(): boolean {
    return this.directConnectionVerified;
  }

  public initialize(): RTCPeerConnection {
    const config: RTCConfiguration = {
      /**
       * Several independent STUN providers. If one is blocked or rate-limited
       * the others can still produce a reflexive candidate, and reaching these
       * over IPv6 often yields a direct path even when IPv4 is behind CGNAT.
       */
      iceServers: [
        {
          urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
          ],
        },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
      ],

      /**
       * Relay candidates may be discovered, but the selected candidate pair is
       * inspected and relay usage is rejected.
       */
      iceTransportPolicy: 'all',

      /** Pre-gather so candidates exist the moment the offer is created. */
      iceCandidatePoolSize: 4,
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;

      if (event.candidate.type) {
        this.localCandidateTypes.add(event.candidate.type);
      }

      /**
       * A discovered relay candidate does NOT mean the connection will use
       * TURN, so candidates are never filtered here.
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

      /**
       * 'disconnected' is transient and is deliberately not treated as a
       * failure; it either recovers or escalates to 'failed'.
       */
      if (state === 'failed') {
        /** Retry by re-gathering before giving up. Never a timed retry. */
        void this.recoverFromIceFailure();
      } else if (state === 'closed') {
        this.failConnection('The ICE connection was closed.');
      } else if (state === 'connected' || state === 'completed') {
        /** A working path resets the budget for any later NAT rebinding. */
        this.iceRestartAttempts = 0;
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;

      /**
       * connectionState goes 'failed' as soon as the ICE transport fails, so it
       * must funnel into the same recovery path. Failing here directly would
       * pre-empt the ICE restart, because fail() is sticky.
       */
      if (state === 'failed') {
        void this.recoverFromIceFailure();
      } else if (state === 'closed') {
        this.failConnection('The WebRTC connection was closed unexpectedly.');
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState;

      if (state) {
        this.lastGatheringState = state;
      }
    };

    if (this.isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
        ordered: true,
      });

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

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
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

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('WebRTC connection is not initialized.');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );

    await this.processPendingCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;

    this.noteRemoteCandidateType(candidate);

    if (!this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /**
       * A single rejected candidate is normal (stale, unsupported transport,
       * already-closed transport) and must NOT tear the session down. ICE
       * reports 'failed' if no candidate pair can be formed at all.
       */
    }
  }

  private async processPendingCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      return;
    }

    const queued = this.pendingCandidates.splice(0);

    for (const candidate of queued) {
      await this.addIceCandidate(candidate);
    }
  }

  /** Records the peer's candidate types straight out of the SDP attribute. */
  private noteRemoteCandidateType(candidate: RTCIceCandidateInit): void {
    const line = candidate.candidate;

    if (!line) return;

    const match = /(?:^|\s)typ\s+(host|srflx|prflx|relay)(?:\s|$)/.exec(line);

    if (match?.[1]) {
      this.remoteCandidateTypes.add(match[1]);
    }
  }

  private hasReflexive(types: Set<string>): boolean {
    return types.has('srflx') || types.has('prflx');
  }

  /** Everything ICE learned, for the UI and for support/debugging. */
  public getIceDiagnostics(): IceDiagnostics {
    return {
      localTypes: [...this.localCandidateTypes],
      remoteTypes: [...this.remoteCandidateTypes],
      localReflexive: this.hasReflexive(this.localCandidateTypes),
      remoteReflexive: this.hasReflexive(this.remoteCandidateTypes),
      gatheringState:
        this.peerConnection?.iceGatheringState ?? this.lastGatheringState,
      restartAttempts: this.iceRestartAttempts,
    };
  }

  /**
   * Turns a bare 'ICE failed' into something the person in front of the screen
   * can act on. Relay is disabled by design, so the message has to explain the
   * cause instead of offering a fallback.
   */
  private describeIceFailure(): string {
    const localReflexive = this.hasReflexive(this.localCandidateTypes);
    const remoteReflexive = this.hasReflexive(this.remoteCandidateTypes);

    if (!localReflexive && !remoteReflexive) {
      return (
        'No direct P2P route could be found: neither device could reach a STUN ' +
        'server, so only local network addresses were available. A firewall, ' +
        'VPN or blocked UDP traffic is the usual cause. Put both devices on the ' +
        'same network, or disable the VPN, and try again.'
      );
    }

    if (!localReflexive) {
      return (
        'No direct P2P route could be found: this device could not reach a STUN ' +
        'server, so it never learned its public address. Check for a VPN, proxy ' +
        'or firewall that blocks UDP, then try again.'
      );
    }

    if (!remoteReflexive) {
      return (
        'No direct P2P route could be found: the other device could not reach a ' +
        'STUN server, so it never learned its public address. It is likely ' +
        'behind a VPN or a firewall that blocks UDP.'
      );
    }

    return (
      'No direct P2P route could be found: both devices know their public ' +
      'addresses but their networks refuse to connect them directly, which ' +
      'happens with strict (symmetric) NAT such as many mobile and corporate ' +
      'networks. Relay is disabled, so try the same Wi-Fi network or a phone ' +
      'hotspot.'
    );
  }

  /**
   * ICE reported 'failed'. Re-gather instead of giving up: a restart forces new
   * NAT bindings and a fresh candidate exchange, which is the only recovery
   * available with relay disabled. Bounded by attempts, never by a timer, and
   * every attempt is triggered by an observable state change.
   */
  private async recoverFromIceFailure(): Promise<void> {
    if (this.isClosed || this.hasFailed || this.iceRestartInFlight) {
      return;
    }

    const pc = this.peerConnection;

    if (!pc) return;

    this.iceRestartInFlight = true;

    /**
     * One ICE failure is reported twice, once on oniceconnectionstatechange and
     * once on onconnectionstatechange, both inside the same task. Yielding here
     * keeps iceRestartInFlight raised across both, so a single failure consumes
     * exactly one attempt. A genuinely new 'failed' (after the restart went
     * back to checking) arrives in a later task and counts again.
     */
    await Promise.resolve();

    if (this.isClosed || this.hasFailed) {
      this.iceRestartInFlight = false;
      return;
    }

    if (this.iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
      this.iceRestartInFlight = false;
      this.failConnection(this.describeIceFailure());
      return;
    }


    this.iceRestartAttempts += 1;
    this.iceRestartInFlight = true;

    /** Keep the UI in 'connecting', not stuck at a dead 0%. */
    this.onProgressCallback?.({
      status: 'checking_direct_connection',
      connectionType: 'unknown',
      serverRole: 'signaling-only',
    });

    try {
      if (this.isInitiator) {
        /**
         * Only the offerer renegotiates. The answerer re-gathers automatically
         * when this offer arrives, so there is no glare.
         */
        const offer = await pc.createOffer({ iceRestart: true });

        await pc.setLocalDescription(offer);

        socketService.sendWebRTCOffer({
          roomCode: this.roomCode,
          senderId: this.localPeerId,
          targetId: this.remotePeerId,
          signal: offer,
        });
      } else {
        /** Marks the transport so the peer's restart offer re-gathers here. */
        pc.restartIce();
      }
    } catch {
      this.failConnection(this.describeIceFailure());
    } finally {
      this.iceRestartInFlight = false;
    }
  }

  /**
   * Manual retry hook for a "try again" button. Same event-driven restart, with
   * the budget reset because the person explicitly asked for another attempt.
   */
  public async retryDirectConnection(): Promise<void> {
    if (this.isClosed || this.hasFailed) return;

    this.iceRestartAttempts = 0;

    await this.recoverFromIceFailure();
  }

  /**
   * Verifies a real direct connection: the selected ICE candidate pair must be
   * host/srflx/prflx (never relay) and the peer must confirm readiness on that
   * same channel.
   *
   * Runs until it succeeds or the connection reports a failure. The legacy
   * timeout argument is accepted and ignored so existing call sites keep
   * compiling.
   */
  public async verifyDirectConnection(
    _legacyTimeoutMs?: number
  ): Promise<{ type: DirectConnectionType }> {
    if (this.directConnectionVerified) {
      return { type: this.assertDirectType(this.directCandidateType) };
    }

    if (!this.verificationPromise) {
      this.verificationPromise = this.runDirectVerification();

      void this.verificationPromise.catch(() => undefined).finally(() => {
        this.verificationPromise = null;
      });
    }

    return this.verificationPromise;
  }

  private async runDirectVerification(): Promise<{
    type: DirectConnectionType;
  }> {
    if (!this.peerConnection) {
      throw new Error('WebRTC connection is not initialized.');
    }

    this.onProgressCallback?.({
      status: 'checking_direct_connection',
      serverRole: 'signaling-only',
    });

    /** Runs until verified or until the connection reports a failure. */
    for (;;) {
      if (this.isClosed || this.hasFailed || !this.peerConnection) {
        throw new Error('WebRTC connection was closed.');
      }

      const connectionState = this.peerConnection.connectionState;
      const iceState = this.peerConnection.iceConnectionState;

      /**
       * 'failed' is NOT terminal any more: an ICE restart re-gathers and the
       * pair can still come up. fail() is the single authority on giving up
       * (checked above via hasFailed), so this loop only aborts on a closed
       * connection and keeps polling through a restart.
       */
      if (connectionState === 'closed' || iceState === 'closed') {
        throw new Error('The direct WebRTC connection failed.');
      }

      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        const selected = await this.getSelectedCandidateType();

        if (selected === 'relay') {
          this.failConnection(
            'A relay candidate pair was selected. Strict direct P2P transfer is disabled.'
          );

          throw new Error('Relay connection rejected.');
        }

        if (selected !== 'unknown') {
          return { type: await this.confirmDirectConnection(selected) };
        }
      }

      await wait(CANDIDATE_POLL_INTERVAL);
    }
  }

  /**
   * Announces our own confirmed direct path and waits for the peer to announce
   * its own. Both steps are identical on both peers, so no role can stall the
   * other and the previous initiator/receiver-specific handshake (which could
   * deadlock when the sender was not the initiator) is gone.
   */
  private async confirmDirectConnection(
    selected: DirectConnectionType
  ): Promise<DirectConnectionType> {
    this.directCandidateType = selected;

    /**
     * Our own path is confirmed direct here. Inbound data is accepted from this
     * point, before the peer handshake finishes, so a peer that starts sending
     * as soon as it sees our DIRECT_READY can never race ahead of this flag.
     */
    this.localDirectConfirmed = true;

    await this.sendReadySignal();
    await this.waitForRemoteReady();

    this.directConnectionVerified = true;

    this.onProgressCallback?.({
      status: 'ready_for_transfer',
      connectionType: this.reportedConnectionType(),
      serverRole: 'signaling-only',
    });

    return selected;
  }

  private async sendReadySignal(): Promise<void> {
    if (this.localReadySent) return;

    this.localReadySent = true;

    try {
      await this.sendData(
        JSON.stringify({ type: 'DIRECT_READY' } satisfies DirectReadyMessage)
      );
    } catch (error) {
      this.localReadySent = false;
      throw error;
    }
  }

  private markRemoteReady(): void {
    this.remoteReady = true;

    this.remoteReadyWaiters.splice(0).forEach((waiter) => {
      waiter.resolve();
    });
  }

  private async waitForRemoteReady(): Promise<void> {
    if (this.remoteReady) return;

    const waiter = createDeferred();

    this.remoteReadyWaiters.push(waiter);

    await waiter.promise;
  }

  private assertDirectType(
    type: DirectCandidateType
  ): DirectConnectionType {
    if (type === 'host' || type === 'srflx' || type === 'prflx') {
      return type;
    }

    throw new Error('The direct connection type is unknown.');
  }

  /**
   * 'prflx' (peer reflexive) is a direct, NAT-traversed path. It is reported as
   * 'srflx' so the existing TransferState union does not have to change.
   */
  private reportedConnectionType(): ReportedConnectionType {
    if (this.directCandidateType === 'prflx') {
      return 'srflx';
    }

    return this.directCandidateType;
  }

  private async getSelectedCandidateType(): Promise<DirectCandidateType> {
    if (!this.peerConnection) {
      return 'unknown';
    }

    const stats = await this.peerConnection.getStats();

    const pairs = new Map<string, CandidatePairLike>();
    const candidates = new Map<string, CandidateLike>();

    let selectedPairId: string | undefined;

    stats.forEach((report) => {
      const entry = report as unknown as StatsLike;

      if (entry.type === 'transport') {
        const pairId = entry.selectedCandidatePairId;

        if (typeof pairId === 'string') {
          selectedPairId = pairId;
        }
      }

      if (entry.type === 'candidate-pair') {
        pairs.set(entry.id, entry as unknown as CandidatePairLike);
      }

      if (
        entry.type === 'local-candidate' ||
        entry.type === 'remote-candidate'
      ) {
        candidates.set(entry.id, entry as unknown as CandidateLike);
      }
    });

    /**
     * Preferred source of truth: transport.selectedCandidatePairId.
     * Fallbacks cover browsers that only expose `nominated` (Chromium) or
     * `selected` (Firefox), and finally any succeeded pair once the peer
     * connection itself reports 'connected'.
     */
    let pair = selectedPairId ? pairs.get(selectedPairId) : undefined;

    if (!pair) {
      for (const candidatePair of pairs.values()) {
        if (
          candidatePair.state === 'succeeded' &&
          (candidatePair.selected || candidatePair.nominated)
        ) {
          pair = candidatePair;
          break;
        }
      }
    }

    if (!pair && this.peerConnection.connectionState === 'connected') {
      for (const candidatePair of pairs.values()) {
        if (candidatePair.state === 'succeeded') {
          pair = candidatePair;
          break;
        }
      }
    }

    if (!pair) {
      return 'unknown';
    }

    const localType = pair.localCandidateId
      ? candidates.get(pair.localCandidateId)?.candidateType
      : undefined;

    const remoteType = pair.remoteCandidateId
      ? candidates.get(pair.remoteCandidateId)?.candidateType
      : undefined;

    const types = [localType, remoteType].filter(
      (value): value is string => typeof value === 'string'
    );

    if (types.length === 0) {
      return 'unknown';
    }

    if (types.includes('relay')) {
      return 'relay';
    }

    if (types.every((value) => value === 'host')) {
      return 'host';
    }

    if (types.includes('srflx')) {
      return 'srflx';
    }

    if (types.includes('prflx')) {
      return 'prflx';
    }

    if (types.includes('host')) {
      return 'host';
    }

    return 'unknown';
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    channel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER_MARK;

    channel.onopen = () => {
      this.channelOpened = true;

      this.onProgressCallback?.({
        status: 'checking_direct_connection',
        serverRole: 'signaling-only',
      });

      this.onChannelOpenCallback?.();
    };

    channel.onmessage = (event) => {
      this.handleIncomingData(event.data as string | ArrayBuffer);
    };

    channel.onerror = () => {
      this.failConnection('The direct data channel encountered an error.');
    };

    channel.onclose = () => {
      this.channelOpened = false;

      if (this.isClosed) {
        return;
      }

      if (!this.directConnectionVerified) {
        this.failConnection(
          'The direct data channel closed before direct P2P verification completed.'
        );

        return;
      }

      this.failTransfer('The direct data channel closed during file transfer.');
    };
  }

  private assertChannelOpen(): RTCDataChannel {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Direct data channel is not open.');
    }

    return this.dataChannel;
  }

  public async sendFiles(
    files: Array<{ file: File; relativePath?: string }>
  ): Promise<void> {
    await this.verifyDirectConnection();

    this.assertChannelOpen();

    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const entry = files[fileIndex];

        await this.sendSingleFile(
          entry.file,
          entry.relativePath,
          fileIndex,
          files.length
        );
      }

      this.onProgressCallback?.({
        status: 'completed',
        progress: 100,
        timeRemaining: 0,
        connectionType: this.reportedConnectionType(),
      });
    } catch (error) {
      this.failTransfer(
        error instanceof Error ? error.message : 'File transfer failed.'
      );

      throw error;
    }
  }

  private async sendSingleFile(
    file: File,
    relativePath: string | undefined,
    fileIndex: number,
    totalFiles: number
  ): Promise<void> {
    const chunkSize = this.getSafeChunkSize();
    const totalChunks = Math.ceil(file.size / chunkSize);

    const fileId = `${file.name}-${file.size}-${Date.now()}-${fileIndex}`;

    const displayName = relativePath || file.name;

    const startMessage: FileStartMessage = {
      type: 'FILE_START',
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      totalChunks,
      checksumAlgorithm: 'fnv1a32',
    };

    if (relativePath) {
      startMessage.relativePath = relativePath;
    }

    /** Speed is measured per file, so the counters reset here. */
    this.startTime = Date.now();
    this.lastSpeedCheckTime = Date.now();
    this.lastBytesCount = 0;
    this.lastSpeed = 0;

    await this.sendData(JSON.stringify(startMessage));

    this.updateStats(0, file.size, displayName, fileIndex + 1, totalFiles);

    let offset = 0;
    let chunkIndex = 0;
    let checksum = FNV_OFFSET_BASIS;

    while (offset < file.size) {
      this.assertChannelOpen();

      const buffer = await file
        .slice(offset, offset + chunkSize)
        .arrayBuffer();

      const chunkMessage: FileChunkMessage = {
        type: 'FILE_CHUNK',
        fileId,
        chunkIndex,
        byteLength: buffer.byteLength,
      };

      /** Registered before sending so the ACK can never arrive unobserved. */
      this.trackChunkAck(fileId, chunkIndex);

      try {
        await this.sendData(JSON.stringify(chunkMessage));
        await this.sendData(buffer);
      } catch (error) {
        this.discardChunkAck(fileId, chunkIndex);
        throw error;
      }

      checksum = updateChecksum(checksum, new Uint8Array(buffer));

      offset += buffer.byteLength;
      chunkIndex += 1;

      this.updateStats(
        offset,
        file.size,
        displayName,
        fileIndex + 1,
        totalFiles
      );

      /** Keeps at most MAX_UNACKED_CHUNKS chunks outstanding. */
      await this.drainChunkAcks(MAX_UNACKED_CHUNKS);
    }

    /** Every chunk must be acknowledged before the file is closed out. */
    await this.drainChunkAcks(0);

    const finalChecksum = checksumToString(checksum);

    const endMessage: FileEndMessage = {
      type: 'FILE_END',
      fileId,
      checksum: finalChecksum,
    };

    const verification = this.trackFileVerification(fileId, finalChecksum);

    await this.sendData(JSON.stringify(endMessage));

    /** Waits until the receiver reconstructed and verified the whole file. */
    await verification;
  }

  private chunkAckKey(fileId: string, chunkIndex: number): string {
    return `${fileId}:${chunkIndex}`;
  }

  private trackChunkAck(fileId: string, chunkIndex: number): void {
    this.pendingChunkAcks.set(
      this.chunkAckKey(fileId, chunkIndex),
      createDeferred()
    );
  }

  private discardChunkAck(fileId: string, chunkIndex: number): void {
    this.pendingChunkAcks.delete(this.chunkAckKey(fileId, chunkIndex));
  }

  /**
   * Waits until no more than `limit` chunks are still unacknowledged. Map
   * iteration order is insertion order, so the oldest outstanding chunk is
   * always the one awaited.
   */
  private async drainChunkAcks(limit: number): Promise<void> {
    while (this.pendingChunkAcks.size > limit) {
      const oldest = this.pendingChunkAcks.values().next().value;

      if (!oldest) return;

      await oldest.promise;
    }
  }

  private resolveChunkAck(fileId: string, chunkIndex: number): void {
    const key = this.chunkAckKey(fileId, chunkIndex);

    const pending = this.pendingChunkAcks.get(key);

    if (!pending) return;

    this.pendingChunkAcks.delete(key);

    pending.resolve();
  }

  private trackFileVerification(
    fileId: string,
    expectedChecksum: string
  ): Promise<void> {
    const deferred = createDeferred();

    this.pendingFileVerification = { fileId, expectedChecksum, ...deferred };

    return deferred.promise;
  }

  private resolveFileVerification(fileId: string, checksum: string): void {
    const pending = this.pendingFileVerification;

    if (!pending || pending.fileId !== fileId) return;

    this.pendingFileVerification = null;

    if (checksum !== pending.expectedChecksum) {
      pending.reject(
        new Error(
          'The receiver reported a different checksum for the transferred file.'
        )
      );

      return;
    }

    pending.resolve();
  }

  public handleIncomingData(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      this.handleControlMessage(data);
      return;
    }

    if (!(data instanceof ArrayBuffer)) {
      return;
    }

    if (!this.localDirectConfirmed) {
      this.failTransfer('File data arrived before direct P2P verification.');
      return;
    }

    const current = this.currentFile;

    if (!current) {
      this.failTransfer('Received file data without an active file transfer.');
      return;
    }

    const metadata = current.pendingChunkMetadata;

    if (!metadata) {
      this.failTransfer('Received binary data without FILE_CHUNK metadata.');
      return;
    }

    if (metadata.fileId !== current.fileId) {
      this.failTransfer('Received chunk belongs to an unexpected file.');
      return;
    }

    if (metadata.chunkIndex !== current.expectedChunkIndex) {
      this.failTransfer('Duplicate or out-of-order chunk received.');
      return;
    }

    if (metadata.byteLength !== data.byteLength) {
      this.failTransfer('Received chunk size does not match metadata.');
      return;
    }

    current.chunks.push(data);
    current.receivedBytes += data.byteLength;
    current.checksum = updateChecksum(current.checksum, new Uint8Array(data));
    current.expectedChunkIndex += 1;
    current.pendingChunkMetadata = null;

    /** Application-level ACK, drives the sender's in-flight window. */
    void this.sendData(
      JSON.stringify({
        type: 'FILE_CHUNK_ACK',
        fileId: current.fileId,
        chunkIndex: metadata.chunkIndex,
      } satisfies FileChunkAckMessage)
    ).catch(() => {
      this.failTransfer('Failed to acknowledge the received chunk.');
    });

    this.updateStats(
      current.receivedBytes,
      current.fileSize,
      current.relativePath || current.fileName
    );
  }

  private handleControlMessage(data: string): void {
    let parsed: ControlMessage;

    try {
      parsed = JSON.parse(data) as ControlMessage;
    } catch {
      this.failTransfer('Invalid transfer metadata received.');
      return;
    }

    switch (parsed.type) {
      case 'DIRECT_READY': {
        this.markRemoteReady();

        void this.sendData(
          JSON.stringify({
            type: 'DIRECT_READY_ACK',
          } satisfies DirectReadyAckMessage)
        ).catch(() => {
          this.failConnection(
            'Failed to acknowledge the direct P2P connection.'
          );
        });

        /**
         * The peer is ready. Confirm our own candidate pair (and reject relay)
         * even if this side never calls verifyDirectConnection() itself, which
         * is the normal case for a pure receiver.
         */
        if (!this.directConnectionVerified) {
          void this.verifyDirectConnection().catch(() => undefined);
        }

        break;
      }

      case 'DIRECT_READY_ACK': {
        /**
         * Liveness echo only. Readiness is NOT taken from the ACK: a peer acks
         * immediately, before it has inspected its own candidate pair, so
         * treating the ACK as readiness let data start flowing while the peer
         * was still verifying. Only the peer's own DIRECT_READY counts.
         */
        break;
      }

      case 'FILE_START': {
        if (this.currentFile) {
          this.failTransfer(
            'A new file started before the previous one finished.'
          );

          return;
        }

        this.currentFile = {
          ...parsed,
          chunks: [],
          receivedBytes: 0,
          checksum: FNV_OFFSET_BASIS,
          expectedChunkIndex: 0,
          pendingChunkMetadata: null,
        };

        this.startTime = Date.now();
        this.lastSpeedCheckTime = Date.now();
        this.lastBytesCount = 0;
        this.lastSpeed = 0;

        this.onProgressCallback?.({
          status: 'transferring',
          currentFileName: parsed.relativePath || parsed.fileName,
          fileSize: parsed.fileSize,
          transferredBytes: 0,
          progress: 0,
          serverRole: 'signaling-only',
        });

        break;
      }

      case 'FILE_CHUNK': {
        const current = this.currentFile;

        if (!current || current.fileId !== parsed.fileId) {
          this.failTransfer('Invalid or missing file chunk metadata.');
          return;
        }

        if (parsed.chunkIndex !== current.expectedChunkIndex) {
          this.failTransfer('Invalid chunk index received.');
          return;
        }

        if (current.pendingChunkMetadata) {
          this.failTransfer(
            'Received new chunk metadata before the previous chunk was processed.'
          );

          return;
        }

        current.pendingChunkMetadata = parsed;

        break;
      }

      case 'FILE_CHUNK_ACK': {
        this.resolveChunkAck(parsed.fileId, parsed.chunkIndex);
        break;
      }

      case 'FILE_END': {
        this.finishReceivedFile(parsed);
        break;
      }

      case 'FILE_VERIFIED': {
        this.resolveFileVerification(parsed.fileId, parsed.checksum);
        break;
      }

      case 'FILE_ERROR': {
        this.failTransfer(parsed.error);
        break;
      }

      default:
        break;
    }
  }

  private finishReceivedFile(message: FileEndMessage): void {
    const current = this.currentFile;

    if (!current || current.fileId !== message.fileId) {
      this.rejectReceivedFile(
        message.fileId,
        'Received FILE_END for an unknown file.'
      );

      return;
    }

    if (current.pendingChunkMetadata) {
      this.rejectReceivedFile(
        current.fileId,
        'A file chunk was not completely received.'
      );

      return;
    }

    if (current.chunks.length !== current.totalChunks) {
      this.rejectReceivedFile(
        current.fileId,
        'Not all file chunks were received.'
      );

      return;
    }

    if (current.receivedBytes !== current.fileSize) {
      this.rejectReceivedFile(
        current.fileId,
        'Received file size does not match the expected size.'
      );

      return;
    }

    const calculatedChecksum = checksumToString(current.checksum);

    if (calculatedChecksum !== message.checksum) {
      this.rejectReceivedFile(
        current.fileId,
        'File integrity check failed. The transfer was discarded.'
      );

      return;
    }

    this.downloadFile(
      current.chunks,
      current.relativePath || current.fileName,
      current.fileType
    );

    this.currentFile = null;

    /** Tells the sender the file was fully reconstructed and verified. */
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

    this.onProgressCallback?.({
      status: 'completed',
      progress: 100,
      timeRemaining: 0,
      connectionType: this.reportedConnectionType(),
    });
  }

  /**
   * Reports a receive-side failure to the sender and locally. The channel state
   * is unrecoverable at this point, so both sides tear down.
   */
  private rejectReceivedFile(fileId: string | undefined, error: string): void {
    const payload: FileErrorMessage = { type: 'FILE_ERROR', error };

    if (fileId) {
      payload.fileId = fileId;
    }

    void this.sendData(JSON.stringify(payload)).catch(() => undefined);

    this.failTransfer(error);
  }

  /**
   * SCTP exposes the negotiated message ceiling on newer browsers. Use it when
   * available, but always retain a conservative fallback for browsers that do
   * not expose RTCSctpTransport.maxMessageSize.
   */
  private getSafeChunkSize(): number {
    const negotiated = this.peerConnection?.sctp?.maxMessageSize;

    if (typeof negotiated === 'number' && Number.isFinite(negotiated) && negotiated > 0) {
      return Math.max(8 * 1024, Math.min(CHUNK_SIZE, negotiated - MESSAGE_SIZE_HEADROOM));
    }

    return CHUNK_SIZE;
  }

  private async sendData(data: string | ArrayBuffer): Promise<void> {
    const channel = this.assertChannelOpen();

    const byteLength =
      typeof data === 'string'
        ? new TextEncoder().encode(data).byteLength
        : data.byteLength;

    const negotiated = this.peerConnection?.sctp?.maxMessageSize;
    if (typeof negotiated === 'number' && negotiated > 0 && byteLength > negotiated) {
      throw new Error(`The direct channel only accepts messages up to ${Math.floor(negotiated / 1024)} KiB.`);
    }

    /**
     * Backpressure only: this loop waits for buffer space for as long as the
     * channel stays open. It never gives up on a deadline.
     */
    while (
      channel.bufferedAmount + byteLength >
      DATA_CHANNEL_HIGH_WATER_MARK
    ) {
      await this.waitForBufferedAmountLow(channel);

      if (this.isClosed) {
        throw new Error('The transfer was closed while waiting for buffer space.');
      }

      if (channel.readyState !== 'open') {
        throw new Error(
          'The direct data channel closed while waiting for buffer space.'
        );
      }
    }

    try {
      /**
       * `RTCDataChannel.send` is an overload set (string | Blob | ArrayBuffer |
       * ArrayBufferView). TypeScript cannot resolve an overload from a union
       * argument, so each variant is dispatched on its own narrowed branch.
       */
      if (typeof data === 'string') {
        channel.send(data);
      } else {
        channel.send(data);
      }
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
    if (channel.bufferedAmount <= DATA_CHANNEL_LOW_WATER_MARK) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;

        settled = true;

        window.clearTimeout(timer);

        channel.removeEventListener('bufferedamountlow', onLow);

        resolve();
      };

      const onLow = () => {
        cleanup();
      };

      /** Wake-up only; the caller re-checks the buffer and keeps waiting. */
      const timer = window.setTimeout(cleanup, BUFFER_WAKEUP_INTERVAL);

      channel.addEventListener('bufferedamountlow', onLow, { once: true });

      /** Covers the race where the buffer drains before the listener attaches. */
      if (channel.bufferedAmount <= DATA_CHANNEL_LOW_WATER_MARK) {
        cleanup();
      }
    });
  }

  /**
   * Every await in this service is released here. With no timeouts, this is the
   * single escape hatch for pending operations, so it must be called from every
   * failure and from close().
   */
  private rejectPendingOperations(error: Error): void {
    for (const pending of this.pendingChunkAcks.values()) {
      pending.reject(error);
    }

    this.pendingChunkAcks.clear();

    if (this.pendingFileVerification) {
      const pending = this.pendingFileVerification;

      this.pendingFileVerification = null;

      pending.reject(error);
    }

    this.remoteReadyWaiters.splice(0).forEach((waiter) => {
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

    const timeDelta = (now - this.lastSpeedCheckTime) / 1000;

    /**
     * Speed is recomputed at most a few times per second. In between, the last
     * measured value is reused instead of reporting 0, which made the UI flicker.
     */
    if (timeDelta > 0.3) {
      this.lastSpeed = (currentTransferred - this.lastBytesCount) / timeDelta;

      this.lastSpeedCheckTime = now;
      this.lastBytesCount = currentTransferred;
    }

    const speed = this.resolveSpeed(currentTransferred, now);

    const remainingBytes = Math.max(0, totalSize - currentTransferred);

    this.onProgressCallback?.({
      currentFileName: fileName,
      currentFileIndex,
      totalFiles,
      fileSize: totalSize,
      transferredBytes: currentTransferred,
      progress:
        totalSize > 0
          ? Math.min(100, (currentTransferred / totalSize) * 100)
          : 100,
      speed,
      timeRemaining: speed > 0 ? remainingBytes / speed : 0,
      connectionType: this.reportedConnectionType(),
      serverRole: 'signaling-only',
    });
  }

  /**
   * Instantaneous speed when available, average since the current file started
   * otherwise (the first samples of a file have no instantaneous value yet).
   */
  private resolveSpeed(currentTransferred: number, now: number): number {
    if (this.lastSpeed > 0) {
      return this.lastSpeed;
    }

    const elapsedSeconds =
      this.startTime > 0 ? (now - this.startTime) / 1000 : 0;

    if (elapsedSeconds > 0.5 && currentTransferred > 0) {
      return currentTransferred / elapsedSeconds;
    }

    return 0;
  }

  private downloadFile(
    chunks: ArrayBuffer[],
    fileName: string,
    fileType: string
  ): void {
    const blob = new Blob(chunks, {
      type: fileType || 'application/octet-stream',
    });

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName.split('/').pop() || fileName;

    document.body.appendChild(anchor);

    anchor.click();

    document.body.removeChild(anchor);

    /** Revoke after the browser picked the blob up. Not a failure deadline. */
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1_000);
  }

  /** Connection-level failure (ICE, channel, relay rejection). */
  private failConnection(message: string): void {
    this.fail(message);
  }

  /** Transfer-level failure (protocol violation, integrity, peer error). */
  private failTransfer(message: string): void {
    this.fail(message);
  }

  private fail(message: string): void {
    /**
     * Sticky guards. close() no longer clears them, which is what previously
     * let a single failure re-enter here through the close handlers and emit
     * several 'failed' states for one root cause.
     */
    if (this.isClosed || this.hasFailed) {
      return;
    }

    this.hasFailed = true;

    this.rejectPendingOperations(new Error(message));

    this.onProgressCallback?.({
      status: 'failed',
      error: message,
      connectionType: this.reportedConnectionType(),
      serverRole: 'signaling-only',
    });

    this.close();
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }

    /** Sticky, so late close/error events are never reported as failures. */
    this.isClosed = true;

    this.rejectPendingOperations(new Error('WebRTC transfer was closed.'));

    if (this.dataChannel) {
      try {
        this.dataChannel.onopen = null;
        this.dataChannel.onmessage = null;
        this.dataChannel.onerror = null;
        this.dataChannel.onclose = null;

        this.dataChannel.close();
      } catch {
        // Ignore close errors.
      }
    }

    this.dataChannel = null;

    if (this.peerConnection) {
      try {
        this.peerConnection.onicecandidate = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.ondatachannel = null;

        this.peerConnection.close();
      } catch {
        // Ignore close errors.
      }
    }

    this.peerConnection = null;

    this.channelOpened = false;
    this.directConnectionVerified = false;
    this.localDirectConfirmed = false;
    this.directCandidateType = 'unknown';
    this.verificationPromise = null;

    this.currentFile = null;

    this.localReadySent = false;
    this.remoteReady = false;
    this.remoteReadyWaiters = [];

    this.pendingCandidates = [];
    this.pendingChunkAcks.clear();
    this.pendingFileVerification = null;
  }
}

/**
 * FNV-1a (32-bit). The prime is 0x01000193 (16777619); the previous value
 * 0x010001f3 was a typo. Both peers share this code, so checksums matched
 * anyway, but the algorithm no longer matches its name and reference vectors.
 */
function updateChecksum(current: number, bytes: Uint8Array): number {
  let checksum = current >>> 0;

  for (let index = 0; index < bytes.length; index += 1) {
    checksum ^= bytes[index];
    checksum = Math.imul(checksum, FNV_PRIME) >>> 0;
  }

  return checksum >>> 0;
}

function checksumToString(checksum: number): string {
  return (checksum >>> 0).toString(16).padStart(8, '0');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
