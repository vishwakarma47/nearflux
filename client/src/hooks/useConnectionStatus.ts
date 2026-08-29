export function useConnectionStatus(isConnected: boolean) {
  return {
    label: isConnected ? 'Online' : 'Offline',
    className: isConnected ? 'is-online' : 'is-offline',
    dotClassName: isConnected ? 'online' : 'offline',
  };
}
