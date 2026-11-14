/**
 * UTC helpers. Inputs come from <input type="date"> ("YYYY-MM-DD") and
 * <input type="time"> ("HH:MM"), which carry NO timezone. They are interpreted
 * as UTC explicitly; `new Date("YYYY-MM-DDTHH:MM")` (local time!) is never used.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export const PRODUCT_START_MS = Date.UTC(2026, 0, 1);
export const PRODUCT_END_MS = Date.UTC(2036, 0, 1); // exclusive

/** Returns epoch ms for a UTC calendar date/time, or null if invalid. */
export function utcPartsToMs(date: string, time: string): number | null {
  const d = DATE_RE.exec(date.trim());
  const t = TIME_RE.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3] ?? '0')];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, da, h, mi, s);
  const back = new Date(ms);
  // Reject rollovers such as 2026-02-31.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) return null;
  return ms;
}

/** ISO-8601 with explicit Z, second precision: 2026-12-01T12:00:00Z */
export function msToIsoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function utcPartsToIso(date: string, time: string): string | null {
  const ms = utcPartsToMs(date, time);
  return ms === null ? null : msToIsoZ(ms);
}

/** Parse a backend UTC string (always Z-suffixed) to epoch ms. */
export function parseUtc(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !/Z$|[+-]00:?00$/.test(iso)) throw new Error(`Not a UTC timestamp: ${iso}`);
  return ms;
}

/** "2026-12-01 12:00 UTC" — always rendered in UTC, never local time. */
export function formatUtc(iso: string, withSeconds = false): string {
  const d = new Date(parseUtc(iso));
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return `${withSeconds ? `${base}:${p(d.getUTCSeconds())}` : base} UTC`;
}
