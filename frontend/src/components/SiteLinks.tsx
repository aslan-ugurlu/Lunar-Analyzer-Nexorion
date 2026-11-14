import { siteLinks } from '../lib/deeplinks';
import { useApp } from '../state/AppState';
import { Icon } from './ui';

/** §11.4: both links target the same latitude/longitude of the card. */
export function SiteLinks({ lat, lon }: { lat: number; lon: number }) {
  const { mode } = useApp();
  const links = siteLinks(lat, lon);
  if (links.length === 0) return <p className="text-xs text-muted">Koordinat geçersiz; harici harita bağlantısı üretilmedi.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:gap-4">
      {links.map((link) => (
        <li key={link.href} className="min-w-0">
          <a className="link inline-flex items-center gap-1" href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
            <Icon name="external" className="h-3.5 w-3.5" />
            <span className="sr-only">(yeni sekmede açılır)</span>
          </a>
          {(mode === 'engineer' || link.centering === 'UNRELIABLE') && (
            <span className="block text-xs text-muted">{link.caveat}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
