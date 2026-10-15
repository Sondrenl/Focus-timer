/**
 * Coffee Tracker Data Model
 */
export interface CoffeeCup {
  id: string;
  date: string; // Format: YYYY-MM-DD
  tagId: string | null; // null if logged without a tag
  createdAt: string; // ISO 8601 string
}

export interface CoffeeTagBreakdown {
  tagId: string | null;
  name: string;
  color: string;
  count: number;
  percentage: number;
}
