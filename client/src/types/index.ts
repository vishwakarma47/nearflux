export * from '../../../shared/types/device.js';
export * from '../../../shared/types/socket.js';

export interface SelectedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  relativePath?: string;
}

export type TransferRole = 'sender' | 'receiver' | 'none';

export type TransferStatus =
  | 'idle'
  | 'pending_approval'
  | 'connecting'
  | 'checking_direct_connection'
  | 'ready_for_transfer'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TransferState {
  role: TransferRole;
  status: TransferStatus;
  currentFileName?: string;
  currentFileIndex?: number;
  totalFiles?: number;
  fileSize?: number;
  transferredBytes: number;
  progress: number;
  speed: number;
  timeRemaining: number;
  error?: string;
  peerDeviceName?: string;
  connectionType?: 'host' | 'srflx' | 'relay' | 'unknown';
  serverRole?: 'signaling-only';
}

export interface ReceivedText {
  text: string;
  fileName: string;
  fileSize: number;
  peerDeviceName?: string;
  receivedAt: string;
}

export interface TransferHistoryItem {
  id: string;
  direction: 'sent' | 'received';
  fileName: string;
  fileCount: number;
  totalBytes: number;
  peerDeviceName: string;
  status: 'completed' | 'failed' | 'cancelled';
  createdAt: string;
}
