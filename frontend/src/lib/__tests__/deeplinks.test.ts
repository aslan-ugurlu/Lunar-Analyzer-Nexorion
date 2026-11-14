import { describe, expect, it } from 'vitest';
import { moonTrekUrl, quickMapUrl, siteLinks, southPolarStereographic } from '../deeplinks';

/**
 * Expected URLs are the exact links loaded in headless Chrome on 2026-11-14
 * (QuickMap centred on the projected point; Moon Trek format accepted).
 * Test sites are arbitrary south-pole coordinates, not official candidates.
 */
const SITE_A = { lat: -89.45, lon: -137.5 };
const SITE_B = { lat: -85.5, lon: 30.0 };

describe('south polar stereographic projection (sphere R = 1737.4 km)', () => {
  it('matches the coordinates QuickMap reported after centring', () => {
    const a = southPolarStereographic(SITE_A.lat, SITE_A.lon);
    expect(a.x).toBeCloseTo(-11267.5, 0);
    expect(a.y).toBeCloseTo(-12296.3, 0);
    const b = southPolarStereographic(SITE_B.lat, SITE_B.lon);
    expect(b.x).toBeCloseTo(68262.6, 0);
    expect(b.y).toBeCloseTo(118234.3, 0);
  });

  it('maps the pole to the origin', () => {
    const p = southPolarStereographic(-90, 45);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6);
  });
});

describe('LROC QuickMap URL contract', () => {
  it('site A', () => {
    expect(quickMapUrl(SITE_A.lat, SITE_A.lon)).toBe(
      'https://quickmap.lroc.im-ldi.com/?proj=27&center=-137.500000,-89.450000&resolution=20');
  });
  it('site B', () => {
    expect(quickMapUrl(SITE_B.lat, SITE_B.lon)).toBe(
      'https://quickmap.lroc.im-ldi.com/?proj=27&center=30.000000,-85.500000&resolution=20');
  });
});

describe('NASA Moon Trek URL contract', () => {
  it('site A', () => {
    expect(moonTrekUrl(SITE_A.lat, SITE_A.lon)).toBe(
      'https://trek.nasa.gov/moon/#v=0.1&x=-11267.5&y=-12296.3&z=8&p=urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120&d=&b=moon');
  });
  it('site B', () => {
    expect(moonTrekUrl(SITE_B.lat, SITE_B.lon)).toBe(
      'https://trek.nasa.gov/moon/#v=0.1&x=68262.6&y=118234.3&z=8&p=urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120&d=&b=moon');
  });
  it('uses the double-colon URN that Moon Trek accepts', () => {
    expect(decodeURIComponent(moonTrekUrl(-88, 10) ?? '')).toContain('IAU2000::30120');
  });
});

describe('input safety', () => {
  it.each([[NaN, 0], [-89, Infinity], [-70, 0], [-89, 200], [-91, 0]])('rejects %s, %s', (lat, lon) => {
    expect(quickMapUrl(lat, lon)).toBeNull();
    expect(moonTrekUrl(lat, lon)).toBeNull();
    expect(siteLinks(lat, lon)).toEqual([]);
  });

  it('both links target the same coordinate and Moon Trek is labelled unreliable', () => {
    const links = siteLinks(SITE_B.lat, SITE_B.lon);
    expect(links.map((l) => l.centering)).toEqual(['VERIFIED', 'UNRELIABLE']);
    expect(links.every((l) => l.href.startsWith('https://'))).toBe(true);
  });
});
