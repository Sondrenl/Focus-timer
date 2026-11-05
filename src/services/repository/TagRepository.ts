import { Tag, CreateTagInput, UpdateTagInput, DEFAULT_TAGS } from '../../types/tag';
import { IStorageService } from '../storage/IStorageService';

export interface ITagRepository {
  getAll(): Promise<Tag[]>;
  getActive(): Promise<Tag[]>;
  getById(id: string): Promise<Tag | null>;
  create(input: CreateTagInput): Promise<Tag>;
  update(id: string, updates: UpdateTagInput): Promise<Tag | null>;
  archive(id: string): Promise<Tag | null>;
  unarchive(id: string): Promise<Tag | null>;
  delete(id: string): Promise<boolean>;
  saveAll(tags: Tag[]): Promise<void>;
  resetToDefaults(): Promise<Tag[]>;
}

const TAGS_STORAGE_KEY = 'tags_v1';
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

export { DEFAULT_TAGS } from "../../types/tag";

/**
 * Implementation of ITagRepository using injected IStorageService
 */
export class TagRepository implements ITagRepository {
  private storage: IStorageService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.seedDefaultTagsIfEmpty();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  private seedDefaultTagsIfEmpty(): void {
    const existing = this.storage.getItem<Tag[] | null>(TAGS_STORAGE_KEY, null);
    if (existing === null) {
      this.storage.setItem(TAGS_STORAGE_KEY, DEFAULT_TAGS);
    }
  }

  async getAll(): Promise<Tag[]> {
    const raw = this.storage.getItem<Tag[]>(TAGS_STORAGE_KEY, []);
    let needsMigration = false;
    const tags = raw.map((t) => {
      let updated = false;
      const isArchived = Boolean(t.isArchived);
      let updatedAt = t.updatedAt;
      if (!updatedAt) {
        updatedAt = t.createdAt || EPOCH_ISO;
        updated = true;
      }
      if (t.isArchived !== isArchived) {
        updated = true;
      }
      if (updated) {
        needsMigration = true;
      }
      return {
        ...t,
        isArchived,
        updatedAt,
      };
    });
    if (needsMigration) {
      this.storage.setItem(TAGS_STORAGE_KEY, tags);
    }
    return tags;
  }

  async getActive(): Promise<Tag[]> {
    const all = await this.getAll();
    return all.filter((tag) => !tag.isArchived);
  }

  async getById(id: string): Promise<Tag | null> {
    const all = await this.getAll();
    return all.find((tag) => tag.id === id) ?? null;
  }

  async create(input: CreateTagInput): Promise<Tag> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const nowIso = new Date().toISOString();
      const newTag: Tag = {
        id: `tag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: input.name.trim(),
        color: input.color,
        isArchived: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      all.push(newTag);
      this.storage.setItem(TAGS_STORAGE_KEY, all);
      return newTag;
    });
  }

  async update(id: string, updates: UpdateTagInput): Promise<Tag | null> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const index = all.findIndex((tag) => tag.id === id);
      if (index === -1) return null;

      const nowIso = new Date().toISOString();
      const updated: Tag = {
        ...all[index],
        ...updates,
        name: updates.name !== undefined ? updates.name.trim() : all[index].name,
        updatedAt: updates.updatedAt || nowIso,
      };
      all[index] = updated;
      this.storage.setItem(TAGS_STORAGE_KEY, all);
      return updated;
    });
  }

  async archive(id: string): Promise<Tag | null> {
    return this.update(id, { isArchived: true, updatedAt: new Date().toISOString() });
  }

  async unarchive(id: string): Promise<Tag | null> {
    return this.update(id, { isArchived: false, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const all = await this.getAll();
      const filtered = all.filter((tag) => tag.id !== id);
      if (filtered.length === all.length) return false;
      this.storage.setItem(TAGS_STORAGE_KEY, filtered);
      return true;
    });
  }

  async saveAll(tags: Tag[]): Promise<void> {
    return this.enqueue(async () => {
      this.storage.setItem(TAGS_STORAGE_KEY, tags);
    });
  }

  async resetToDefaults(): Promise<Tag[]> {
    return this.enqueue(async () => {
      const nowIso = new Date().toISOString();
      const freshDefaults = DEFAULT_TAGS.map((t) => ({ ...t, updatedAt: nowIso }));
      this.storage.setItem(TAGS_STORAGE_KEY, freshDefaults);
      return freshDefaults;
    });
  }
}
