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
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { markGuestDataModified } from '../../services/sync/offlineOutbox';

interface UseTagsDataParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isAdoptionPaused?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useTagsData({
  isEffectiveAuthenticated,
  isAdoptionPaused = false,
  convexSync,
  setSessions,
  setCoffeeCups,
}: UseTagsDataParams) {
  const { isConvexConfigured, convexUser, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isEffectiveAuthenticated;

  const [guestTags, setGuestTags] = useState<Tag[]>(DEFAULT_TAGS);
  const [activeTagId, setActiveTagIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('active_tag_id_v1') || null;
    } catch {
      return null;
    }
  });
  const activeTagIdRef = useRef<string | null>(activeTagId);
  activeTagIdRef.current = activeTagId;

  const setActiveTagId = useCallback(
    (id: string | null, _options?: { skipTelemetry?: boolean }) => {
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

  const consumeSkipTagTelemetry = useCallback((): boolean => false, []);

  const ensureValidActiveTag = useCallback(
    (tagList: Tag[]) => {
      if (tagList.length === 0) return;
      const currentId = activeTagIdRef.current;
      if (currentId && tagList.some((t) => t.id === currentId && !t.isArchived)) {
        return;
      }
      const nextActive = tagList.find((t) => !t.isArchived);
      setActiveTagId(nextActive?.id ?? null);
    },
    [setActiveTagId]
  );

  // Initial load of guest tags from localStorage
  useEffect(() => {
    tagRepository.getAll().then((loaded) => {
      setGuestTags(loaded);
      ensureValidActiveTag(loaded);
    });
  }, [ensureValidActiveTag]);

  // Multi-tab BroadcastChannel sync for guest mode and resets
  useEffect(() => {
    const unsubTags = subscribeTags((incomingTags) => {
      setGuestTags(incomingTags);
      ensureValidActiveTag(incomingTags);
      void sessionRepository.getAll().then(setSessions);
    });

    const unsubReset = subscribeReset((scope) => {
      if (scope === 'factory-reset') {
        setGuestTags(DEFAULT_TAGS);
        setActiveTagId(DEFAULT_TAGS[0]?.id ?? null);
      }
    });

    const unsubAuth = subscribeAuthEvent((payload) => {
      if (payload.action === 'logout') {
        setGuestTags(DEFAULT_TAGS);
        setActiveTagId(DEFAULT_TAGS[0]?.id ?? null);
      }
    });

    return () => {
      unsubTags();
      unsubReset();
      unsubAuth();
    };
  }, [ensureValidActiveTag, setActiveTagId, setSessions]);

  // When signed in, Convex user.tags is the direct source of truth.
  const tags = useMemo<Tag[]>(() => {
    if (isCloudMode) {
      return Array.isArray(convexUser?.tags) ? (convexUser.tags as Tag[]) : DEFAULT_TAGS;
    }
    return guestTags;
  }, [isCloudMode, convexUser?.tags, guestTags]);

  useEffect(() => {
    if (isCloudMode && !isAdoptionPaused && Array.isArray(convexUser?.tags)) {
      ensureValidActiveTag(convexUser.tags as Tag[]);
    }
  }, [isCloudMode, isAdoptionPaused, convexUser?.tags, ensureValidActiveTag]);

  const createTag = useCallback(
    async (input: CreateTagInput): Promise<Tag> => {
      if (isCloudMode) {
        const created = await convexMutations.createTag({
          name: input.name,
          color: input.color,
        });
        const tag: Tag = created
          ? (created as Tag)
          : {
              id: `tag-${Date.now()}`,
              name: input.name,
              color: input.color,
              isArchived: false,
              createdAt: new Date().toISOString(),
            };
        setActiveTagId(tag.id);
        return tag;
      }

      const created = await tagRepository.create(input);
      markGuestDataModified();
      const updated = await tagRepository.getAll();
      setGuestTags(updated);
      setActiveTagId(created.id);
      broadcastTags(updated);
      return created;
    },
    [isCloudMode, convexMutations, setActiveTagId]
  );

  const updateTag = useCallback(
    async (id: string, updates: UpdateTagInput): Promise<Tag | null> => {
      if (isCloudMode) {
        const updated = await convexMutations.updateTag({
          id,
          name: updates.name,
          color: updates.color,
          isArchived: updates.isArchived,
        });
        return (updated as Tag | null) ?? null;
      }

      const result = await tagRepository.update(id, updates);
      markGuestDataModified();
      const updated = await tagRepository.getAll();
      setGuestTags(updated);
      ensureValidActiveTag(updated);
      broadcastTags(updated);
      return result;
    },
    [isCloudMode, convexMutations, ensureValidActiveTag]
  );

  const archiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      if (isCloudMode) {
        if (activeTagIdRef.current === id) {
          const nextActive = tags.find((t) => t.id !== id && !t.isArchived);
          setActiveTagId(nextActive?.id ?? null);
        }
        const updated = await convexMutations.updateTag({ id, isArchived: true });
        return (updated as Tag | null) ?? null;
      }

      const result = await tagRepository.archive(id);
      markGuestDataModified();
      const updated = await tagRepository.getAll();
      setGuestTags(updated);
      if (activeTagIdRef.current === id) {
        const nextActive = updated.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updated);
      return result;
    },
    [isCloudMode, tags, setActiveTagId, convexMutations]
  );

  const unarchiveTag = useCallback(
    async (id: string): Promise<Tag | null> => {
      if (isCloudMode) {
        const updated = await convexMutations.updateTag({ id, isArchived: false });
        return (updated as Tag | null) ?? null;
      }

      const result = await tagRepository.unarchive(id);
      markGuestDataModified();
      const updated = await tagRepository.getAll();
      setGuestTags(updated);
      if (!activeTagIdRef.current) {
        ensureValidActiveTag(updated);
      }
      broadcastTags(updated);
      return result;
    },
    [isCloudMode, convexMutations, ensureValidActiveTag]
  );

  const deleteTag = useCallback(
    async (id: string): Promise<boolean> => {
      if (isCloudMode) {
        if (activeTagIdRef.current === id) {
          const nextActive = tags.find((t) => t.id !== id && !t.isArchived);
          setActiveTagId(nextActive?.id ?? null);
        }
        const res = await convexMutations.removeTag({ id });
        return Boolean(res);
      }

      const success = await tagRepository.delete(id);
      markGuestDataModified();

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

      const updatedTags = await tagRepository.getAll();
      setGuestTags(updatedTags);
      if (activeTagIdRef.current === id) {
        const nextActive = updatedTags.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
      broadcastTags(updatedTags);
      return success;
    },
    [isCloudMode, tags, setActiveTagId, convexMutations, setSessions, setCoffeeCups]
  );

  const activeTags = useMemo(() => tags.filter((t) => !t.isArchived), [tags]);

  return {
    tags,
    setTags: setGuestTags,
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
