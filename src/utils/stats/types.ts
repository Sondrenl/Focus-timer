export type TimePeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface CustomDateRange {
  start: string;
  end: string;
}

export interface PeriodBounds {
  startDate: Date;
  endDate: Date;
  periodLabel: string;
  sanitizedCustomRange: CustomDateRange;
}

export interface TagStat {
  tagId: string;
  name: string;
  color: string;
  isArchived: boolean;
  totalSeconds: number;
  hours: number;
  percentage: number;
  sessionCount: number;
}

export interface ActivityBarStat {
  key: string;
  label: string;
  subLabel?: string;
  totalSeconds: number;
  hours: number;
  sessionCount: number;
}

export interface ProductiveMetric {
  title: string;
  value: string;
  subtext: string;
  hasData: boolean;
}

export interface CoffeePeakMetric {
  title: string;
  value: string;
  subtext: string;
  hasData: boolean;
}

export interface StatSession {
  id: string;
  completedAt: string;
  durationSeconds: number;
  sessionType: string;
  tagId?: string | null;
}

export interface StatCoffeeCup {
  date: string;
  tagId?: string | null;
}
