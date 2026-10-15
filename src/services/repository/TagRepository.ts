import { ITagRepository } from './ITagRepository';
import { Tag, CreateTagInput, UpdateTagInput } from '../../types/tag';
import { IStorageService } from '../storage/IStorageService';

const TAGS_STORAGE_KEY = 'tags_v1';

/**
 * Initial curated tags with Material Design 3 pastel tones
 */
export const DEFAULT_TAGS: Tag[] = [
  {
    id: 'tag-deep-work',
    name: 'Deep Work',
    color: '#7E57C2', // Pastel Purple
    isArchived: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tag-study',
    name: 'Study & Learning',
    color: '#5C6BC0', // Pastel Indigo
    isArchived: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tag-coding',
    name: 'Coding & Dev',
    color: '#00897B', // Pastel Teal
    isArchived: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tag-writing',
    name: 'Writing',
    color: '#D81B60', // Pastel Rose
    isArchived: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tag-admin',
    name: 'Admin & Emails',
    color: '#FB8C00', // Pastel Orange
    isArchived: false,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Implementation of ITagRepository using injected IStorageService
 */
export class TagRepository implements ITagRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
    this.seedDefaultTagsIfEmpty();
  }

  private seedDefaultTagsIfEmpty(): void {
    const existing = this.storage.getItem<Tag[] | null>(TAGS_STORAGE_KEY, null);
    if (existing === null) {
      this.storage.setItem(TAGS_STORAGE_KEY, DEFAULT_TAGS);
    }
  }

  async getAll(): Promise<Tag[]> {
    return this.storage.getItem<Tag[]>(TAGS_STORAGE_KEY, []);
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
    const all = await this.getAll();
    const newTag: Tag = {
      id: `tag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: input.name.trim(),
      color: input.color,
      isArchived: false,
      createdAt: new Date().toISOString(),
    };
    all.push(newTag);
    this.storage.setItem(TAGS_STORAGE_KEY, all);
    return newTag;
  }

  async update(id: string, updates: UpdateTagInput): Promise<Tag | null> {
    const all = await this.getAll();
    const index = all.findIndex((tag) => tag.id === id);
    if (index === -1) return null;

    const updated: Tag = {
      ...all[index],
      ...updates,
      name: updates.name !== undefined ? updates.name.trim() : all[index].name,
    };
    all[index] = updated;
    this.storage.setItem(TAGS_STORAGE_KEY, all);
    return updated;
  }

  async archive(id: string): Promise<Tag | null> {
    return this.update(id, { isArchived: true });
  }

  async unarchive(id: string): Promise<Tag | null> {
    return this.update(id, { isArchived: false });
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((tag) => tag.id !== id);
    if (filtered.length === all.length) return false;
    this.storage.setItem(TAGS_STORAGE_KEY, filtered);
    return true;
  }

  async saveAll(tags: Tag[]): Promise<void> {
    this.storage.setItem(TAGS_STORAGE_KEY, tags);
  }

  async resetToDefaults(): Promise<Tag[]> {
    this.storage.setItem(TAGS_STORAGE_KEY, DEFAULT_TAGS);
    return DEFAULT_TAGS;
  }
}
