import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './ui';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  hint?: string;
  icon?: IconName;
  badge?: ReactNode;
}

/** WAI-ARIA tabs: roving tabindex, Arrow/Home/End keys, manual activation on focus move. */
export function Tabs<K extends string>({ tabs, active, onChange, idPrefix = 'tab', ariaLabel }: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  idPrefix?: string;
  /** Accessible name of the tab list (in the interface language). */
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      const tab = tabs[next];
      if (tab) {
        onChange(tab.key);
        refs.current[next]?.focus();
      }
    }
  };
  return (
    <div role="tablist" aria-label={ariaLabel}
      className="glass flex gap-1 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:thin]">
      {tabs.map((tab, i) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idPrefix}-${tab.key}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`relative flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              selected
                ? 'bg-[rgb(31_98_224/0.28)] text-white shadow-[inset_0_0_0_1px_rgb(76_201_255/0.55),0_0_20px_-8px_var(--color-neon)]'
                : 'text-muted hover:bg-white/[0.05] hover:text-ink'
            }`}
          >
            {tab.icon && <Icon name={tab.icon} className={`h-4 w-4 ${selected ? 'text-neon' : ''}`} />}
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, idPrefix = 'tab', active, children }: { id: string; idPrefix?: string; active: boolean; children: ReactNode }) {
  return (
    <section
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-${id}`}
      hidden={!active}
      tabIndex={0}
      className="rounded-2xl focus-visible:outline-offset-4"
    >
      {active ? children : null}
    </section>
  );
}
