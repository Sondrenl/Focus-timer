import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput, DEFAULT_TAGS } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { CoffeeCup } from '../../types/coffee';
import {
  broadcastTags,
  subscribeAuthEvent,
  subscribeTags,
  broadcastCoffeeCups,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  telemetryTracker,
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import {
  enqueueOutboxOperation,
  getLocalDataOwnerUserId,
  markGuestDataModified,
  readOfflineOutbox,
  removeOutboxOperation,
} from '../../services/sync/offlineOutbox';

interface UseTagsDataParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady: boolean;
  isAdoptionPaused: boolean;
  currentUserId: string | null;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useTagsData({
  isEffectiveAuthenticated,
  isConvexAuthReady,
  isAdoptionPaused,
  currentUserId,
  convexSync,
  setSessions,
  setCoffeeCups,
}: UseTagsDataParams) {
  const {
    isConvexConfigured,
    isConvexConnected,
    convexUser,
    mutations: convexMutations,
  } = convexSync;

  const [tags, setTags] = useState<Tag[]>([]);
  const tagsRef = useRef<Tag[]>(tags);
  tagsRef.current = tags;

  const pendingTagMutationsRef = useRef<number>(0);
  const isConvexConnectedRef = useRef<boolean>(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;

  const [activeTagId, setActiveTagIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('active_tag_id_v1') || null;
    } catch {
      return null;
    }
  });
  const activeTagIdRef = useRef<string | null>(activeTagId);
  activeTagIdRef.current = activeTagId;

  const skipNextTagTelemetryRef = useRef<boolean>(false);

  const getActiveOwnerUserId = useCallback((): string | null => {
    return currentUserId ?? getLocalDataOwnerUserId();
  }, [currentUserId]);

  const setActiveTagId = useCallback(
    (id: string | null, options?: { skipTelemetry?: boolean }) => {
      if (id !== activeTagIdRef.current) {
        skipNextTagTelemetryRef.current = Boolean(options?.skipTelemetry);
      }
      activeTagIdRef.current = id;
      setActiveTagIdState(id);
      try {
        if (id) {
          localStorage.setItem('active_tag_id_v1', id);
        } else {
          localStorage.removeItem('active_tag_id_v1');
        }
      } catch {
        // Ignore storage error
      }
    },
    []
  );

  const consumeSkipTagTelemetry = useCallback((): boolean => {
    const shouldSkip = skipNextTagTelemetryRef.current;
    skipNextTagTelemetryRef.current = false;
    return shouldSkip;
  }, []);

  const ensureValidActiveTag = useCallback(
    (tagList: Tag[]) => {
      const currentId = activeTagIdRef.current;
      if (currentId && tagList.some((t) => t.id === currentId && !t.isArchived)) {
        return;
      }
      const nextActive = tagList.find((t) => !t.isArchived);
      setActiveTagId(nextActive?.id ?? null, { skipTelemetry: true });
    },
    [setActiveTagId]
  );

  // Initial load of tags from local storage
  useEffect(() => {
    async function initTags() {
      const loadedTags = await tagRepository.getAll();
      tagsRef.current = loadedTags;
      setTags(loadedTags);

      let storedTagId: string | null = null;
      try {
        storedTagId = localStorage.getItem('active_tag_id_v1');
      } catch {
        storedTagId = null;
      }

      if (storedTagId && loadedTags.some((t) => t.id === storedTagId && !t.isArchived)) {
        setActiveTagId(storedTagId, { skipTelemetry: true });
      } else {
        const firstActive = loadedTags.find((t) => !t.isArchived);
        setActiveTagId(firstActive?.id ?? null, { skipTelemetry: true });
      }
    }

    initTags();
  }, [setActiveTagId]);

  // Reactive adoption of Convex tags (paused during migration, outbox replay, and in-flight mutations)
  useEffect(() => {
    if (!isConvexAuthReady || isAdoptionPaused || !convexUser) return;
    if (pendingTagMutationsRef.current > 0) return;
    if (!Array.isArray(convexUser.tags)) return;

    const ownerId = getActiveOwnerUserId();
    const outboxOps = ownerId ? readOfflineOutbox(ownerId) : [];

    // If a factory reset is pending in the offline outbox, preserve reset tags until replayed
    if (outboxOps.some((op) => op.kind === 'reset_all' && op.payload.scope === 'factory-reset')) {
      return;
    }

    // Apply any un-flushed offline tag mutations on top of the server tag list so local edits
    // are never clobbered by unrelated user document updates (e.g., settings/profile saves)
    let nextTags: Tag[] = (convexUser.tags as Tag[]).map((t) => ({ ...t }));
    const nowIso = new Date().toISOString();

    for (const op of outboxOps) {
      if (op.kind === 'create_tag') {
        if (!nextTags.some((t) => t.id === op.payload.id)) {
          nextTags.push({
            id: op.payload.id,
            name: op.payload.name,
            color: op.payload.color,
            isArchived: false,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      } else if (op.kind === 'update_tag') {
        nextTags = nextTags.map((t) =>
          t.id === op.payload.id
            ? {
                ...t,
                ...(op.payload.name !== undefined ? { name: op.payload.name } : {}),
                ...(op.payload.color !== undefined ? { color: op.payload.color } : {}),
                ...(op.payload.isArchived !== undefined
                  ? { isArchived: op.payload.isArchived }
                  : {}),
              }
            : t
        );
      } else if (op.kind === 'remove_tag') {
        nextTags = nextTags.filter((t) => t.id !== op.payload.id);
      }
    }

    const prev = tagsRef.current;
    const isSame =
      prev.length === nextTags.length &&
      prev.every(
        (t, i) =>
          t.id === nextTags[i].id &&
          t.name === nextTags[i].name &&
          t.color === nextTags[i].color &&
          t.isArchived === nextTags[i].isArchived
      );

    if (!isSame) {
      tagsRef.current = nextTags;
      setTags(nextTags);
      void tagRepository.saveAll(nextTags);
    }
    ensureValidActiveTag(nextTags);
  }, [convexUser, isConvexAuthReady, isAdoptionPaused, getActiveOwnerUserId, ensureValidActiveTag]);

  // Multi-tab BroadcastChannel synchronization for tags, factory resets, and logout
  useEffect(() => {
    const unsubTags = subscribeTags((incomingTags) => {
      const incomingIds = new Set(incomingTags.map((t) => t.id));
      const hadRemovedTags = tagsRef.current.some((t) => !incomingIds.has(t.id));

      // Sender tab already wrote localStorage; only update local React state
      tagsRef.current = incomingTags;
      setTags(incomingTags);
      ensureValidActiveTag(incomingTags);

      if (hadRemovedTags) {
        void sessionRepository.getAll().then((reloadedSessions) => {
          setSessions(reloadedSessions);
        });
        telemetryTracker.invalidateDraftCache();
      }
    });

    const unsubReset = subscribeReset((scope) => {
      if (scope === 'factory-reset') {
        setActiveTagId(DEFAULT_TAGS[0]?.id ?? null, { skipTelemetry: true });
      }
    });

    const unsubAuth = subscribeAuthEvent((payload) => {
      if (payload.action === 'logout') {
        pendingTagMutationsRef.current = 0;
        const defaults = DEFAULT_TAGS.map((t) => ({ ...t }));
        tagsRef.current = defaults;
        setTags(defaults);
        setActiveTagId(defaults[0]?.id ?? null, { skipTelemetry: true });
      }
    });

    return () => {
      unsubTags();
      unsubReset();
      unsubAuth();
    };
  }, [ensureValidActiveTag, setActiveTagId, setSessions]);

  const createTag = useCallback(
    async (input: CreateTagInput): Promise<Tag> => {
      const created = await tagRepository.create(input);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }
      const updated = await tagRepository.getAll();
      tagsRef.current = updated;
      setTags(updated);
      setActiveTagId(created.id);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'create_tag',
              payload: {
                id: created.id,
                name: input.name,
                color: input.color,
              },
            })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingTagMutationsRef.current += 1;
          convexMutations
            .createTag({
              id: created.id,
              name: input.name,
              color: input.color,
            })
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingTagMutationsRef.current = Math.max(0, pendingTagMutationsRef.current - 1);
            });
        }
      }
      return created;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
      setActiveTagId,
    ]
  );

  const updateTag = useCallback(
    async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
      const result = await tagRepository.update(id, updates);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }
      const updated = await tagRepository.getAll();
      tagsRef.current = updated;
      setTags(updated);
      ensureValidActiveTag(updated);
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'update_tag',
              payload: {
                id,
                name: updates.name,
                color: updates.color,
                isArchived: updates.isArchived,
              },
            })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingTagMutationsRef.current += 1;
          convexMutations
            .updateTag({
              id,
              name: updates.name,
              color: updates.color,
              isArchived: updates.isArchived,
            })
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingTagMutationsRef.current = Math.max(0, pendingTagMutationsRef.current - 1);
            });
        }
      }
      return result;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
      ensureValidActiveTag,
    ]
  );

  const archiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.archive(id);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }
      const updated = await tagRepository.getAll();
      tagsRef.current = updated;
      setTags(updated);
      if (activeTagIdRef.current === id) {
        const nextActive = updated.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null, { skipTelemetry: true });
      }
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'update_tag',
              payload: { id, isArchived: true },
            })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingTagMutationsRef.current += 1;
          convexMutations
            .updateTag({ id, isArchived: true })
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingTagMutationsRef.current = Math.max(0, pendingTagMutationsRef.current - 1);
            });
        }
      }
      return result;
    },
    [
      setActiveTagId,
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

  const unarchiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      const result = await tagRepository.unarchive(id);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }
      const updated = await tagRepository.getAll();
      tagsRef.current = updated;
      setTags(updated);
      if (!activeTagIdRef.current) {
        ensureValidActiveTag(updated);
      }
      broadcastTags(updated);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'update_tag',
              payload: { id, isArchived: false },
            })
          : null;

        if (isConvexAuthReady && isConvexConnectedRef.current) {
          pendingTagMutationsRef.current += 1;
          convexMutations
            .updateTag({ id, isArchived: false })
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingTagMutationsRef.current = Math.max(0, pendingTagMutationsRef.current - 1);
            });
        }
      }
      return result;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
      ensureValidActiveTag,
    ]
  );

  const deleteTag = useCallback(
    async (id: string): Promise<boolean> => {
      const success = await tagRepository.delete(id);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }

      const currentSessions = await sessionRepository.getAll();
      const updatedSessions = currentSessions.map((s) =>
        s.tagId === id ? { ...s, tagId: null } : s
      );
      await sessionRepository.saveAll(updatedSessions);
      setSessions(updatedSessions);

      const currentCoffee = await coffeeRepository.getAll();
      const updatedCoffee = currentCoffee.map((cup) =>
        cup.tagId === id ? { ...cup, tagId: null } : cup
      );
      await coffeeRepository.saveAll(updatedCoffee);
      setCoffeeCups(updatedCoffee);
      broadcastCoffeeCups(updatedCoffee);

      await telemetryTracker.clearTagReferences(id);

      const updatedTags = await tagRepository.getAll();
      tagsRef.current = updatedTags;
      setTags(updatedTags);
      if (activeTagIdRef.current === id) {
        const nextActive = updatedTags.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null, { skipTelemetry: true });
      }
      broadcastTags(updatedTags);

      if (isConvexConfigured && isEffectiveAuthenticated) {
        const ownerId = getActiveOwnerUserId();
        const queuedOp = ownerId
          ? enqueueOutboxOperation(ownerId, {
              kind: 'remove_tag',
              payload: { id },
            })
          : null;

        // If queuedOp === null when ownerId was present, remove cancelled an un-synced offline create_tag
        const shouldSendRemove =
          isConvexAuthReady &&
          isConvexConnectedRef.current &&
          (!ownerId || queuedOp !== null);

        if (shouldSendRemove) {
          pendingTagMutationsRef.current += 1;
          convexMutations
            .removeTag({ id })
            .then(() => {
              if (queuedOp) removeOutboxOperation(queuedOp.id);
            })
            .catch(console.warn)
            .finally(() => {
              pendingTagMutationsRef.current = Math.max(0, pendingTagMutationsRef.current - 1);
            });
        }
      }
      return success;
    },
    [
      setActiveTagId,
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
      setSessions,
      setCoffeeCups,
    ]
  );

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  return {
    tags,
    setTags,
    activeTags,
    activeTagId,
    setActiveTagId,
    consumeSkipTagTelemetry,
    createTag,
    updateTag,
    archiveTag,
    unarchiveTag,
    deleteTag,
  };
}
