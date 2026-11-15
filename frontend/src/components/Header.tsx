import type { Health } from '../api/types';
import type { ApiError } from '../api/client';
import { useApp, type Mode } from '../state/AppState';
import { Icon } from './ui';

type ChipState = 'ok' | 'missing' | 'unknown' | 'info';

/** Status "LED" chip: state is conveyed by icon + text, the glowing dot is decorative. */
function Chip({ label, value, state }: { label: string; value: string; state: ChipState }) {
  const cls = {
    ok: 'border-go/45 text-go',
    missing: 'border-stop/55 text-stop',
    unknown: 'border-line text-muted',
    info: 'border-caution/45 text-caution',
  }[state];
  const icon = state === 'ok' ? 'check' : state === 'missing' ? 'stop' : state === 'info' ? 'alert' : 'question';
  return (
    <li className={`chip bg-[rgb(3_8_24/0.55)] font-mono ${cls}`}>
      <span className={`led ${state === 'ok' ? 'motion-safe:animate-pulse' : ''}`} aria-hidden />
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span className="text-ink">{label}:</span>
      <span>{value}</span>
    </li>
  );
}

/** Small decorative mission patch (crescent + orbit), not a NASA logo. */
function Patch() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <defs>
        <radialGradient id="patch-moon" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#e9eef9" />
          <stop offset="60%" stopColor="#9aa6bd" />
          <stop offset="100%" stopColor="#4b5670" />
        </radialGradient>
        <linearGradient id="patch-ring" x1="0" x2="1">
          <stop offset="0%" stopColor="#22e4ff" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#4cc9ff" />
          <stop offset="100%" stopColor="#1f62e0" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="#0b3d91" fillOpacity="0.55" stroke="#4cc9ff" strokeOpacity="0.5" />
      <circle cx="24" cy="25" r="11" fill="url(#patch-moon)" />
      <circle cx="20" cy="22" r="1.8" fill="#6b7690" />
      <circle cx="27" cy="29" r="2.4" fill="#6b7690" />
      <ellipse cx="24" cy="25" rx="20" ry="6.5" fill="none" stroke="url(#patch-ring)" strokeWidth="1.6" transform="rotate(-18 24 25)" />
      <circle cx="41" cy="17" r="1.7" fill="#22e4ff" />
    </svg>
  );
}

export function Header({ health, healthError }: { health: Health | null; healthError: ApiError | null }) {
  const { mode, setMode } = useApp();
  const online = health !== null && !(healthError && healthError.code === 'BACKEND_OFFLINE');
  const lola = health?.layers?.lola_240m;
  const resolutions = health ? Object.entries(health.datasets).filter(([, ok]) => ok).map(([id]) => id.match(/_(\d+)m$/)?.[1]).filter(Boolean) : [];
  const lodText = [...new Set(resolutions)].sort((a, b) => Number(b) - Number(a)).join(' · ');
  const anyErr = health?.layers ? Object.values(health.layers).some((l) => l.dem && l.err) : false;

  return (
    <header className="relative z-30 border-b border-line bg-[rgb(2_5_14/0.72)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Patch />
          <div className="min-w-0">
            <p className="eyebrow">NASA Space Apps 2026 · Mission Control</p>
            <h1 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">Lunar Analyzer</h1>
            <p className="text-xs text-muted sm:text-sm">
              Ay güney kutbu · NASA LOLA + NAIF SPICE · Güneş görünürlüğü ve geometrik Dünya görüşü (DTE) ön eleme
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ul className="flex flex-wrap gap-1.5" aria-label="Hizmet ve veri durumu">
            <Chip label="Backend" value={online ? 'Online' : healthError ? 'Offline' : 'kontrol ediliyor'} state={online ? 'ok' : healthError ? 'missing' : 'unknown'} />
            <Chip label="SPICE" value={!health ? '—' : health.spice_files_present ? 'dosyalar var' : 'eksik'} state={!health ? 'unknown' : health.spice_files_present ? 'ok' : 'missing'} />
            <Chip label="LOLA DEM" value={!health ? '—' : lola?.dem ?? health.datasets.lola_240m ? `${lodText} m` : '240 m eksik'} state={!health ? 'unknown' : lola?.dem ?? health.datasets.lola_240m ? 'ok' : 'missing'} />
            <Chip label="ERR" value={!health ? '—' : anyErr ? 'var' : 'yok'} state={!health ? 'unknown' : anyErr ? 'ok' : 'info'} />
            <Chip label="Clone" value={!health ? '—' : health.clone_profiles === 'NOT_PRECOMPUTED' ? 'hazır değil' : (health.clone_profiles ?? 'bilinmiyor')} state={!health ? 'unknown' : 'info'} />
            <li className="chip border-accent/45 bg-[rgb(3_8_24/0.55)] font-mono text-accent">
              <Icon name="clock" className="h-3.5 w-3.5" /> Tüm zamanlar UTC
            </li>
          </ul>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
      <p className="border-t border-caution/25 bg-caution/10 px-4 py-1.5 text-center text-xs text-caution">
        Ön eleme / karar destek aracıdır; iniş güvenliği, enerji üretimi ve RF bağlantısı garantisi değildir.
      </p>
    </header>
  );
}

const MODE_HINT: Record<Mode, string> = {
  public: 'Keşif arayüzü: adım adım sihirbaz ve infografikler',
  engineer: 'Kokpit arayüzü: tüm parametreler, telemetri ve kodlar',
};

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="group" aria-label="Anlatım düzeyi (hesap sonuçlarını değiştirmez)"
      className="inline-flex shrink-0 rounded-xl border border-line bg-[rgb(3_8_24/0.6)] p-1">
      {(['public', 'engineer'] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          title={MODE_HINT[m]}
          onClick={() => onChange(m)}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${
            mode === m ? 'bg-[linear-gradient(135deg,var(--color-nasa),var(--color-nasa-bright))] text-white shadow-glow' : 'text-ink hover:text-accent'
          }`}
        >
          <Icon name={m === 'public' ? 'rocket' : 'terminal'} className="h-4 w-4" />
          {m === 'public' ? 'Halk' : 'Mühendis'}
        </button>
      ))}
    </div>
  );
}
