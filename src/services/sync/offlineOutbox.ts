import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { MlEvent, SessionAttempt } from '../../types/telemetry';

export const LOCAL_DATA_OWNER_KEY = 'pomodor_local_data_owner_v1';
export const GUEST_DATA_MODIFIED_KEY = 'pomodor_guest_modified_v1';
export const OFFLINE_OUTBOX_KEY = 'pomodor_offline_outbox_v1';

const MAX_OUTBOX_ENTRIES = 2000;

export type LocalDataOwner = 'guest' | `user:${string}`;

export type OutboxOperation =
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'record_session';
      payload: {
        localId: string;
        tagId?: string;
        sessionType: SessionType;
        durationSeconds: number;
        completedAt: string;
        timerRunId?: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'add_coffee';
      payload: {
        localId: string;
        date: string;
        tagId?: string;
        createdAt: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'remove_coffee';
      payload: {
        id: string;
        date: string;
        tagId?: string;
        createdAt: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'create_tag';
      payload: {
        id: string;
        name: string;
        color: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'update_tag';
      payload: {
        id: string;
        name?: string;
        color?: string;
        isArchived?: boolean;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'remove_tag';
      payload: {
        id: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'update_settings';
      payload: Partial<
        Pick<
          UserSettings,
          | 'workDurationMinutes'
          | 'shortBreakDurationMinutes'
          | 'longBreakDurationMinutes'
          | 'longBreakInterval'
          | 'autoStartBreaks'
          | 'autoStartPomodoros'
          | 'soundVolume'
          | 'soundEnabled'
          | 'keepAwake'
        >
      >;
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'update_profile';
      payload: {
        displayName?: string;
        avatarEmoji?: string;
        dailyGoalMinutes?: number;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'reset_all';
      payload: {
        scope: 'sessions-only' | 'factory-reset';
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'upsert_telemetry_attempt';
      payload: SessionAttempt;
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'discard_telemetry_attempt';
      payload: {
        attemptId: string;
      };
    }
  | {
      id: string;
      ownerUserId: string;
      createdAtMs: number;
      kind: 'record_telemetry_events';
      payload: {
        events: MlEvent[];
      };
    };

type OutboxInput =
  | { kind: 'record_session'; payload: Extract<OutboxOperation, { kind: 'record_session' }>['payload'] }
  | { kind: 'add_coffee'; payload: Extract<OutboxOperation, { kind: 'add_coffee' }>['payload'] }
  | { kind: 'remove_coffee'; payload: Extract<OutboxOperation, { kind: 'remove_coffee' }>['payload'] }
  | { kind: 'create_tag'; payload: Extract<OutboxOperation, { kind: 'create_tag' }>['payload'] }
  | { kind: 'update_tag'; payload: Extract<OutboxOperation, { kind: 'update_tag' }>['payload'] }
  | { kind: 'remove_tag'; payload: Extract<OutboxOperation, { kind: 'remove_tag' }>['payload'] }
  | { kind: 'update_settings'; payload: Extract<OutboxOperation, { kind: 'update_settings' }>['payload'] }
  | { kind: 'update_profile'; payload: Extract<OutboxOperation, { kind: 'update_profile' }>['payload'] }
  | { kind: 'reset_all'; payload: Extract<OutboxOperation, { kind: 'reset_all' }>['payload'] }
  | { kind: 'upsert_telemetry_attempt'; payload: SessionAttempt }
  | { kind: 'discard_telemetry_attempt'; payload: { attemptId: string } }
  | { kind: 'record_telemetry_events'; payload: { events: MlEvent[] } };

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function makeOpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
  if (owner && owner.startsWith('user:')) {
    return owner.slice(5);
  }
  return null;
}

const outboxListeners = new Set<() => void>();
const ownerListeners = new Set<() => void>();

function notifyOutboxListeners(): void {
  outboxListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore listener errors
    }
  });
}

function notifyOwnerListeners(): void {
  ownerListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore listener errors
    }
  });
}

export function subscribeOutboxChange(listener: () => void): () => void {
  outboxListeners.add(listener);
  return () => {
    outboxListeners.delete(listener);
  };
}

export function subscribeLocalDataOwnerChange(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

export function setLocalDataOwner(owner: LocalDataOwner): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCAL_DATA_OWNER_KEY, owner);
    if (owner !== 'guest') {
      storage.removeItem(GUEST_DATA_MODIFIED_KEY);
    }
    notifyOwnerListeners();
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
      notifyOwnerListeners();
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
    notifyOwnerListeners();
  } catch {
    // Ignore storage errors
  }
}

