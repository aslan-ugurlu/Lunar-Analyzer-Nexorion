/**
 * §11.4 external deep links. Schemas verified 2026-11-14 by reading each app's own
 * JavaScript and loading the links in headless Chrome (see README "Deep-link doğrulaması").
 *
 * LROC QuickMap: `?proj=27&center=<lon>,<lat>&resolution=<m/px>`
 *   proj 27 = "Stereographic (South Pole)" IAU2000:30120 (+a=b=1737400, lat_0=-90, lon_0=0);
 *   `center` is in degrees (display projection longlat); map products use Moon Mean-Earth.
 *   quickmap.lroc.asu.edu 301-redirects to quickmap.lroc.im-ldi.com keeping the query.
 *   Status: VERIFIED (centered exactly on both test sites).
 *
 * NASA Moon Trek: `#v=0.1&x=<m>&y=<m>&z=<zoom>&p=urn:ogc:def:crs:IAU2000::30120&d=&b=moon`
 *   x/y in south-polar stereographic metres (sphere 1737400 m, central meridian 0).
 *   Status: URL format VERIFIED, but centring is UNRELIABLE (one test site centred in
 *   4/4 loads, the other in 2/7; the rest opened the pole overview) -> labelled so.
 *   Moon Trek does not document which lunar frame its coordinates use.
 */

const MOON_RADIUS_M = 1737400;

export interface SiteLink {
  href: string;
  label: string;
  caveat: string;
  centering: 'VERIFIED' | 'UNRELIABLE';
}

function validSouthPole(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= -80 && lon >= -180 && lon <= 180;
}

/** Spherical south-polar stereographic (k0 = 1 at the pole), east-positive longitude. */
export function southPolarStereographic(latDeg: number, lonDeg: number): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + phi / 2);
  return { x: rho * Math.sin(lambda), y: rho * Math.cos(lambda) };
}

function fixed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
}

export function quickMapUrl(lat: number, lon: number): string | null {
  if (!validSouthPole(lat, lon)) return null;
  const params = new URLSearchParams({ proj: '27', center: `${fixed(lon, 6)},${fixed(lat, 6)}`, resolution: '20' });
  return `https://quickmap.lroc.im-ldi.com/?${params.toString().replace(/%2C/g, ',')}`;
}

export function moonTrekUrl(lat: number, lon: number): string | null {
  if (!validSouthPole(lat, lon)) return null;
  const { x, y } = southPolarStereographic(lat, lon);
  const projection = encodeURIComponent('urn:ogc:def:crs:IAU2000::30120');
  return `https://trek.nasa.gov/moon/#v=0.1&x=${fixed(x, 1)}&y=${fixed(y, 1)}&z=8&p=${projection}&d=&b=moon`;
}

export function siteLinks(lat: number, lon: number): SiteLink[] {
  const links: SiteLink[] = [];
  const qm = quickMapUrl(lat, lon);
  if (qm) {
    links.push({
      href: qm,
      label: 'LROC QuickMap’te Aç',
      caveat: 'Güney kutbu stereografik görünüm, bu koordinata ortalanır (20 m/piksel).',
      centering: 'VERIFIED',
    });
  }
  const trek = moonTrekUrl(lat, lon);
  if (trek) {
    links.push({
      href: trek,
      label: 'NASA Moon Trek’te Aç',
      caveat: 'Güney kutbu görünümü açılır; koordinata odaklanma her açılışta garanti değil (bazen kutup genel görünümü açılır).',
      centering: 'UNRELIABLE',
    });
  }
  return links;
}
