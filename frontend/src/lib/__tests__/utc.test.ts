import { describe, expect, it } from 'vitest';
import { formatUtc, parseUtc, utcPartsToIso, utcPartsToMs } from '../utc';

describe('UTC handling is independent of the local time zone', () => {
  it('runs in a non-UTC zone (guards against accidental local-time parsing)', () => {
    expect(new Date(Date.UTC(2026, 11, 1, 12)).getTimezoneOffset()).not.toBe(0);
  });

  it('builds ISO-8601 Z from date + time inputs as UTC', () => {
    expect(utcPartsToIso('2026-12-01', '12:00')).toBe('2026-12-01T12:00:00Z');
    expect(utcPartsToIso('2035-12-31', '23:59')).toBe('2035-12-31T23:59:00Z');
  });

  it('rejects invalid calendar dates and malformed input', () => {
    expect(utcPartsToMs('2026-02-31', '00:00')).toBeNull();
    expect(utcPartsToMs('2026-13-01', '00:00')).toBeNull();
    expect(utcPartsToMs('2026-12-01', '24:00')).toBeNull();
    expect(utcPartsToMs('01/12/2026', '12:00')).toBeNull();
  });

  it('formats backend timestamps in UTC, not local time', () => {
    expect(formatUtc('2026-12-01T00:30:00Z')).toBe('2026-12-01 00:30 UTC');
    expect(formatUtc('2026-12-01T00:30:15.000Z', true)).toBe('2026-12-01 00:30:15 UTC');
  });

  it('refuses timestamps without an explicit UTC offset', () => {
    expect(() => parseUtc('2026-12-01T12:00:00')).toThrow();
    expect(parseUtc('2026-12-01T12:00:00+00:00')).toBe(Date.UTC(2026, 11, 1, 12));
  });
});
