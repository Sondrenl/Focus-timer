import { CoffeeCup } from '../../types/coffee';

export interface ICoffeeRepository {
  getAll(): Promise<CoffeeCup[]>;
  getCupsForDate(date: string): Promise<CoffeeCup[]>;
  addCup(date: string, tagId: string | null): Promise<CoffeeCup>;
  removeCup(date: string, tagId?: string | null): Promise<boolean>;
  saveAll(cups: CoffeeCup[]): Promise<void>;
  clear(): Promise<void>;
}
