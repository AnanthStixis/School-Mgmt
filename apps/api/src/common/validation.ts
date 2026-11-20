import { BadRequestException } from '@nestjs/common';
import { normalisePhone } from '../auth/sms';

/** Turns '' and whitespace into null, trims everything else. */
export const clean = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

export function phoneOrThrow(raw: string, field = 'mobile number'): string {
  const p = normalisePhone(raw);
  if (!p) throw new BadRequestException(`Invalid ${field}: ${raw}`);
  return p;
}

export function optionalPhone(raw: string | null | undefined, field?: string): string | null {
  const c = clean(raw);
  return c ? phoneOrThrow(c, field) : null;
}

export const emailOrNull = (raw: string | null | undefined): string | null => clean(raw)?.toLowerCase() ?? null;

/** Parses YYYY-MM-DD (also accepts DD-MM-YYYY and DD/MM/YYYY, common in Indian school records). */
export function parseDate(raw: string | null | undefined): Date | null {
  const c = clean(raw);
  if (!c) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(c);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(c))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else throw new BadRequestException(`Invalid date: ${c} (use YYYY-MM-DD)`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new BadRequestException(`Invalid date: ${c}`);
  return dt;
}

/**
 * Keys the client actually sent. DTO classes declare optional fields, which exist on the
 * instance as `undefined`, so Object.keys(dto) would list every field.
 */
export const sentKeys = (o: object): string[] => Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k);

/** Copy without undefined values, safe to spread over stored settings. */
export const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
