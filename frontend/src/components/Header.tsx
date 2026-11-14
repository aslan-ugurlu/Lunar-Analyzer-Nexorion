import type { Health } from '../api/types';
import type { ApiError } from '../api/client';
import { useApp, type Mode } from '../state/AppState';
import { Icon } from './ui';

type ChipState = 'ok' | 'missing' | 'unknown' | 'info';

function Chip({ label, value, state }: { label: string; value: string; state: ChipState }) {
  const cls = {
    ok: 'border-go/50 text-go',
    missing: 'border-stop/60 text-stop',
    unknown: 'border-line text-muted',
    info: 'border-caution/50 text-caution',
  }[state];
  const icon = state === 'ok' ? 'check' : state === 'missing' ? 'stop' : state === 'info' ? 'alert' : 'question';
  return (
    <li className={`chip bg-panel-2 ${cls}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span className="text-ink">{label}:</span>
      <span>{value}</span>
    </li>
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
    <header className="border-b border-line bg-space/80 backdrop-blur supports-[backdrop-filter]:bg-space/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-wide text-ink sm:text-xl">Lunar Mission Window Analyzer</h1>
          <p className="text-xs text-muted sm:text-sm">
            Ay güney kutbu · NASA LOLA + NAIF SPICE · Güneş görünürlüğü ve geometrik Dünya görüşü (DTE) ön eleme
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ul className="flex flex-wrap gap-1.5" aria-label="Hizmet ve veri durumu">
            <Chip label="Backend" value={online ? 'Online' : healthError ? 'Offline' : 'kontrol ediliyor'} state={online ? 'ok' : healthError ? 'missing' : 'unknown'} />
            <Chip label="SPICE" value={!health ? '—' : health.spice_files_present ? 'dosyalar var' : 'eksik'} state={!health ? 'unknown' : health.spice_files_present ? 'ok' : 'missing'} />
            <Chip label="LOLA DEM" value={!health ? '—' : lola?.dem ?? health.datasets.lola_240m ? `${lodText} m` : '240 m eksik'} state={!health ? 'unknown' : lola?.dem ?? health.datasets.lola_240m ? 'ok' : 'missing'} />
            <Chip label="ERR" value={!health ? '—' : anyErr ? 'var' : 'yok'} state={!health ? 'unknown' : anyErr ? 'ok' : 'info'} />
            <Chip label="Clone" value={!health ? '—' : health.clone_profiles === 'NOT_PRECOMPUTED' ? 'hazır değil' : (health.clone_profiles ?? 'bilinmiyor')} state={!health ? 'unknown' : 'info'} />
            <li className="chip border-accent/50 bg-panel-2 text-accent">
              <span aria-hidden>⏱</span> Tüm zamanlar UTC
            </li>
          </ul>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
      <p className="border-t border-line bg-caution/10 px-4 py-1.5 text-center text-xs text-caution">
        Ön eleme / karar destek aracıdır; iniş güvenliği, enerji üretimi ve RF bağlantısı garantisi değildir.
      </p>
    </header>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="group" aria-label="Anlatım düzeyi (hesap sonuçlarını değiştirmez)" className="inline-flex shrink-0 rounded-md border border-line bg-panel-2 p-0.5">
      {(['public', 'engineer'] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`min-h-9 rounded px-3 text-sm font-medium ${mode === m ? 'bg-accent text-accent-ink' : 'text-ink hover:text-accent'}`}
        >
          {m === 'public' ? 'Halk' : 'Mühendis'}
        </button>
      ))}
    </div>
  );
}
