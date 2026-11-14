import type { ReactNode } from 'react';
import type { Decision } from '../api/types';
import type { Explained } from '../api/errors';
import { useApp } from '../state/AppState';

type IconName = 'check' | 'alert' | 'stop' | 'question' | 'info' | 'sun' | 'earth' | 'external' | 'spinner' | 'copy';

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
    default:
      return null;
  }
}

const DECISION_STYLE: Record<Decision, { cls: string; icon: IconName; word: string; publicWord: string }> = {
  GREEN: { cls: 'border-go/60 bg-go/15 text-go', icon: 'check', word: 'GREEN', publicWord: 'Uygun görünüyor' },
  YELLOW: { cls: 'border-caution/60 bg-caution/15 text-caution', icon: 'alert', word: 'YELLOW', publicWord: 'Dikkat: ihtiyatlı senaryoda sorun' },
  RED: { cls: 'border-stop/60 bg-stop/15 text-stop', icon: 'stop', word: 'RED', publicWord: 'Kısıtlar sağlanmıyor' },
  GRAY: { cls: 'border-unknown/60 bg-unknown/10 text-unknown', icon: 'question', word: 'GRAY', publicWord: 'Belirsiz / veri yetersiz' },
};

/** Decision is conveyed by icon + word + colour (never colour alone). */
export function DecisionBadge({ status, size = 'md' }: { status: Decision; size?: 'sm' | 'md' | 'lg' }) {
  const { mode } = useApp();
  const s = DECISION_STYLE[status] ?? DECISION_STYLE.GRAY;
  const sizing = size === 'lg' ? 'px-3 py-1.5 text-base' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border font-semibold ${s.cls} ${sizing}`} data-decision={status}>
      <Icon name={s.icon} className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
      <span>{s.word}</span>
      <span className="font-normal opacity-90">· {mode === 'public' ? s.publicWord : decisionShort(status)}</span>
    </span>
  );
}

function decisionShort(status: Decision): string {
  return {
    GREEN: 'nominal + ihtiyatlı geçti',
    YELLOW: 'nominal geçti, ihtiyatlı ihlal',
    RED: 'nominal ihlal',
    GRAY: 'veri/doğrulama yetersiz',
  }[status];
}

export function Notice({ explained, children, compact = false }: { explained: Explained; children?: ReactNode; compact?: boolean }) {
  const { mode } = useApp();
  const tone = {
    error: 'border-stop/60 bg-stop/10',
    warning: 'border-caution/60 bg-caution/10',
    info: 'border-accent/50 bg-accent/10',
  }[explained.tone];
  const icon: IconName = explained.tone === 'error' ? 'stop' : explained.tone === 'warning' ? 'alert' : 'info';
  return (
    <div role={explained.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon name={icon} className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">
            {explained.title} <span className="chip ml-1 border-line mono text-muted">{explained.code}</span>
          </p>
          {!compact && <p className="text-ink/90">{mode === 'public' ? explained.publicText : explained.engineerText}</p>}
          {!compact && explained.action && (
            <p className="text-muted">
              Yapılabilecek: <span className="mono break-all text-ink">{explained.action}</span>
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel/50 p-6 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-sm text-muted">{children}</div>}
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="mono break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="link inline-flex items-center gap-1" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" className="h-3.5 w-3.5" />
      <span className="sr-only">(yeni sekmede açılır)</span>
    </a>
  );
}
