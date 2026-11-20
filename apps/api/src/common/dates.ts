import { BadRequestException } from '@nestjs/common';

/**
 * School dates are calendar days in India (IST, UTC+5:30, no daylight saving).
 * They are stored as Postgres DATE, which Prisma represents as midnight UTC.
 */
const IST_OFFSET_MS = 5.5 * 3600_000;

/** Today's date in India as YYYY-MM-DD. */
export const todayIST = (now = Date.now()): string => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

/** YYYY-MM-DD → Date at midnight UTC (how @db.Date values are stored). */
export function dayDate(d: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException(`Invalid date ${d} (use YYYY-MM-DD)`);
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) throw new BadRequestException(`Invalid date ${d}`);
  return dt;
}

export const dayString = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => dayString(new Date(dayDate(d).getTime() + n * 86_400_000));

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const weekday = (d: string) => WEEKDAYS[dayDate(d).getUTCDay()];
