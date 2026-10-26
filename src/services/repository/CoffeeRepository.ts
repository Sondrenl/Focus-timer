import { ICoffeeRepository } from './ICoffeeRepository';
import { CoffeeCup } from '../../types/coffee';
import { IStorageService } from '../storage/IStorageService';

const COFFEE_STORAGE_KEY = 'coffee_cups_v1';

export class CoffeeRepository implements ICoffeeRepository {
  private storage: IStorageService;

  constructor(storage: IStorageService) {
    this.storage = storage;
  }

  async getAll(): Promise<CoffeeCup[]> {
    const raw = this.storage.getItem<CoffeeCup[]>(COFFEE_STORAGE_KEY, []);
    let needsMigration = false;
    const sanitized = raw.map((c) => {
      let date = c.date;
      if (!date) {
        needsMigration = true;
        date = c.createdAt ? c.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      } else if (date.length > 10) {
        needsMigration = true;
        date = date.slice(0, 10);
      }
      const tagId = c.tagId || null;
      if (c.tagId !== tagId) {
        needsMigration = true;
      }
      return {
        ...c,
        date,
        tagId,
        createdAt: c.createdAt || new Date().toISOString(),
      };
    });
    if (needsMigration) {
      this.storage.setItem(COFFEE_STORAGE_KEY, sanitized);
    }
    return sanitized;
  }

  async getCupsForDate(date: string): Promise<CoffeeCup[]> {
    const all = await this.getAll();
    return all.filter((cup) => cup.date === date);
  }

  async addCup(date: string, tagId: string | null = null): Promise<CoffeeCup> {
    const all = await this.getAll();
    const newCup: CoffeeCup = {
      id: `coffee-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      date,
      tagId: tagId || null,
      createdAt: new Date().toISOString(),
    };
    all.push(newCup);
    this.storage.setItem(COFFEE_STORAGE_KEY, all);
    return newCup;
  }

  async removeCup(date: string, tagId?: string | null, cupId?: string): Promise<CoffeeCup | null> {
    const all = await this.getAll();
    let removeIndex = -1;

    // 1. If explicit cupId provided, remove that specific cup
    if (cupId) {
      removeIndex = all.findIndex((c) => c.id === cupId);
    }

    // 2. Otherwise find the latest cup on the specified date matching tagId
    if (removeIndex < 0) {
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].date === date) {
          if (tagId === undefined || (all[i].tagId || null) === (tagId || null)) {
            removeIndex = i;
            break;
          }
        }
      }
    }

    if (removeIndex >= 0) {
      const removed = all.splice(removeIndex, 1)[0];
      this.storage.setItem(COFFEE_STORAGE_KEY, all);
      return removed;
    }
    return null;
  }

  async saveAll(cups: CoffeeCup[]): Promise<void> {
    this.storage.setItem(COFFEE_STORAGE_KEY, cups);
  }

  async clear(): Promise<void> {
    this.storage.setItem(COFFEE_STORAGE_KEY, []);
  }
}
