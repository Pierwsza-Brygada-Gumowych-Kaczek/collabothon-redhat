import { Component, computed, inject, signal } from '@angular/core';
import { BankService } from '../bank.service';
import { AgentSourceComponent } from '../agent-source.component';
import { AgentErrorComponent } from '../agent-error.component';
import { DemoBannerComponent } from '../demo-banner.component';
import { eur, eurShort } from '../format';

const W = 800;
const H = 200;
const PAD = 16;
const LEFT = 50;

@Component({
  selector: 'app-fx-page',
  standalone: true,
  imports: [AgentSourceComponent, AgentErrorComponent, DemoBannerComponent],
  template: `
    <div class="head">
      <div>
        <h1 class="page-title">FX hedging agent</h1>
        <p class="page-lead">
          The agent finds payments in foreign currencies, measures how much exchange-rate moves cost you,
          and structures hedges with Commerzbank FX products so future costs are predictable.
        </p>
      </div>
      <button class="secondary" (click)="bank.loadFx(true)" [disabled]="bank.fxLoading()">
        {{ bank.fxLoading() ? 'Analysing…' : 'Run analysis again' }}
      </button>
    </div>

    @if (bank.fx(); as fx) {
      @if (fx.source === 'demo') { <app-demo-banner /> }
      <div class="stack">
        @if (fx.source === 'unavailable') {
          <app-agent-error agent="The FX hedging agent" [error]="fx.error ?? ''" [hasFacts]="true" [loading]="bank.fxLoading()" (retry)="bank.loadFx(true)" />
        } @else {
          <section class="card summary" [attr.data-risk]="fx.risk_level">
            <div class="risk-badge">Currency risk: <b>{{ fx.risk_level }}</b></div>
            <p>{{ fx.summary }}</p>
          </section>
        }

        @for (e of fx.exposures; track e.currency + e.counterparty) {
          <section class="card">
            <h2>{{ e.currency }} payments to {{ e.counterparty }}</h2>
            <div class="facts">
              <div><span>Paid in {{ e.currency }}</span><strong>{{ e.currency }} {{ e.total_foreign.toLocaleString('en-GB', { maximumFractionDigits: 0 }) }}</strong><small>{{ e.payments.length }} payments</small></div>
              <div><span>Cost in euros</span><strong>{{ eurShort(e.total_eur) }}</strong><small>average {{ e.rate_avg }} EUR/{{ e.currency }}</small></div>
              <div><span>Rate moved</span><strong>{{ e.rate_swing_pct }}%</strong><small>{{ e.rate_min }} – {{ e.rate_max }} EUR/{{ e.currency }}</small></div>
              <div class="bad"><span>Extra cost vs best rate</span><strong>{{ eurShort(e.extra_cost_vs_best_rate) }}</strong><small>paid because of rate moves</small></div>
            </div>

            @if (rateChart(); as c) {
              <h3 class="sub">Exchange rate on each payment date</h3>
              <div class="chart-wrap">
              <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Exchange rate per payment"
                   (mousemove)="onMove($event)" (mouseleave)="hover.set(null)">
                @for (t of c.ticks; track t.v) {
                  <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
                  <text x="2" [attr.y]="t.y + 4" class="axis">{{ t.v.toFixed(3) }}</text>
                }
                <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="c.lockY" [attr.y2]="c.lockY" class="lock" />
                <text [attr.x]="W - 4" [attr.y]="c.lockY - 5" class="axis end">locked at first rate (forward)</text>
                <path [attr.d]="c.line" class="rate" />
                @for (p of c.points; track p.x) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" class="pt" />
                  <text [attr.x]="p.x" [attr.y]="H + 16" class="axis mid">{{ p.label }}</text>
                }
                @if (hovered(); as h) {
                  <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="PAD" [attr.y2]="H - PAD" class="guide" />
                  <circle [attr.cx]="h.x" [attr.cy]="h.y" r="6" class="dot-active" />
                }
                <!-- invisible layer that catches the mouse over the whole plot -->
                <rect [attr.x]="LEFT" y="0" [attr.width]="W - LEFT" [attr.height]="H" class="catch" />
              </svg>
              @if (hovered(); as h) {
                <div class="ctip" [style.left.%]="(h.x / W) * 100" [style.top.%]="(h.y / (H + 22)) * 100" [class.flip]="h.x > W * 0.7">
                  <div class="t-period">{{ h.date }}</div>
                  <div class="t-row"><span>Rate (EUR per {{ e.currency }})</span><b>{{ h.rate }}</b></div>
                  <div class="t-row"><span>Payment</span><b>{{ h.amount.toLocaleString('en-GB') }} {{ e.currency }}</b></div>
                  <div class="t-row"><span>Cost in euros</span><b>{{ eurShort(h.amountEur) }}</b></div>
                  <div class="t-row"><span>Extra vs locked rate</span>
                    <b [class.neg]="h.extra > 0.5" [class.pos]="h.extra < -0.5">{{ h.extra > 0 ? '+' : '' }}{{ eurShort(h.extra) }}</b></div>
                </div>
              }
              </div>
              <p class="muted note">
                With an FX forward at the first payment's rate, all payments would have cost
                <b>{{ eurShort(e.cost_with_forward_at_first_rate) }}</b> instead of <b>{{ eurShort(e.total_eur) }}</b> —
                and you would have known the price in advance.
              </p>
            }

            <div class="open">
              <b>Still open:</b> {{ e.open_position_note }}
            </div>
          </section>
        }

        @if (fx.source !== 'unavailable') {
        <h2 class="list-title">Proposed hedges</h2>
        @for (h of fx.hedges; track $index) {
          <article class="card hedge">
            <span class="chip">{{ h.product }}</span>
            <h3>{{ h.title }}</h3>
            <div class="hf">
              <div><span>Amount</span><strong>{{ h.notional > 0 ? h.currency + ' ' + h.notional.toLocaleString('en-GB') : 'as needed' }}</strong></div>
              <div><span>Duration</span><strong class="sm">{{ h.tenor }}</strong></div>
              <div><span>Protects against</span><strong class="sm">{{ h.protects_against }}</strong></div>
              <div><span>Cost</span><strong class="sm">{{ h.cost }}</strong></div>
            </div>
            <p><b>What is it?</b> {{ h.plain_explanation }}</p>
            <p><b>Why for you?</b> {{ h.rationale }}</p>
            @if (h.steps.length) {
              <ol>
                @for (s of h.steps; track $index) {
                  <li>{{ s }}</li>
                }
              </ol>
            }
          </article>
        }

        @if (fx.warnings.length) {
          <section class="card warn">
            <h2>Watch out for</h2>
            <ul>
              @for (w of fx.warnings; track $index) {
                <li>{{ w }}</li>
              }
            </ul>
          </section>
        }
        }
        <app-agent-source [meta]="fx" disclaimer="Prototype — product terms and prices come from your Commerzbank adviser." />
      </div>
    } @else {
      <p class="muted">The FX agent is scanning your foreign-currency payments…</p>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    .head button { flex-shrink: 0; margin-top: .25rem; }
    .summary { border-top: 4px solid #f0ab00; }
    .summary[data-risk='low'] { border-top-color: var(--green); }
    .summary[data-risk='high'] { border-top-color: var(--red); }
    .summary p { line-height: 1.55; margin: .5rem 0 0; }
    .risk-badge { font-size: .85rem; }
    .risk-badge b { text-transform: capitalize; }
    .facts, .hf { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; }
    .facts div, .hf div { background: var(--surface-2); border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .facts .bad { background: var(--red-bg); }
    .facts .bad strong { color: var(--red); }
    .facts span, .hf span { font-size: .75rem; color: var(--muted); }
    .facts strong, .hf strong { font-size: 1.2rem; }
    .hf strong.sm { font-size: .9rem; }
    .facts small { font-size: .72rem; color: var(--text-2); }
    .sub { font-size: .95rem; margin: 1.1rem 0 .4rem; }
    .chart { width: 100%; height: auto; display: block; }
    .grid-line { stroke: var(--grid); }
    .axis { font-size: 11px; fill: var(--muted); }
    .axis.mid { text-anchor: middle; }
    .axis.end { text-anchor: end; }
    .lock { stroke: var(--green); stroke-dasharray: 5 4; }
    .rate { fill: none; stroke: #f0ab00; stroke-width: 2.2; }
    .pt { fill: #f0ab00; }
    .note { line-height: 1.5; }
    .open { background: var(--amber-bg); border-radius: 8px; padding: .65rem .8rem; font-size: .9rem; line-height: 1.5; margin-top: .6rem; }
    .list-title { margin: .5rem 0 0; }
    .hedge { border-left: 5px solid #f0ab00; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .hedge h3 { font-size: 1.15rem; margin: .35rem 0 .8rem; }
    .hedge p { line-height: 1.5; margin: .45rem 0; font-size: .92rem; }
    .hedge ol { margin: .3rem 0 0; padding-left: 1.3rem; line-height: 1.55; font-size: .92rem; }
    .warn { background: var(--amber-bg); }
    .warn ul { margin: 0; padding-left: 1.2rem; line-height: 1.6; color: var(--amber-text); }
    @media (max-width: 800px) {
      .head { flex-direction: column; }
      .facts, .hf { grid-template-columns: 1fr 1fr; }
    }
  `,
})
export class FxPage {
  readonly bank = inject(BankService);
  readonly eur = eur;
  readonly eurShort = eurShort;
  readonly W = W;
  readonly H = H;
  readonly LEFT = LEFT;
  readonly PAD = PAD;
  readonly hover = signal<number | null>(null);

