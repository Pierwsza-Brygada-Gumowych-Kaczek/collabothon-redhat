import { Component, computed, inject } from '@angular/core';
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
              <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Exchange rate per payment">
                @for (t of c.ticks; track t.v) {
                  <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
                  <text x="2" [attr.y]="t.y + 4" class="axis">{{ t.v.toFixed(3) }}</text>
                }
                <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="c.lockY" [attr.y2]="c.lockY" class="lock" />
                <text [attr.x]="W - 4" [attr.y]="c.lockY - 5" class="axis end">locked at first rate (forward)</text>
                <path [attr.d]="c.line" class="rate" />
                @for (p of c.points; track p.x) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" class="pt"><title>{{ p.label }}: {{ p.rate }}</title></circle>
                  <text [attr.x]="p.x" [attr.y]="H + 16" class="axis mid">{{ p.label }}</text>
                }
              </svg>
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
    .summary[data-risk='low'] { border-top-color: #3e8635; }
    .summary[data-risk='high'] { border-top-color: #c9190b; }
    .summary p { line-height: 1.55; margin: .5rem 0 0; }
    .risk-badge { font-size: .85rem; }
    .risk-badge b { text-transform: capitalize; }
    .facts, .hf { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; }
    .facts div, .hf div { background: #f7f7f7; border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .facts .bad { background: #faeae8; }
    .facts .bad strong { color: #c9190b; }
    .facts span, .hf span { font-size: .75rem; color: #6a6e73; }
    .facts strong, .hf strong { font-size: 1.2rem; }
    .hf strong.sm { font-size: .9rem; }
    .facts small { font-size: .72rem; color: #4f5255; }
    .sub { font-size: .95rem; margin: 1.1rem 0 .4rem; }
    .chart { width: 100%; height: auto; display: block; }
    .grid-line { stroke: #eee; }
    .axis { font-size: 11px; fill: #6a6e73; }
    .axis.mid { text-anchor: middle; }
    .axis.end { text-anchor: end; }
    .lock { stroke: #3e8635; stroke-dasharray: 5 4; }
    .rate { fill: none; stroke: #f0ab00; stroke-width: 2.2; }
    .pt { fill: #f0ab00; }
    .note { line-height: 1.5; }
    .open { background: #fdf7e7; border-radius: 8px; padding: .65rem .8rem; font-size: .9rem; line-height: 1.5; margin-top: .6rem; }
    .list-title { margin: .5rem 0 0; }
    .hedge { border-left: 5px solid #f0ab00; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6a6e73; }
    .hedge h3 { font-size: 1.15rem; margin: .35rem 0 .8rem; }
    .hedge p { line-height: 1.5; margin: .45rem 0; font-size: .92rem; }
    .hedge ol { margin: .3rem 0 0; padding-left: 1.3rem; line-height: 1.55; font-size: .92rem; }
    .warn { background: #fdf7e7; }
    .warn ul { margin: 0; padding-left: 1.2rem; line-height: 1.6; color: #6b3600; }
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
    }));
    return {
      points,
      line: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''),
      lockY: y(lock),
      ticks: [max, (max + min) / 2, min].map((v) => ({ v, y: y(v) })),
    };
  });
}
