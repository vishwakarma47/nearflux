import { useCallback, useEffect, useRef, useState } from 'react';
import { socketService } from '../services/socket';
import { Device, JoinRoomPayload } from '../types';
import { detectBrowser, detectDeviceType, detectOS } from '../utils/device';
import { generateRoomCode, getRawRoomCodeFromUrl, getRoomCodeFromUrl, isValidRoomCode, normalizeRoomCode, updateRoomUrl } from '../utils/room';

export function useSocket(deviceName: string) {
  const rawRoomCode = getRawRoomCodeFromUrl();
  const urlRoomCode = getRoomCodeFromUrl();
  const hasInvalidRoomParam = Boolean(rawRoomCode && !isValidRoomCode(normalizeRoomCode(rawRoomCode)));
  const [isConnected, setIsConnected] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [nearbyDevices, setNearbyDevices] = useState<Device[]>([]);
  const [roomCode, setRoomCode] = useState(() => urlRoomCode || (rawRoomCode ? '' : generateRoomCode()));
  const [isRoomCreator, setIsRoomCreator] = useState(() => !rawRoomCode);
  const [roomError, setRoomError] = useState<string | null>(() => hasInvalidRoomParam ? 'The room link is invalid. Use a code such as FLUX-8291.' : null);
  const roomCodeRef = useRef(roomCode);

  const makeJoinPayload = useCallback((code: string): JoinRoomPayload => ({
    roomCode: code,
    device: {
      name: deviceName,
      type: detectDeviceType(),
      os: detectOS(),
      browser: detectBrowser(),
    },
  }), [deviceName]);

  const emitJoin = useCallback((code: string) => {
    const socket = socketService.getSocket();
    if (socket?.connected) socket.emit('join-room', makeJoinPayload(code));
  }, [makeJoinPayload]);

  useEffect(() => {
    const socket = socketService.connect();

    const handleConnect = () => {
      setIsConnected(true);
      if (roomCodeRef.current) emitJoin(roomCodeRef.current);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      setNearbyDevices([]);
    };

    const handleRoomState = ({ roomCode: joinedCode, isCreator, currentDevice: device, devices }: {
      roomCode: string;
      isCreator: boolean;
      currentDevice: Device;
      devices: Device[];
    }) => {
      roomCodeRef.current = joinedCode;
      setRoomCode(joinedCode);
      setIsRoomCreator(isCreator);
      setCurrentDevice(device);
      setNearbyDevices(devices);
      setRoomError(null);
      updateRoomUrl(joinedCode);
    };

    const handleRoomError = ({ message }: { message: string }) => {
      setRoomError(message);
      setNearbyDevices([]);
    };

    const handleRoomClosed = () => {
      roomCodeRef.current = '';
      setRoomCode('');
      setIsRoomCreator(false);
      setCurrentDevice(null);
      setNearbyDevices([]);
      setRoomError('This room was closed by its creator. Create or join another room to continue.');
      updateRoomUrl(null);
    };

    const handleDeviceJoined = (device: Device) => {
      setNearbyDevices((prev) => {
        const exists = prev.some((item) => item.id === device.id);
        return exists ? prev.map((item) => (item.id === device.id ? device : item)) : [...prev, device];
      });
    };

    const handleDeviceUpdated = (device: Device) => {
      setCurrentDevice((prev) => (prev?.id === device.id ? device : prev));
      setNearbyDevices((prev) => prev.map((item) => (item.id === device.id ? device : item)));
    };

    const handleDeviceLeft = ({ id }: { id: string }) => {
      setNearbyDevices((prev) => prev.filter((device) => device.id !== id));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('room-state', handleRoomState);
    socket.on('room-error', handleRoomError);
    socket.on('room-closed', handleRoomClosed);
    socket.on('device-joined', handleDeviceJoined);
    socket.on('device-updated', handleDeviceUpdated);
    socket.on('device-left', handleDeviceLeft);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('room-state', handleRoomState);
      socket.off('room-error', handleRoomError);
      socket.off('room-closed', handleRoomClosed);
      socket.off('device-joined', handleDeviceJoined);
      socket.off('device-updated', handleDeviceUpdated);
      socket.off('device-left', handleDeviceLeft);
    };
  }, [emitJoin]);

  const joinRoom = useCallback((rawCode: string) => {
    const nextCode = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(nextCode)) {
      setRoomError('Enter a valid room code such as FLUX-8291.');
      return;
    }
    roomCodeRef.current = nextCode;
    setRoomCode(nextCode);
    setRoomError(null);
    setNearbyDevices([]);
    setCurrentDevice(null);
    updateRoomUrl(nextCode);
    emitJoin(nextCode);
  }, [emitJoin]);

  const createRoom = useCallback(() => {
    joinRoom(generateRoomCode());
  }, [joinRoom]);

  const leaveRoom = useCallback(() => {
    if (roomCodeRef.current) socketService.leaveRoom(roomCodeRef.current);
    roomCodeRef.current = '';
    setRoomCode('');
    setIsRoomCreator(false);
    setCurrentDevice(null);
    setNearbyDevices([]);
    updateRoomUrl(null);
  }, []);

  const closeRoom = useCallback(() => {
    if (roomCodeRef.current) socketService.closeRoom(roomCodeRef.current);
  }, []);

  const updateRemoteName = useCallback((newName: string) => {
    const socket = socketService.getSocket();
    if (socket?.connected) socket.emit('update-device-name', { name: newName });
  }, []);

  return {
    isConnected,
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
  };
}
