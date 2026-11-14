/** Presentation-only formatting. Never rounds values that are fed back to the API. */

export function hoursFromSeconds(seconds: number): number {
  return seconds / 3600;
}

export function formatHours(seconds: number | null | undefined, digits = 1): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'bilinmiyor';
  return `${(seconds / 3600).toFixed(digits)} sa`;
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return 'bilinmiyor';
  return `%${(fraction * 100).toFixed(digits)}`;
}

export function formatDeg(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'bilinmiyor';
  return `${value.toFixed(digits)}°`;
}

export function formatNumber(value: number | null | undefined, digits = 2, unit = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'bilinmiyor';
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
  const ns = lat < 0 ? 'G' : 'K';
  const ew = lon < 0 ? 'B' : 'D';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
