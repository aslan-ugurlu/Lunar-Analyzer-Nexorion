import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  hint?: string;
  badge?: ReactNode;
}

/** WAI-ARIA tabs: roving tabindex, Arrow/Home/End keys, manual activation on focus move. */
export function Tabs<K extends string>({ tabs, active, onChange, idPrefix = 'tab' }: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  idPrefix?: string;
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
    <div role="tablist" aria-label="Uygulama bölümleri" className="flex gap-1 overflow-x-auto border-b border-line">
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
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${
              selected ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
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
      className="focus-visible:outline-offset-4"
    >
      {active ? children : null}
    </section>
  );
}
