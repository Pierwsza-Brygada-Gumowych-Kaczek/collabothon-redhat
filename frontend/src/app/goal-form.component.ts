import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { BankService, Goal, GoalPlan, GoalWay } from './bank.service';
import { duration, eurShort, pct, RISK_INFO } from './format';
import { GOAL_ICONS } from './goal-icons';
import { resizeImage } from './image-utils';

export const FREQUENCY_LABEL: Record<string, string> = {
  'one-off': 'once, now',
  weekly: 'every week',
  monthly: 'every month',
  quarterly: 'every quarter',
};

/** Form for adding or editing a goal; the AI proposes ways to reach it, shown as tiles to pick from. */
@Component({
  selector: 'app-goal-form',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <form class="card form" (ngSubmit)="save()">
      <div class="head">
        <h2>{{ editing() ? 'Edit goal' : 'New goal' }}</h2>
        <button type="button" class="x" (click)="cancel.emit()" aria-label="Close">×</button>
      </div>

      <div class="grid">
        <label class="field wide">
          <span>What are you saving for?</span>
          <input name="name" [(ngModel)]="name" required maxlength="60" placeholder="e.g. New pizza oven" autocomplete="off" />
        </label>
        <label class="field">
          <span>Target amount (€)</span>
          <input name="target" type="number" min="1" step="100" [(ngModel)]="target" required (ngModelChange)="stale.set(true)" />
        </label>
        <label class="field">
          <span>Already saved (€)</span>
          <input name="savedSoFar" type="number" min="0" step="50" [(ngModel)]="savedSoFar" (ngModelChange)="stale.set(true); shortfall.set(null)" />
        </label>
        <label class="field">
          <span>Reach it within (months, optional)</span>
          <input name="deadline" type="number" min="1" max="600" step="1" [(ngModel)]="deadline"
                 placeholder="No deadline" (ngModelChange)="stale.set(true)" />
        </label>
      </div>

      <div class="field">
        <span>Icon</span>
        <div class="icons" role="radiogroup" aria-label="Goal icon">
          @for (i of icons; track i.key) {
            <button type="button" class="ico" role="radio" [attr.aria-checked]="icon() === i.key" [class.on]="icon() === i.key"
                    [style.--c]="i.color" [title]="i.label" [attr.aria-label]="i.label" (click)="icon.set(icon() === i.key ? null : i.key)">
              <lucide-icon [img]="i.icon" [size]="22" [strokeWidth]="2"></lucide-icon>
              <small>{{ i.label }}</small>
            </button>
          }
        </div>
      </div>

      <div class="field">
        <span>Picture</span>
        <div class="photos">
          <button type="button" class="ph none" [class.on]="!photo()" (click)="photo.set(null)">None</button>
          @if (photo()) {
            <button type="button" class="ph on" [style.background-image]="'url(' + photo() + ')'" aria-label="Your picture"></button>
          }
          <label class="ph upload" title="Upload your own picture">
            + Upload
            <input type="file" accept="image/*" hidden (change)="onFile($event)" />
          </label>
        </div>
      </div>

      <div class="plan-bar">
        <button type="button" class="secondary" [disabled]="planning() || !canPlan()" (click)="showWays()">
          {{ planning() ? 'Asking the AI…' : plan() ? '↻ Refresh ways' : '✨ Show ways to reach this goal' }}
        </button>
        @if (stale() && plan()) {
          <small class="muted">You changed the numbers — refresh the ways to update them.</small>
        }
      </div>

      @if (plan(); as p) {
        @if (p.source === 'demo') {
          <p class="note demo">Demo suggestions — the AI model is not connected, these come from simple rules.</p>
        }
        @if (p.source === 'unavailable') {
          <p class="err">{{ p.error }}</p>
        }
        @if (p.summary) {
          <p class="summary">{{ p.summary }}</p>
        }
        @if (p.baseline) {
          <p class="compare-note">
            The first card is the <b>standard way</b>: just set the same amount aside every month, with no product and no
            interest. Each proposal below shows what it adds on top of that.
          </p>
        }
        <div class="ways" role="radiogroup" aria-label="Ways to reach the goal">
          @for (w of tiles(); track w.id) {
            <button type="button" class="way" role="radio" [attr.aria-checked]="chosen()?.id === w.id"
                    [class.on]="chosen()?.id === w.id" [class.base]="w.id === 'baseline'" (click)="choose(w)">
              <span class="cat">{{ w.id === 'baseline' ? 'Standard way' : w.category }}</span>
              <strong>{{ w.title }}</strong>
              <span class="stats">
                <span class="stat">
                  <small>You pay</small>
                  <b class="big">{{ eurShort(w.amount_eur) }}</b>
                  <small>{{ freq[w.frequency] }}</small>
                </span>
                <span class="stat">
                  <small>Time to goal</small>
                  @if (w.months === null) {
                    <b class="big bad">Never</b>
                    <small>does not reach it</small>
                  } @else if (w.months === 0) {
                    <b class="big">Now</b>
                    <small>already covered</small>
                  } @else {
                    <b class="big">{{ duration(w.months) }}</b>
                    <small>to collect {{ eurShort(target || 0) }}</small>
                  }
                </span>
              </span>
              @if (w.months) {
                <span class="facts">
                  <span>In total you pay in <b>{{ eurShort(w.total_paid) }}</b>
                    @if (w.payments > 1) { <small>({{ w.payments }} payments)</small> }
                  </span>
                  @if (w.expected_interest > 0) {
                    <span>Interest ≈ <b>{{ eurShort(w.expected_interest) }}</b>
                      <small>({{ pct(w.return_min_pct) }}–{{ pct(w.return_max_pct) }}% a year)</small></span>
                  }
                </span>
              }
              @if (w.id !== 'baseline' && w.months && ((w.months_faster ?? 0) !== 0 || w.expected_interest > 0)) {
                <span class="cmp">
                  <small>Better than plain saving?</small>
                  @if ((w.months_faster ?? 0) !== 0) {
                    <span [class]="'delta ' + tone(w.months_faster ?? 0)">⏱ {{ faster(w.months_faster ?? 0) }}</span>
                  }
                  @if (w.expected_interest > 0) {
                    <span class="delta good">€ Earns {{ eurShort(w.expected_interest) }} that plain saving would not</span>
                  }
                </span>
              }
              <span class="risk" [attr.data-risk]="w.risk">Risk: {{ risk[w.risk].label }}</span>
              <span class="expl">{{ w.plain_explanation }}</span>
              @if (w.rationale) {
                <small class="why">{{ w.rationale }}</small>
              }
            </button>
          }
        </div>
        @for (warn of p.warnings; track warn) {
          <p class="note">{{ warn }}</p>
        }
      }

      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      @if (shortfall(); as s) {
        <div class="shortfall" role="alert">
          <strong>You don't have that money</strong>
          <p>
            You entered <b>{{ eurShort(s.entered) }}</b> as already saved, but only <b>{{ eurShort(s.available) }}</b>
            of your balance is free (not set aside for other goals) — {{ eurShort(s.entered - s.available) }} short.
          </p>
          <div class="sf-actions">
            <button type="button" class="secondary" (click)="shortfall.set(null)">← Back to the goal</button>
            <button type="button" (click)="save(true)">Add anyway</button>
          </div>
        </div>
      } @else {
        <div class="actions">
          <button type="button" class="secondary" (click)="cancel.emit()">Cancel</button>
          <button type="submit" [disabled]="saving() || !name.trim() || !(target && target > 0)">
            {{ saving() ? 'Saving…' : editing() ? 'Save changes' : 'Add goal' }}
          </button>
        </div>
        @if (!chosen()) {
          <small class="muted right">You can save without a way and pick one later by editing the goal.</small>
        }
      }
    </form>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: .9rem; border: 2px solid var(--blue); }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .head h2 { margin: 0; }
    .x { background: none; color: var(--muted); font-size: 1.4rem; padding: 0 .3rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .8rem; }
    .field { display: flex; flex-direction: column; gap: .35rem; }
    .field.wide { grid-column: 1 / -1; }
    .field > span { font-size: .85rem; font-weight: 600; }
    input { padding: .5rem .6rem; border: 1px solid var(--border-2); border-radius: 6px; font: inherit; }
    .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: .5rem; }
    .ico { display: flex; flex-direction: column; align-items: center; gap: .3rem; padding: .6rem .3rem; border-radius: 12px;
      background: var(--surface); color: var(--c); border: 2px solid var(--border-2); cursor: pointer; font: inherit;
      transition: background-color .15s, color .15s, border-color .15s, transform .1s; }
    .ico small { color: var(--text-2); font-size: .72rem; text-align: center; line-height: 1.2; }
    .ico:hover { border-color: var(--c); transform: translateY(-1px); }
    .ico.on { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 3px 10px color-mix(in srgb, var(--c) 45%, transparent); }
    .ico.on small { color: #fff; }
    .ico:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .photos { display: flex; gap: .5rem; flex-wrap: wrap; }
    .ph { width: 64px; height: 44px; padding: 0; border-radius: 8px; background-size: cover; background-position: center;
      border: 2px solid transparent; }
    .ph.none, .ph.upload { background: var(--surface-3); color: var(--muted); font-size: .8rem; display: grid;
      place-items: center; cursor: pointer; }
    .ph.on { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); }
    .plan-bar { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
    .summary { margin: 0; color: var(--text-2); }
    .ways { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: .8rem; }
    .way { text-align: left; display: flex; flex-direction: column; gap: .4rem; padding: .9rem; border-radius: 12px;
      background: var(--surface); color: var(--text); border: 2px solid var(--border-2); font: inherit; cursor: pointer; }
    .way:hover { border-color: var(--blue); }
    .way.base { border-style: dashed; background: var(--surface-2); }
    .way.base.on { border-style: solid; background: var(--blue-bg); }
    .compare-note { margin: 0; font-size: .85rem; color: var(--text-2); line-height: 1.5; }
    .cmp { display: flex; flex-direction: column; gap: .15rem; font-size: .84rem; background: var(--surface-3);
      border-radius: 8px; padding: .4rem .6rem; }
    .cmp small { color: var(--muted); font-size: .7rem; }
    .delta { font-weight: 600; }
    .delta.good { color: var(--green); }
    .delta.bad { color: var(--red); }
    .delta.same { color: var(--text-2); font-weight: 500; }
    .way.on { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-bg); background: var(--blue-bg); }
    .cat { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
    .way strong { font-size: 1rem; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .stat { display: flex; flex-direction: column; background: var(--surface-3); border-radius: 10px; padding: .5rem .6rem; }
    .stat small { font-size: .72rem; color: var(--muted); }
    .big { font-size: 1.35rem; line-height: 1.2; color: var(--blue); }
    .big.bad { color: var(--red); }
    .facts { display: flex; flex-direction: column; gap: .15rem; font-size: .86rem; }
    .facts small, .why { color: var(--muted); }
    .bad { color: var(--red); font-weight: 600; }
    .risk { align-self: flex-start; font-size: .75rem; font-weight: 600; padding: .1rem .5rem; border-radius: 999px;
      background: var(--surface-3); }
    .risk[data-risk='medium'] { background: #fdf3d6; color: #795600; }
    .risk[data-risk='high'] { background: #fce3e0; color: #a30000; }
    .expl { font-size: .84rem; color: var(--text-2); }
    .why { font-size: .78rem; }
    .note { margin: 0; font-size: .85rem; color: var(--text-2); }
    .note.demo { color: #795600; }
    .err { color: var(--red); margin: 0; font-size: .9rem; }
    .actions { display: flex; justify-content: flex-end; gap: .6rem; }
    .right { text-align: right; }
    .shortfall { background: var(--amber-bg); border: 1px solid var(--amber-border); color: var(--amber-text);
      border-radius: 10px; padding: .85rem 1rem; display: flex; flex-direction: column; gap: .4rem; }
    .shortfall p { margin: 0; line-height: 1.5; font-size: .92rem; }
    .sf-actions { display: flex; justify-content: flex-end; gap: .6rem; flex-wrap: wrap; margin-top: .3rem; }
  `,
})
export class GoalFormComponent {
  private readonly bank = inject(BankService);
  /** When set, the form edits this goal instead of creating a new one. */
  readonly goal = input<Goal | null>(null);
  readonly saved = output<Goal>();
  readonly cancel = output<void>();

  readonly eurShort = eurShort;
  readonly pct = pct;
  readonly duration = duration;
  readonly freq = FREQUENCY_LABEL;
  readonly risk = RISK_INFO;

  /** The standard way first, then the proposals. */
  readonly tiles = computed<GoalWay[]>(() => {
    const p = this.plan();
    return p ? [...(p.baseline ? [p.baseline] : []), ...p.ways] : [];
  });

  tone(v: number): 'good' | 'bad' | 'same' {
    return v > 0.5 ? 'good' : v < -0.5 ? 'bad' : 'same';
  }

  faster(months: number): string {
    return months > 0 ? `${duration(months)} sooner` : months < 0 ? `${duration(-months)} later` : 'same time';
  }

  readonly editing = computed(() => this.goal() !== null);
  readonly photo = signal<string | null>(null);
  readonly icon = signal<string | null>(null);
  readonly icons = GOAL_ICONS;
  readonly plan = signal<GoalPlan | null>(null);
  readonly chosen = signal<GoalWay | null>(null);
  readonly planning = signal(false);
  readonly saving = signal(false);
  readonly stale = signal(false);
  /** Set when the amount entered as already saved is more than the free balance. */
  readonly shortfall = signal<{ entered: number; available: number } | null>(null);
  readonly error = signal<string | null>(null);
  name = '';
  target: number | null = null;
  savedSoFar: number | null = 0;
  deadline: number | null = null;

  ngOnInit(): void {
    const g = this.goal();
    if (!g) return;
    this.name = g.name;
    this.target = g.target;
    this.savedSoFar = g.saved;
    this.deadline = g.deadline_months ?? null;
    this.photo.set(g.photo ?? null);
    this.icon.set(g.icon ?? null);
    this.chosen.set(g.way ?? null);
  }

  canPlan(): boolean {
    return !!this.name.trim() && !!this.target && this.target > 0;
  }

  showWays(): void {
    if (!this.canPlan()) return;
    this.planning.set(true);
    this.error.set(null);
    this.bank
      .planGoal({
        name: this.name.trim(),
        target: this.target!,
        saved: this.savedSoFar ?? 0,
        deadline_months: this.deadline && this.deadline > 0 ? this.deadline : null,
      })
      .subscribe({
        next: (p) => {
          this.planning.set(false);
          this.plan.set(p);
          this.chosen.set(null);
          this.stale.set(false);
        },
        error: (e) => {
          this.planning.set(false);
          this.error.set(e?.error?.detail?.toString?.() ?? 'Could not get ways to reach this goal.');
        },
      });
  }

  choose(w: GoalWay): void {
    this.chosen.set(this.chosen()?.id === w.id ? null : w);
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    resizeImage(file).then(
      (url) => {
        this.error.set(null);
        this.photo.set(url);
      },
      (e: Error) => this.error.set(e.message),
    );
  }

  /** Balance not yet set aside for other goals. */
  private freeBalance(): number {
    const own = this.goal()?.id;
    const others = this.bank.goals().filter((g) => g.id !== own).reduce((s, g) => s + g.saved, 0);
    return Math.max((this.bank.overview()?.balance ?? 0) - others, 0);
  }

  save(force = false): void {
    if (!this.name.trim() || !this.target || this.target <= 0) return;
    const entered = this.savedSoFar ?? 0;
    const available = this.freeBalance();
    if (!force && entered > available + 0.005) {
      this.shortfall.set({ entered, available });
      return;
    }
    this.shortfall.set(null);
    this.saving.set(true);
    this.error.set(null);
    const body = {
      name: this.name.trim(),
      target: this.target,
      saved: this.savedSoFar ?? 0,
      deadline_months: this.deadline && this.deadline > 0 ? this.deadline : null,
      photo: this.photo(),
      icon: this.icon(),
      way: this.chosen(),
    };
    const g = this.goal();
    (g ? this.bank.updateGoal(g.id, body) : this.bank.addGoal(body)).subscribe({
      next: (goal) => {
        this.saving.set(false);
        this.saved.emit(goal);
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.detail?.toString?.() ?? 'Could not save the goal.');
      },
    });
  }
}