  /** Map the mouse position to the nearest payment. */
  onMove(ev: MouseEvent): void {
    const c = this.rateChart();
    if (!c) return;
    const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < c.points.length; i++) {
      if (Math.abs(c.points[i].x - x) < Math.abs(c.points[best].x - x)) best = i;
    }
    this.hover.set(best);
  }

  readonly hovered = computed(() => {
    const i = this.hover();
    const c = this.rateChart();
    return i === null || !c ? null : (c.points[i] ?? null);
  });

  readonly rateChart = computed(() => {
    const e = this.bank.fx()?.exposures[0];
    if (!e || e.payments.length < 2) return null;
    const rates = e.payments.map((p) => p.rate);
    const lock = rates[0];
    const max = Math.max(...rates, lock) + 0.002;
    const min = Math.min(...rates, lock) - 0.002;
    const n = e.payments.length;
    const x = (i: number) => LEFT + 20 + (i / (n - 1)) * (W - LEFT - 40);
    const y = (v: number) => PAD + ((max - v) / (max - min)) * (H - 2 * PAD);
    const points = e.payments.map((p, i) => ({
      x: x(i),
      y: y(p.rate),
      rate: p.rate,
      label: new Date(p.date).toLocaleString('en-GB', { month: 'short' }),
      date: new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      amount: p.amount,
      amountEur: p.amount_eur,
      // What this payment cost beyond the rate of the first payment (the forward rate).
      extra: p.amount_eur - p.amount * lock,
    }));
    return {
      points,
      line: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''),
      lockY: y(lock),
      ticks: [max, (max + min) / 2, min].map((v) => ({ v, y: y(v) })),
    };
  });
}
