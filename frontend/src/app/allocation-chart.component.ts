import { Component, computed, input, signal } from '@angular/core';
import { eurShort } from './format';

export type PotKind = 'goal' | 'expense' | 'free';

/** One slice of the chart: a goal, a spending category, or the free cash. */
export interface Pot {
  key: string;
  kind: PotKind;
  name: string;
  amount: number;
  color: string;
  /** Money about to be added to this pot (shown next to it in the legend). */
  plus?: number;
}

const R = 84;
const CIRC = 2 * Math.PI * R;

/** Donut chart + legend of how a total is divided into goals, spending categories and free cash. */
@Component({
  selector: 'app-allocation-chart',
  standalone: true,
  template: `
    <div class="alloc">
      <div class="donut-wrap">
        <svg viewBox="0 0 240 240" class="donut" role="img" [attr.aria-label]="'Allocation: ' + label()"
             (mouseleave)="hover.set(null)">
          <circle cx="120" cy="120" [attr.r]="R" class="ring" />
          @for (s of slices(); track s.key) {
            <circle cx="120" cy="120" [attr.r]="R" class="slice" [class.dim]="hover() !== null && hover() !== s.key"
                    [attr.stroke]="s.color" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset"
                    transform="rotate(-90 120 120)" (mouseenter)="hover.set(s.key)" />
          }
        </svg>
        <div class="center">
          @if (hovered(); as h) {
            <span class="c-label">{{ h.name }}</span>
            <strong>{{ eurShort(h.amount) }}</strong>
            <span class="c-sub">{{ pctOf(h.amount) }}% of the total</span>
          } @else {
            <span class="c-label">{{ label() }}</span>
            <strong>{{ eurShort(total()) }}</strong>
            <span class="c-sub">{{ pots().length - 1 }} goals and categories</span>
          }
        </div>
      </div>

      <div class="legend">
        @for (g of groups(); track g.title) {
          @if (g.items.length) {
            <div class="group">
              <h3>{{ g.title }} <span class="muted">{{ eurShort(g.total) }}</span></h3>
              @for (i of g.items; track i.key) {
                <div class="row" [class.on]="hover() === i.key" (mouseenter)="hover.set(i.key)" (mouseleave)="hover.set(null)">
                  <span class="dot" [style.background]="i.color"></span>
                  <span class="nm">{{ i.name }}</span>
                  @if (i.plus) {
                    <span class="plus">+{{ eurShort(i.plus) }}</span>
                  } @else {
                    <span></span>
                  }
                  <span class="amt">{{ eurShort(i.amount) }}</span>
                  <span class="pc">{{ pctOf(i.amount) }}%</span>
                </div>
              }
            </div>
          }
        }
        @if (over() > 0) {
          <p class="warn">Your goals add up to {{ eurShort(over()) }} more than the balance — you have set aside more than you hold.</p>
        }
      </div>
    </div>
  `,
  styles: `
    .alloc { display: grid; grid-template-columns: minmax(240px, 340px) 1fr; gap: 2rem; align-items: center; }
    .donut-wrap { position: relative; max-width: 340px; width: 100%; margin: 0 auto; }
    .donut { width: 100%; height: auto; display: block; }
    .ring { fill: none; stroke: var(--surface-3); stroke-width: 34; }
    .slice { fill: none; stroke-width: 34; cursor: pointer; transition: opacity .15s, stroke-width .15s; }
    .slice:hover { stroke-width: 40; }
    .slice.dim { opacity: .35; }
    .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; pointer-events: none; padding: 0 22%; }
    .c-label { font-size: .8rem; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .center strong { font-size: 1.6rem; line-height: 1.2; }
    .c-sub { font-size: .75rem; color: var(--muted); }
    .legend { display: flex; flex-direction: column; gap: 1rem; }
    .group h3 { margin: 0 0 .3rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; display: flex;
      justify-content: space-between; color: var(--text-2); }
    .row { display: grid; grid-template-columns: 14px 1fr auto auto 3.2rem; gap: .6rem; align-items: center; padding: .3rem .4rem;
      border-radius: 6px; font-size: .92rem; }
    .row.on { background: var(--surface-3); }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plus { color: var(--green); font-size: .8rem; font-weight: 600; }
    .amt { font-weight: 600; }
    .pc { text-align: right; color: var(--muted); font-size: .82rem; }
    .warn { margin: 0; color: var(--red); font-size: .88rem; }
    @media (max-width: 800px) { .alloc { grid-template-columns: 1fr; } }
  `,
})
export class AllocationChartComponent {
  /** All pots, goals first, free cash last. */
  readonly pots = input.required<Pot[]>();
  /** Name of the total shown in the middle. */
  readonly label = input('Total');
  readonly expenseTitle = input('Spending');
  /** The account balance; goals are set aside from it, which drives the over-allocation warning. */
  readonly balance = input.required<number>();

  readonly R = R;
  readonly eurShort = eurShort;
  readonly hover = signal<string | null>(null);

  private readonly sum = computed(() => this.pots().reduce((s, p) => s + p.amount, 0));
  readonly total = this.sum;
  readonly over = computed(() => {
    const goals = this.pots().filter((p) => p.kind === 'goal').reduce((s, p) => s + p.amount, 0);
    return Math.max(goals - Math.max(this.balance(), 0), 0);
  });

  readonly groups = computed(() => {
    const of = (k: PotKind) => this.pots().filter((p) => p.kind === k);
    const sum = (l: Pot[]) => l.reduce((s, p) => s + p.amount, 0);
    return [
      { title: 'Goals', items: of('goal'), total: sum(of('goal')) },
      { title: this.expenseTitle(), items: of('expense'), total: sum(of('expense')) },
      { title: 'Free cash', items: of('free'), total: sum(of('free')) },
    ];
  });

  readonly slices = computed(() => {
    const total = this.sum();
    if (total <= 0) return [];
    let acc = 0;
    return this.pots()
      .filter((p) => p.amount > 0)
      .map((p) => {
        const len = (p.amount / total) * CIRC;
        const draw = Math.max(len - 1.5, 0);
        const s = { key: p.key, color: p.color, dash: `${draw} ${CIRC - draw}`, offset: -acc };
        acc += len;
        return s;
      });
  });

  readonly hovered = computed(() => this.pots().find((p) => p.key === this.hover()) ?? null);

  pctOf(amount: number): string {
    const t = this.sum();
    return t > 0 ? ((amount / t) * 100).toFixed(amount / t < 0.1 ? 1 : 0) : '0';
  }
}