export function readOfflineOutbox(ownerUserId?: string): OutboxOperation[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFLINE_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (item): item is OutboxOperation =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.ownerUserId === 'string' &&
        typeof item.kind === 'string' &&
        item.payload !== undefined
    );
    return ownerUserId ? valid.filter((op) => op.ownerUserId === ownerUserId) : valid;
  } catch {
    return [];
  }
}

function writeOfflineOutbox(ops: OutboxOperation[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (ops.length === 0) {
      storage.removeItem(OFFLINE_OUTBOX_KEY);
    } else {
      const bounded = ops.length > MAX_OUTBOX_ENTRIES ? ops.slice(-MAX_OUTBOX_ENTRIES) : ops;
      storage.setItem(OFFLINE_OUTBOX_KEY, JSON.stringify(bounded));
    }
    notifyOutboxListeners();
  } catch {
    // Ignore storage quota errors
  }
}

export function clearOfflineOutbox(ownerUserId?: string): void {
  if (!ownerUserId) {
    writeOfflineOutbox([]);
    return;
  }
  const remaining = readOfflineOutbox().filter((op) => op.ownerUserId !== ownerUserId);
  writeOfflineOutbox(remaining);
}

export function removeOutboxOperation(opId: string): void {
  const remaining = readOfflineOutbox().filter((op) => op.id !== opId);
  writeOfflineOutbox(remaining);
}

export function hasPendingOutboxOperations(ownerUserId?: string): boolean {
  return readOfflineOutbox(ownerUserId).length > 0;
}

export function getPendingSettingsPatch(
  ownerUserId: string
): Extract<OutboxOperation, { kind: 'update_settings' }>['payload'] | null {
  const ops = readOfflineOutbox(ownerUserId).filter(
    (op): op is Extract<OutboxOperation, { kind: 'update_settings' }> => op.kind === 'update_settings'
  );
  if (ops.length === 0) return null;
  return ops.reduce((acc, op) => ({ ...acc, ...op.payload }), {});
}

export function getPendingProfilePatch(
  ownerUserId: string
): Extract<OutboxOperation, { kind: 'update_profile' }>['payload'] | null {
  const ops = readOfflineOutbox(ownerUserId).filter(
    (op): op is Extract<OutboxOperation, { kind: 'update_profile' }> => op.kind === 'update_profile'
  );
  if (ops.length === 0) return null;
  return ops.reduce((acc, op) => ({ ...acc, ...op.payload }), {});
}

