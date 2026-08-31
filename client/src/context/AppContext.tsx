import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Device,
  SelectedFile,
  TransferState,
  TransferHistoryItem,
  TransferRequestPayload,
  TransferResponsePayload,
  WebRTCSignalPayload,
} from '../types/index.js';
import { useTheme } from '../hooks/useTheme';
import { useDeviceName } from '../hooks/useDeviceName';
import { useSocket } from '../hooks/useSocket';
import { socketService } from '../services/socket.js';
import { WebRTCService } from '../services/webrtc.js';

interface AppContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  deviceName: string;
  updateDeviceName: (name: string) => void;
  isConnected: boolean;
  serverState: 'connecting' | 'slow' | 'online' | 'offline';
  currentDevice: Device | null;
  nearbyDevices: Device[];
  roomCode: string;
  isRoomCreator: boolean;
  roomError: string | null;
  joinRoom: (code: string) => void;
  createRoom: () => void;
  leaveRoom: () => void;
  closeRoom: () => void;
  selectedFiles: SelectedFile[];
  addFiles: (files: FileList | File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  selectedTargetDevices: Device[];
  toggleTargetDevice: (device: Device) => void;
  selectAllTargetDevices: () => void;
  clearTargetDevices: () => void;
  transferState: TransferState;
  incomingRequest: TransferRequestPayload | null;
  startTransfer: () => void;
  acceptIncomingRequest: () => void;
  rejectIncomingRequest: () => void;
  cancelTransfer: () => void;
  closeTransfer: () => void;
  transferHistory: TransferHistoryItem[];
  clearTransferHistory: () => void;
}

