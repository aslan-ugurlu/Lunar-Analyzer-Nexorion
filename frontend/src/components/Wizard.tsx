import { Icon, type IconName } from './ui';

export interface WizardStepDef<K extends string> {
  key: K;
  title: string;
  icon: IconName;
}

export type StepState = 'current' | 'done' | 'error' | 'todo';

/**
 * Wizard progress bar. Each step is a real button (free navigation: the defaults are valid, so a
 * user may jump anywhere); the current step carries aria-current="step" and every state is also
 * spelled out for screen readers (never colour alone).
 */
export function Stepper<K extends string>({ steps, active, states, onSelect }: {
  steps: WizardStepDef<K>[];
  active: K;
  states: Record<K, StepState>;
  onSelect: (key: K) => void;
}) {
  const activeIndex = steps.findIndex((s) => s.key === active);
  const progress = steps.length > 1 ? (activeIndex / (steps.length - 1)) * 100 : 100;
  return (
    <nav aria-label="Görev sihirbazı adımları">
      <div className="relative">
        <div className="absolute top-5 right-6 left-6 h-px bg-line" aria-hidden />
        <div className="absolute top-5 left-6 h-px bg-gradient-to-r from-nasa-bright to-neon transition-[width] duration-500"
          style={{ width: `calc((100% - 3rem) * ${progress / 100})` }} aria-hidden />
        <ol className="relative grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((step, i) => {
            const state = states[step.key];
            const current = step.key === active;
            const ring = current
              ? 'border-neon bg-[rgb(31_98_224/0.45)] text-white shadow-glow'
              : state === 'error'
                ? 'border-stop/70 bg-stop/15 text-stop'
                : state === 'done'
                  ? 'border-go/60 bg-go/10 text-go'
                  : 'border-line-strong bg-[rgb(3_8_24/0.8)] text-muted';
            const srState = { current: 'şu anki adım', done: 'tamamlandı', error: 'düzeltilmesi gereken alan var', todo: 'henüz açılmadı' }[state];
            return (
              <li key={step.key} className="flex justify-center">
                <button
                  type="button"
                  onClick={() => onSelect(step.key)}
                  aria-current={current ? 'step' : undefined}
                  className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-0.5 text-center"
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-mono text-sm font-semibold transition ${ring}`} aria-hidden>
                    {state === 'done' && !current ? <Icon name="check" className="h-5 w-5" /> : state === 'error' && !current ? <Icon name="alert" className="h-4.5 w-4.5" /> : i + 1}
                  </span>
                  <span className={`text-xs font-medium leading-tight sm:text-sm ${current ? 'text-ink' : 'text-muted group-hover:text-ink'}`}>
                    <span className="sr-only">Adım {i + 1}:</span>{' '}
                    <span className={current ? '' : 'sr-only sm:not-sr-only'}>{step.title}</span>{' '}
                    <span className="sr-only">({srState})</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
