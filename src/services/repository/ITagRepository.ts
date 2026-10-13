import { Tag, CreateTagInput, UpdateTagInput } from '../../types/tag';

/**
 * Tag Repository Interface following DDD / Repository pattern.
 * Enables decoupling business logic from persistence mechanism.
 */
export interface ITagRepository {
  /** Fetch all tags, including archived */
  getAll(): Promise<Tag[]>;

  /** Fetch active (non-archived) tags */
  getActive(): Promise<Tag[]>;

  /** Fetch a specific tag by ID */
  getById(id: string): Promise<Tag | null>;

  /** Create a new tag */
  create(input: CreateTagInput): Promise<Tag>;

  /** Update an existing tag */
  update(id: string, updates: UpdateTagInput): Promise<Tag | null>;

  /** Soft-delete a tag (mark isArchived = true) */
  archive(id: string): Promise<Tag | null>;

  /** Unarchive a tag (mark isArchived = false) */
  unarchive(id: string): Promise<Tag | null>;

  /** Permanently delete a tag */
  delete(id: string): Promise<boolean>;
}