const initialTransferState: TransferState = {
  role: 'none',
  status: 'idle',
  transferredBytes: 0,
  progress: 0,
  speed: 0,
  timeRemaining: 0,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme, toggleTheme } = useTheme();
  const { deviceName, updateName } = useDeviceName();
  const socketState = useSocket(deviceName);
  const {
    isConnected,
    serverState,
    currentDevice,
    nearbyDevices,
    roomCode,
    isRoomCreator,
    roomError,
    joinRoom,
    createRoom,
    leaveRoom,
    closeRoom,
    updateRemoteName,
  } = socketState;

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [selectedTargetDevices, setSelectedTargetDevices] = useState<Device[]>([]);
  const [transferState, setTransferState] = useState<TransferState>(initialTransferState);
  const [incomingRequest, setIncomingRequest] = useState<TransferRequestPayload | null>(null);
  const [transferHistory, setTransferHistory] = useState<TransferHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('NearFlux_transfer_history');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
    } catch {
      return [];
    }
  });
  const activeWebRTCInstances = useRef<Map<string, WebRTCService>>(new Map());
  const lastRecordedHistoryKey = useRef<string | null>(null);

  useEffect(() => () => {
    activeWebRTCInstances.current.forEach((instance) => instance.close());
    activeWebRTCInstances.current.clear();
  }, []);

  const handleUpdateDeviceName = (newName: string) => {
    updateName(newName);
    updateRemoteName(newName);
  };

  const addFiles = (filesToAdd: FileList | File[]) => {
    const fileArray = Array.from(filesToAdd);
    const newSelected: SelectedFile[] = fileArray.map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined;
      return {
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'Unknown format',
        relativePath,
      };
    });
    setSelectedFiles((previous) => [...previous, ...newSelected]);
    setTransferState(initialTransferState);
  };

  const removeFile = (id: string) => setSelectedFiles((previous) => previous.filter((file) => file.id !== id));
  const clearFiles = () => setSelectedFiles([]);

  const toggleTargetDevice = (device: Device) => {
    setSelectedTargetDevices((previous) => {
      const exists = previous.some((item) => item.id === device.id);
      return exists ? previous.filter((item) => item.id !== device.id) : [...previous, device];
    });
  };

  const selectAllTargetDevices = () => setSelectedTargetDevices([...nearbyDevices]);
  const clearTargetDevices = () => setSelectedTargetDevices([]);

  useEffect(() => {
    const socket = socketService.getSocket();
    if (!socket) return;

    const handleTransferRequest = (payload: TransferRequestPayload) => {
      if (payload.roomCode === roomCode) setIncomingRequest(payload);
    };

    const handleTransferResponse = async (payload: TransferResponsePayload) => {
      if (payload.roomCode !== roomCode || !currentDevice || !payload.accepted) {
        if (!payload.accepted && payload.roomCode === roomCode) {
          setTransferState((previous) => ({
            ...previous,
            status: 'failed',
            error: payload.reason || 'Transfer request declined by recipient.',
          }));
        }
        return;
      }

      setTransferState((previous) => ({ ...previous, status: 'connecting', serverRole: 'signaling-only' }));
      const webrtc = new WebRTCService(currentDevice.id, payload.targetId, true, roomCode);
      activeWebRTCInstances.current.set(payload.targetId, webrtc);
      webrtc.setProgressCallback((update) => setTransferState((previous) => ({ ...previous, ...update })));

      webrtc.onChannelOpen(async () => {
        try {
          await webrtc.sendFiles(selectedFiles.map((selected) => ({ file: selected.file, relativePath: selected.relativePath })));
        } catch (error) {
          setTransferState((previous) => ({
            ...previous,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Direct P2P transfer failed.',
          }));
        }
      });

      webrtc.initialize();
      await webrtc.createOffer();
    };

    const handleWebRTCOffer = async (payload: WebRTCSignalPayload) => {
      if (payload.roomCode !== roomCode || !currentDevice) return;
      const webrtc = new WebRTCService(currentDevice.id, payload.senderId, false, roomCode);
      activeWebRTCInstances.current.set(payload.senderId, webrtc);
      webrtc.setProgressCallback((update) => setTransferState((previous) => ({ ...previous, ...update })));
      webrtc.onChannelOpen(async () => {
        try {
          await webrtc.verifyDirectConnection();
        } catch (error) {
          setTransferState((previous) => ({
            ...previous,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Direct P2P connection failed.',
          }));
        }
      });
      webrtc.initialize();
      await webrtc.handleOffer(payload.signal as RTCSessionDescriptionInit);
    };

    const handleWebRTCAnswer = async (payload: WebRTCSignalPayload) => {
      const instance = activeWebRTCInstances.current.get(payload.senderId);
      if (payload.roomCode === roomCode && instance) await instance.handleAnswer(payload.signal as RTCSessionDescriptionInit);
    };

    const handleIceCandidate = async (payload: WebRTCSignalPayload) => {
      const instance = activeWebRTCInstances.current.get(payload.senderId);
      if (payload.roomCode === roomCode && instance) await instance.addIceCandidate(payload.signal as RTCIceCandidateInit);
    };

    const handleTransferCancel = (payload: { roomCode: string }) => {
      if (payload.roomCode !== roomCode) return;
      activeWebRTCInstances.current.forEach((instance) => instance.close());
      activeWebRTCInstances.current.clear();
      setTransferState((previous) => previous.status === 'idle' ? previous : { ...initialTransferState, status: 'cancelled', error: 'Transfer was cancelled.' });
    };

    socket.on('transfer-request', handleTransferRequest);
    socket.on('transfer-response', handleTransferResponse);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);
    socket.on('transfer-cancel', handleTransferCancel);

    return () => {
      socket.off('transfer-request', handleTransferRequest);
      socket.off('transfer-response', handleTransferResponse);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
      socket.off('transfer-cancel', handleTransferCancel);
    };
  }, [currentDevice, roomCode, selectedFiles]);

  const startTransfer = () => {
    if (!currentDevice || !roomCode || selectedTargetDevices.length === 0 || selectedFiles.length === 0) return;
    setTransferState({
      ...initialTransferState,
      role: 'sender',
      status: 'pending_approval',
      peerDeviceName: selectedTargetDevices.map((device) => device.name).join(', '),
      totalFiles: selectedFiles.length,
      fileSize: selectedFiles.reduce((total, file) => total + file.size, 0),
      serverRole: 'signaling-only',
    });

    selectedTargetDevices.forEach((targetDevice) => {
      socketService.sendTransferRequest({
        roomCode,
        senderId: currentDevice.id,
        senderName: currentDevice.name,
        targetId: targetDevice.id,
        files: selectedFiles.map((file) => ({ name: file.relativePath || file.name, size: file.size, type: file.type })),
      });
    });
  };

  const acceptIncomingRequest = () => {
    if (!incomingRequest || !currentDevice) return;
    setTransferState({
      ...initialTransferState,
      role: 'receiver',
      status: 'connecting',
      peerDeviceName: incomingRequest.senderName,
      totalFiles: incomingRequest.files.length,
      fileSize: incomingRequest.files.reduce((total, file) => total + file.size, 0),
      serverRole: 'signaling-only',
    });
    socketService.sendTransferResponse({
      roomCode: incomingRequest.roomCode,
      senderId: incomingRequest.senderId,
      targetId: currentDevice.id,
      accepted: true,
    });
    setIncomingRequest(null);
  };

  const rejectIncomingRequest = () => {
    if (!incomingRequest || !currentDevice) return;
    socketService.sendTransferResponse({
      roomCode: incomingRequest.roomCode,
      senderId: incomingRequest.senderId,
      targetId: currentDevice.id,
      accepted: false,
      reason: 'User declined request.',
    });
    setIncomingRequest(null);
  };

  useEffect(() => {
    localStorage.setItem('NearFlux_transfer_history', JSON.stringify(transferHistory));
  }, [transferHistory]);

  useEffect(() => {
    const status = transferState.status;
    if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
      lastRecordedHistoryKey.current = null;
      return;
    }
    if (!transferState.peerDeviceName) return;
    const historyKey = [status, transferState.role, transferState.peerDeviceName, transferState.currentFileName, transferState.fileSize, transferState.transferredBytes, transferState.totalFiles].join('|');
    if (lastRecordedHistoryKey.current === historyKey) return;
    lastRecordedHistoryKey.current = historyKey;
    const historyItem: TransferHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      direction: transferState.role === 'receiver' ? 'received' : 'sent',
      fileName: transferState.currentFileName || (transferState.totalFiles && transferState.totalFiles > 1 ? `${transferState.totalFiles} files` : 'File transfer'),
      fileCount: transferState.totalFiles || 1,
      totalBytes: transferState.fileSize || transferState.transferredBytes,
      peerDeviceName: transferState.peerDeviceName,
      status,
      createdAt: new Date().toISOString(),
    };
    setTransferHistory((previous) => [historyItem, ...previous].slice(0, 30));
  }, [transferState]);

  const clearTransferHistory = () => setTransferHistory([]);

  const closeTransfer = () => {
    activeWebRTCInstances.current.forEach((instance) => instance.close());
    activeWebRTCInstances.current.clear();
    setTransferState(initialTransferState);
  };

  const cancelTransfer = () => {
    if (currentDevice && roomCode) {
      selectedTargetDevices.forEach((targetDevice) => {
        socketService.cancelTransfer({ roomCode, senderId: currentDevice.id, targetId: targetDevice.id });
      });
    }
    closeTransfer();
  };

  return (
    <AppContext.Provider value={{
      theme,
      toggleTheme,
      deviceName,
      updateDeviceName: handleUpdateDeviceName,
      isConnected,
      serverState,
      currentDevice,
      nearbyDevices,
      roomCode,
      isRoomCreator,
      roomError,
      joinRoom,
      createRoom,
      leaveRoom,
      closeRoom,
      selectedFiles,
      addFiles,
      removeFile,
      clearFiles,
      selectedTargetDevices,
      toggleTargetDevice,
      selectAllTargetDevices,
      clearTargetDevices,
      transferState,
      incomingRequest,
      startTransfer,
      acceptIncomingRequest,
      rejectIncomingRequest,
      cancelTransfer,
      closeTransfer,
      transferHistory,
      clearTransferHistory,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
