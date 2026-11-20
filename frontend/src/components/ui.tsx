import { useEffect, useRef, type ReactNode } from 'react';
import type { Decision } from '../api/types';
import { headingFor, type Explained } from '../api/errors';
import { defineStrings, pick, useStrings } from '../i18n';
import { useApp } from '../state/AppState';

export type IconName =
  | 'check' | 'alert' | 'stop' | 'question' | 'info' | 'sun' | 'earth' | 'external' | 'spinner' | 'copy'
  | 'pin' | 'clock' | 'target' | 'shield' | 'sliders' | 'terminal' | 'layers' | 'rocket' | 'chevron-left'
  | 'chevron-right' | 'moon' | 'radar' | 'chart' | 'database' | 'compare' | 'satellite';

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'check':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
    case 'alert':
      return <svg {...common}><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5M12 18h.01" /></svg>;
    case 'stop':
      return <svg {...common}><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
    case 'question':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg>;
    case 'info':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
    case 'sun':
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case 'earth':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    case 'external':
      return <svg {...common}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
    case 'copy':
      return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>;
    case 'spinner':
      return <svg {...common} className={`${className} animate-spin`}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
    case 'pin':
      return <svg {...common}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'target':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'sliders':
      return <svg {...common}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
    case 'terminal':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
    case 'rocket':
      return <svg {...common}><path d="M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2" /><path d="M9 15 6 12c1-4 4.5-8.5 12-9-.5 7.5-5 11-9 12z" /><circle cx="14.5" cy="9.5" r="1.5" /></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 6-6 6 6 6" /></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'moon':
      return <svg {...common}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" /></svg>;
    case 'radar':
      return <svg {...common}><path d="M3 18h18" /><path d="M5 18a7 7 0 0 1 14 0" /><path d="M8.5 18a3.5 3.5 0 0 1 7 0" /><path d="m12 18 5-7" /></svg>;
    case 'chart':
      return <svg {...common}><path d="M3 3v18h18" /><path d="m7 15 4-5 3 3 5-7" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" /><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></svg>;
    case 'compare':
      return <svg {...common}><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="8" width="7" height="12" rx="1.5" /></svg>;
    case 'satellite':
      return <svg {...common}><path d="m13 7 4 4-6 6-4-4z" /><path d="m15 5 2-2 4 4-2 2M7 13l-2 2 4 4 2-2" /><path d="M16 16a3 3 0 0 0 3 3M16 19.5a6 6 0 0 0 3.5-3.5" /></svg>;
    default:
      return null;
  }
}

/** Visual style per decision. `word` is the verbatim decision code and is never translated. */
export const DECISION_STYLE: Record<Decision, { cls: string; glow: string; icon: IconName; word: string }> = {
  GREEN: { cls: 'border-go/60 bg-go/15 text-go', glow: 'shadow-[0_0_18px_-6px_var(--color-go)]', icon: 'check', word: 'GREEN' },
  YELLOW: { cls: 'border-caution/60 bg-caution/15 text-caution', glow: 'shadow-[0_0_18px_-6px_var(--color-caution)]', icon: 'alert', word: 'YELLOW' },
  RED: { cls: 'border-stop/60 bg-stop/15 text-stop', glow: 'shadow-[0_0_18px_-6px_var(--color-stop)]', icon: 'stop', word: 'RED' },
  GRAY: { cls: 'border-unknown/60 bg-unknown/10 text-unknown', glow: '', icon: 'question', word: 'GRAY' },
};

const DECISION_WORDS = defineStrings<{ public: Record<Decision, string>; short: Record<Decision, string> }>({
  en: {
    public: { GREEN: 'Looks suitable', YELLOW: 'Caution: extra checks needed', RED: 'Constraints not met', GRAY: 'Uncertain / not enough data' },
    short: {
      GREEN: 'nominal + conservative passed',
      YELLOW: 'nominal passed; conservative violation or < 200 km scan',
      RED: 'nominal violation',
      GRAY: 'insufficient data/validation',
    },
  },
  tr: {
    public: { GREEN: 'Uygun görünüyor', YELLOW: 'Dikkat: ek kontrol gerekiyor', RED: 'Kısıtlar sağlanmıyor', GRAY: 'Belirsiz / veri yetersiz' },
    short: {
      GREEN: 'nominal + ihtiyatlı geçti',
      YELLOW: 'nominal geçti; ihtiyatlı ihlal veya < 200 km tarama',
      RED: 'nominal ihlal',
      GRAY: 'veri/doğrulama yetersiz',
    },
  },
});

/** Plain-language decision wording (Public mode) in the current language. */
export function decisionPublicWord(status: Decision): string {
  return pick(DECISION_WORDS).public[status] ?? pick(DECISION_WORDS).public.GRAY;
}

/** Short technical decision wording (Engineer mode) in the current language. */
export function decisionShort(status: Decision): string {
  return pick(DECISION_WORDS).short[status] ?? pick(DECISION_WORDS).short.GRAY;
}