export function enqueueOutboxOperation(ownerUserId: string, input: OutboxInput): OutboxOperation | null {
  if (!ownerUserId) return null;
  let all = readOfflineOutbox();
  const now = Date.now();

  if (input.kind === 'update_settings') {
    const cleanPatch = Object.fromEntries(
      Object.entries(input.payload).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanPatch).length === 0) return null;
    const idx = all.findIndex(
      (op) => op.ownerUserId === ownerUserId && op.kind === 'update_settings'
    );
    if (idx !== -1) {
      const existing = all[idx] as Extract<OutboxOperation, { kind: 'update_settings' }>;
      const merged: Extract<OutboxOperation, { kind: 'update_settings' }> = {
        ...existing,
        createdAtMs: now,
        payload: { ...existing.payload, ...cleanPatch },
      };
      all[idx] = merged;
      writeOfflineOutbox(all);
      return merged;
    }
    const created: OutboxOperation = {
      id: makeOpId(),
      ownerUserId,
      createdAtMs: now,
      kind: 'update_settings',
      payload: cleanPatch,
    };
    all.push(created);
    writeOfflineOutbox(all);
    return created;
  }

  if (input.kind === 'update_profile') {
    const cleanPatch = Object.fromEntries(
      Object.entries(input.payload).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanPatch).length === 0) return null;
    const idx = all.findIndex(
      (op) => op.ownerUserId === ownerUserId && op.kind === 'update_profile'
    );
    if (idx !== -1) {
      const existing = all[idx] as Extract<OutboxOperation, { kind: 'update_profile' }>;
      const merged: Extract<OutboxOperation, { kind: 'update_profile' }> = {
        ...existing,
        createdAtMs: now,
        payload: { ...existing.payload, ...cleanPatch },
      };
      all[idx] = merged;
      writeOfflineOutbox(all);
      return merged;
    }
    const created: OutboxOperation = {
      id: makeOpId(),
      ownerUserId,
      createdAtMs: now,
      kind: 'update_profile',
      payload: cleanPatch,
    };
    all.push(created);
    writeOfflineOutbox(all);
    return created;
  }

  if (input.kind === 'remove_coffee') {
    // Cancel out an un-synced local add_coffee for the same cup
    const pendingAddIdx = all.findIndex(
      (op) =>
        op.ownerUserId === ownerUserId &&
        op.kind === 'add_coffee' &&
        (op.payload.localId === input.payload.id || op.payload.createdAt === input.payload.createdAt)
    );
    if (pendingAddIdx !== -1) {
      all.splice(pendingAddIdx, 1);
      writeOfflineOutbox(all);
      return null;
    }
  }

  if (input.kind === 'update_tag') {
    // Merge into pending create_tag or update_tag for same tag ID
    const createIdx = all.findIndex(
      (op) =>
        op.ownerUserId === ownerUserId &&
        op.kind === 'create_tag' &&
        op.payload.id === input.payload.id
    );
    if (createIdx !== -1) {
      const createOp = all[createIdx] as Extract<OutboxOperation, { kind: 'create_tag' }>;
      all[createIdx] = {
        ...createOp,
        payload: {
          ...createOp.payload,
          ...(input.payload.name !== undefined ? { name: input.payload.name } : {}),
          ...(input.payload.color !== undefined ? { color: input.payload.color } : {}),
        },
      };
      if (input.payload.isArchived === undefined) {
        writeOfflineOutbox(all);
        return all[createIdx];
      }
    }
    const updateIdx = all.findIndex(
      (op) =>
        op.ownerUserId === ownerUserId &&
        op.kind === 'update_tag' &&
        op.payload.id === input.payload.id
    );
    if (updateIdx !== -1) {
      const existing = all[updateIdx] as Extract<OutboxOperation, { kind: 'update_tag' }>;
      const merged: Extract<OutboxOperation, { kind: 'update_tag' }> = {
        ...existing,
        createdAtMs: now,
        payload: {
          ...existing.payload,
          ...(input.payload.name !== undefined ? { name: input.payload.name } : {}),
          ...(input.payload.color !== undefined ? { color: input.payload.color } : {}),
          ...(input.payload.isArchived !== undefined ? { isArchived: input.payload.isArchived } : {}),
        },
      };
      all[updateIdx] = merged;
      writeOfflineOutbox(all);
      return merged;
    }
  }

  if (input.kind === 'remove_tag') {
    const hadPendingCreate = all.some(
      (op) =>
        op.ownerUserId === ownerUserId &&
        op.kind === 'create_tag' &&
        op.payload.id === input.payload.id
    );
    all = all.filter(
      (op) =>
        !(
          op.ownerUserId === ownerUserId &&
          (op.kind === 'create_tag' || op.kind === 'update_tag') &&
          op.payload.id === input.payload.id
        )
    );
    // Strip deleted tagId from any queued session/coffee ops
    all = all.map((op) => {
      if (op.ownerUserId !== ownerUserId) return op;
      if (op.kind === 'record_session' && op.payload.tagId === input.payload.id) {
        return { ...op, payload: { ...op.payload, tagId: undefined } };
      }
      if (op.kind === 'add_coffee' && op.payload.tagId === input.payload.id) {
        return { ...op, payload: { ...op.payload, tagId: undefined } };
      }
      return op;
    });
    if (hadPendingCreate) {
      writeOfflineOutbox(all);
      return null;
    }
  }

  if (input.kind === 'reset_all') {
    const isFactory = input.payload.scope === 'factory-reset';
    all = all.filter((op) => {
      if (op.ownerUserId !== ownerUserId) return true;
      if (
        op.kind === 'record_session' ||
        op.kind === 'add_coffee' ||
        op.kind === 'remove_coffee' ||
        op.kind === 'upsert_telemetry_attempt' ||
        op.kind === 'discard_telemetry_attempt' ||
        op.kind === 'record_telemetry_events' ||
        op.kind === 'reset_all'
      ) {
        return false;
      }
      if (
        isFactory &&
        (op.kind === 'create_tag' ||
          op.kind === 'update_tag' ||
          op.kind === 'remove_tag' ||
          op.kind === 'update_settings' ||
          op.kind === 'update_profile')
      ) {
        return false;
      }
      return true;
    });
  }

  if (input.kind === 'upsert_telemetry_attempt') {
    const idx = all.findIndex(
      (op) =>
        op.ownerUserId === ownerUserId &&
        op.kind === 'upsert_telemetry_attempt' &&
        op.payload.attemptId === input.payload.attemptId
    );
    if (idx !== -1) {
      all[idx] = {
        ...all[idx],
        createdAtMs: now,
        payload: input.payload,
      } as OutboxOperation;
      writeOfflineOutbox(all);
      return all[idx];
    }
  }

  if (input.kind === 'discard_telemetry_attempt') {
    all = all.filter(
      (op) =>
        !(
          op.ownerUserId === ownerUserId &&
          op.kind === 'upsert_telemetry_attempt' &&
          op.payload.attemptId === input.payload.attemptId
        )
    );
  }

  const created = {
    id: makeOpId(),
    ownerUserId,
    createdAtMs: now,
    ...input,
  } as OutboxOperation;

  all.push(created);
  writeOfflineOutbox(all);
  return created;
}
