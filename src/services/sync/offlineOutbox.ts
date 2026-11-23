export const LOCAL_DATA_OWNER_KEY = 'pomodor_local_data_owner_v1';
export const GUEST_DATA_MODIFIED_KEY = 'pomodor_guest_modified_v1';

export type LocalDataOwner = 'guest' | `user:${string}`;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getLocalDataOwner(): LocalDataOwner | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_DATA_OWNER_KEY);
    if (raw === 'guest') return 'guest';
    if (raw && raw.startsWith('user:') && raw.length > 5) {
      return raw as LocalDataOwner;
    }
    return null;
  } catch {
    return null;
  }
}

export function getLocalDataOwnerUserId(): string | null {
  const owner = getLocalDataOwner();
  return owner && owner.startsWith('user:') ? owner.slice(5) : null;
}

export function setLocalDataOwner(owner: LocalDataOwner): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCAL_DATA_OWNER_KEY, owner);
    if (owner !== 'guest') {
      storage.removeItem(GUEST_DATA_MODIFIED_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function markGuestDataModified(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const current = getLocalDataOwner();
    if (!current || current === 'guest') {
      storage.setItem(LOCAL_DATA_OWNER_KEY, 'guest');
      storage.setItem(GUEST_DATA_MODIFIED_KEY, '1');
    }
  } catch {
    // Ignore storage errors
  }
}

export function hasGuestDataBeenModified(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(GUEST_DATA_MODIFIED_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearGuestDataModifiedFlag(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(GUEST_DATA_MODIFIED_KEY);
  } catch {
    // Ignore storage errors
  }
}
