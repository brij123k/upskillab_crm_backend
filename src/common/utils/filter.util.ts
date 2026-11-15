import { Types } from 'mongoose';
/**
 * Shared helpers for list filters (date presets, custom ranges, safe regex).
 * Dates are computed in the server's local time zone, which main.ts pins to
 * Asia/Kolkata so "today" means the Indian business day.
 */

export type DateRange = { start: Date; end: Date };

/** Escape user input before using it inside a MongoDB $regex. */
export function escapeRegex(value: unknown): string {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" regex condition, safe for any user input. */
export function containsRegex(value: unknown) {
  return { $regex: escapeRegex(String(value).trim()), $options: 'i' };
}

/** Parse 'YYYY-MM-DD' as a LOCAL calendar day (not UTC midnight). */
export function parseDay(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Preset ranges used across the CRM filters.
 * today | yesterday | week (last 7 days incl. today) | last_week |
 * month (this calendar month) | last_month | year (this calendar year)
 */
export function presetRange(preset: unknown, now = new Date()): DateRange | null {
  const p = String(preset ?? '').toLowerCase().trim();
  const y = now.getFullYear();
  const mo = now.getMonth();

  switch (p) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': {
      const d = new Date(y, mo, now.getDate() - 1);
      return { start: startOfDay(d), end: endOfDay(d) };
    }
    case 'week':
    case 'this_week':
    case 'last7days':
    case 'last_7_days':
      return { start: startOfDay(new Date(y, mo, now.getDate() - 6)), end: endOfDay(now) };
    case 'last_week':
      return {
        start: startOfDay(new Date(y, mo, now.getDate() - 13)),
        end: endOfDay(new Date(y, mo, now.getDate() - 7)),
      };
    case 'month':
    case 'this_month':
      return { start: new Date(y, mo, 1), end: endOfDay(new Date(y, mo + 1, 0)) };
    case 'last_month':
      return { start: new Date(y, mo - 1, 1), end: endOfDay(new Date(y, mo, 0)) };
    case 'year':
    case 'this_year':
      return { start: new Date(y, 0, 1), end: endOfDay(new Date(y, 11, 31)) };
    default:
      return null;
  }
}

/**
 * Build a Mongo date condition from a preset and/or custom from/to.
 * A custom range (either side) overrides the preset. `to` is inclusive
 * (end of that day). Returns undefined when nothing applies.
 */
export function buildDateCondition(
  preset?: unknown,
  from?: unknown,
  to?: unknown,
): { $gte?: Date; $lte?: Date } | undefined {
  const fromDay = parseDay(from);
  const toDay = parseDay(to);

  if (fromDay || toDay) {
    const cond: { $gte?: Date; $lte?: Date } = {};
    if (fromDay) cond.$gte = startOfDay(fromDay);
    if (toDay) cond.$lte = endOfDay(toDay);
    return cond;
  }

  const range = presetRange(preset);
  return range ? { $gte: range.start, $lte: range.end } : undefined;
}

/** Normalise page / limit query params. */
export function parsePagination(page: unknown, limit: unknown, maxLimit = 10000) {
  const p = Math.max(1, Number.parseInt(String(page ?? 1), 10) || 1);
  const l = Math.min(maxLimit, Math.max(1, Number.parseInt(String(limit ?? 10), 10) || 10));
  return { page: p, limit: l, skip: (p - 1) * l };
}

/**
 * For aggregate $match on ObjectId fields: mongoose does NOT cast inside
 * aggregate pipelines, so match both the ObjectId and string form.
 */
export function idInAnyForm(ids: unknown[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const raw of ids || []) {
    if (raw === undefined || raw === null || raw === '') continue;
    const str = String(raw);
    if (seen.has(str)) continue;
    seen.add(str);
    out.push(str);
    if (Types.ObjectId.isValid(str) && /^[a-f0-9]{24}$/i.test(str)) out.push(new Types.ObjectId(str));
  }
  return out;
}