/** Decision is conveyed by icon + word + colour (never colour alone). */
export function DecisionBadge({ status, size = 'md' }: { status: Decision; size?: 'sm' | 'md' | 'lg' }) {
  const { mode } = useApp();
  const s = DECISION_STYLE[status] ?? DECISION_STYLE.GRAY;
  const sizing = size === 'lg' ? 'px-3 py-1.5 text-base' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${s.cls} ${size === 'lg' ? s.glow : ''} ${sizing}`} data-decision={status}>
      <Icon name={s.icon} className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
      <span className="font-mono tracking-wide">{s.word}</span>
      <span className="font-normal opacity-90">· {mode === 'public' ? decisionPublicWord(status) : decisionShort(status)}</span>
    </span>
  );
}

const UI_STR = defineStrings({
  en: {
    action: 'What to do:',
    publicAction: 'What you can do:',
    technicalDetails: 'Technical details',
    code: 'Code:',
    technicalAction: 'Technical step:',
    newTab: '(opens in a new tab)',
  },
  tr: {
    action: 'Yapılabilecek:',
    publicAction: 'Ne yapabilirsiniz:',
    technicalDetails: 'Teknik detaylar',
    code: 'Kod:',
    technicalAction: 'Teknik işlem:',
    newTab: '(yeni sekmede açılır)',
  },
});

/**
 * Error / missing-data notice.
 * Engineer: technical title + verbatim code chip + engineer text + command action.
 * Public: plain-language heading and text; the verbatim code, engineer text and command action are
 * kept (never removed) inside a keyboard-accessible “Technical details” disclosure.
 * `focusOnMount` moves focus to the notice (e.g. after a failed submit) for keyboard/screen-reader users.
 */
export function Notice({ explained, children, compact = false, focusOnMount = false }: {
  explained: Explained; children?: ReactNode; compact?: boolean; focusOnMount?: boolean;
}) {
  const { mode } = useApp();
  const s = useStrings(UI_STR);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount, explained.code]);
  const tone = {
    error: 'border-stop/55 bg-[rgb(70_16_28/0.55)] [--notice:var(--color-stop)]',
    warning: 'border-caution/55 bg-[rgb(64_48_8/0.5)] [--notice:var(--color-caution)]',
    info: 'border-accent/45 bg-[rgb(8_40_70/0.55)] [--notice:var(--color-accent)]',
  }[explained.tone];
  const icon: IconName = explained.tone === 'error' ? 'stop' : explained.tone === 'warning' ? 'alert' : 'info';
  const engineer = mode === 'engineer';
  return (
    <div ref={ref} tabIndex={focusOnMount ? -1 : undefined} role={explained.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-3 text-sm backdrop-blur-sm ${tone}`} data-code={explained.code}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[var(--notice)]"><Icon name={icon} className="h-5 w-5" /></span>
        <div className="min-w-0 space-y-1">
          {engineer ? (
            <p className="font-semibold">
              {explained.title} <span className="chip ml-1 border-line mono text-muted">{explained.code}</span>
            </p>
          ) : (
            <p className="font-semibold">{headingFor(explained, 'public')}</p>
          )}
          {!compact && <p className="text-ink/90">{engineer ? explained.engineerText : explained.publicText}</p>}
          {engineer && !compact && explained.action && (
            <p className="text-muted">
              {s.action} <span className="mono break-all text-ink">{explained.action}</span>
            </p>
          )}
          {!engineer && !compact && explained.publicAction && (
            <p className="text-muted">{s.publicAction} <span className="text-ink">{explained.publicAction}</span></p>
          )}
          {children}
          {!engineer && (
            <details className="group text-xs text-muted">
              <summary className="cursor-pointer select-none rounded font-medium text-ink/80 hover:text-ink">{s.technicalDetails}</summary>
              <div className="mt-1 space-y-1 border-l-2 border-line pl-2">
                <p>{s.code} <span className="chip border-line mono text-ink">{explained.code}</span></p>
                {explained.title !== headingFor(explained, 'public') && <p>{explained.title}</p>}
                <p className="break-words">{explained.engineerText}</p>
                {explained.action && <p>{s.technicalAction} <span className="mono break-all text-ink">{explained.action}</span></p>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, icon = 'radar' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-[rgb(3_8_24/0.45)] p-6 text-center">
      <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 text-accent">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="font-display font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-sm text-muted">{children}</div>}
    </div>
  );
}

export function KeyValue({ items, dense = false }: { items: [string, ReactNode][]; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-1 sm:grid-cols-[max-content_minmax(0,1fr)] ${dense ? 'gap-x-3 gap-y-1 text-xs' : 'gap-x-4 gap-y-1.5 text-sm'}`}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={dense ? 'font-mono text-term/90' : 'text-muted'}>{k}</dt>
          <dd className="mono min-w-0 text-ink [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const s = useStrings(UI_STR);
  return (
    <a className="link inline-flex items-center gap-1" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" className="h-3.5 w-3.5" />
      <span className="sr-only">{s.newTab}</span>
    </a>
  );
}
