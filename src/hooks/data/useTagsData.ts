import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Tag, CreateTagInput, UpdateTagInput, DEFAULT_TAGS } from '../../types/tag';
import { CompletedSession } from '../../types/session';
import { CoffeeCup } from '../../types/coffee';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
} from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { markGuestDataModified } from '../../services/sync/offlineOutbox';

interface UseTagsDataParams {
  isAuthenticated: boolean;
  isLoggingOut?: boolean;
  isAdoptionPaused?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  setSessions: React.Dispatch<React.SetStateAction<CompletedSession[]>>;
  setCoffeeCups: React.Dispatch<React.SetStateAction<CoffeeCup[]>>;
}

export function useTagsData({
  isAuthenticated,
  isLoggingOut = false,
  isAdoptionPaused = false,
  convexSync,
  setSessions,
  setCoffeeCups,
}: UseTagsDataParams) {
  const { isConvexConfigured, convexUser, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isAuthenticated;
  const isCloudModeRef = useRef<boolean>(isCloudMode);
  isCloudModeRef.current = isCloudMode;

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
      const currentId = activeTagIdRef.current;
      if (tagList.length === 0) {
        if (currentId !== null) setActiveTagId(null);
        return;
      }
      if (currentId && tagList.some((t) => t.id === currentId && !t.isArchived)) {
        return;
      }
      const nextActive = tagList.find((t) => !t.isArchived);
      setActiveTagId(nextActive?.id ?? null);
    },
    [setActiveTagId]
  );

  const wasAuthenticatedOrLoggingOutRef = useRef<boolean>(
    isAuthenticated || isLoggingOut
  );

  // Initial load of guest tags from localStorage
  useEffect(() => {
    let cancelled = false;
    tagRepository.getAll().then((loaded) => {
      if (cancelled) return;
      setGuestTags(loaded);
      if (!isCloudModeRef.current) {
        ensureValidActiveTag(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ensureValidActiveTag]);

  // Reload guest tags from storage once sign-out completes or session drops,
  // avoiding hardcoded DEFAULT_TAGS that would overwrite local guest deletions.
  useEffect(() => {
    const isAuthOrLoggingOut = isAuthenticated || isLoggingOut;
    const wasAuthOrLoggingOut = wasAuthenticatedOrLoggingOutRef.current;
    wasAuthenticatedOrLoggingOutRef.current = isAuthOrLoggingOut;

    if (wasAuthOrLoggingOut && !isAuthOrLoggingOut) {
      let cancelled = false;
      tagRepository.getAll().then((loaded) => {
        if (cancelled) return;
        setGuestTags(loaded);
        ensureValidActiveTag(loaded);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [isAuthenticated, isLoggingOut, ensureValidActiveTag]);

  // When signed in, Convex user.tags is the direct source of truth.
  // Return [] while convexUser is still loading so deleted default tags never flash back.
  const tags = useMemo<Tag[]>(() => {
    if (isCloudMode) {
      return Array.isArray(convexUser?.tags) ? (convexUser.tags as Tag[]) : [];
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

      const updatedTags = await tagRepository.getAll();
      setGuestTags(updatedTags);
      if (activeTagIdRef.current === id) {
        const nextActive = updatedTags.find((t) => !t.isArchived);
        setActiveTagId(nextActive?.id ?? null);
      }
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
