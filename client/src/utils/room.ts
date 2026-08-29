const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
}

export function isValidRoomCode(value: string): boolean {
  return /^FLUX-[A-Z0-9]{4}$/.test(value);
}

export function getRawRoomCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('room');
}

export function generateRoomCode(): string {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    suffix += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return `FLUX-${suffix}`;
}

export function getRoomCodeFromUrl(): string | null {
  const rawCode = getRawRoomCodeFromUrl();
  if (!rawCode) return null;
  const normalizedCode = normalizeRoomCode(rawCode);
  return isValidRoomCode(normalizedCode) ? normalizedCode : null;
}

export function updateRoomUrl(roomCode: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (roomCode) url.searchParams.set('room', roomCode);
  else url.searchParams.delete('room');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function getShareLink(roomCode: string): string {
  if (typeof window === 'undefined') return `?room=${roomCode}`;
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', roomCode);
  return url.toString();
}
