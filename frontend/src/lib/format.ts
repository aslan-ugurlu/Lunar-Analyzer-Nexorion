/**
 * Presentation-only formatting. Never rounds values that are fed back to the API.
 * Units and words follow the interface language (en: "12.5 h", "40%"; tr: "12.5 sa", "%40");
 * the decimal point is kept in both languages so numbers read the same in every view.
 */
import { defineStrings, pick } from '../i18n';

const UNITS = defineStrings({
  en: { unknown: 'unknown', hours: 'h', percent: (v: string) => `${v}%`, north: 'N', south: 'S', east: 'E', west: 'W' },
  tr: { unknown: 'bilinmiyor', hours: 'sa', percent: (v: string) => `%${v}`, north: 'K', south: 'G', east: 'D', west: 'B' },
});

export function unknownText(): string {
  return pick(UNITS).unknown;
}

export function hoursFromSeconds(seconds: number): number {
  return seconds / 3600;
}

export function formatHours(seconds: number | null | undefined, digits = 1): string {
  const u = pick(UNITS);
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return u.unknown;
  return `${(seconds / 3600).toFixed(digits)} ${u.hours}`;
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  const u = pick(UNITS);
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return u.unknown;
  return u.percent((fraction * 100).toFixed(digits));
}

export function formatDeg(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return pick(UNITS).unknown;
  return `${value.toFixed(digits)}°`;
}

export function formatNumber(value: number | null | undefined, digits = 2, unit = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return pick(UNITS).unknown;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

export function formatViolationValue(value: number, unit: string): string {
  if (unit === 's') return formatHours(value, 2);
  if (unit === 'fraction') return formatPercent(value, 1);
  if (unit === 'deg') return formatDeg(value, 1);
  return String(value);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatLatLon(lat: number, lon: number): string {
  const u = pick(UNITS);
  const ns = lat < 0 ? u.south : u.north;
  const ew = lon < 0 ? u.west : u.east;
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
