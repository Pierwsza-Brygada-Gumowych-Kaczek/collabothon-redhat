import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BankService } from '../bank.service';
import { AgentSourceComponent } from '../agent-source.component';
import { AgentErrorComponent } from '../agent-error.component';
import { DemoBannerComponent } from '../demo-banner.component';
import { eur, eurShort, pct } from '../format';

const W = 800;
const H = 240;
const PAD = 14;
const LEFT = 62;
const HISTORY_DAYS = 60;

@Component({
  selector: 'app-liquidity-page',
  standalone: true,
  imports: [DatePipe, AgentSourceComponent, AgentErrorComponent, DemoBannerComponent],
  template: `
    <div class="head">
      <div>
        <h1 class="page-title">Liquidity agent</h1>
        <p class="page-lead">
          The agent watches your account, forecasts the balance for the coming days and — if money
          could run short — proposes a credit facility before it happens.
        </p>
      </div>
      <button class="secondary" (click)="reload(true)" [disabled]="bank.liquidityLoading()">
        {{ bank.liquidityLoading() ? 'Forecasting…' : 'Run forecast again' }}
      </button>
    </div>

    <section class="card controls">
      <div class="seg" role="group" aria-label="Forecast horizon">
        <span class="muted">Forecast</span>
        @for (d of horizons; track d) {
          <button [class.on]="days() === d" (click)="setDays(d)">{{ d }} days</button>
        }
      </div>
      <label class="toggle">
        <input type="checkbox" [checked]="includeTax()" (change)="toggleTax()" />
        Include expected tax changes (back-payment and higher prepayments)
      </label>
    </section>

    @if (bank.liquidity(); as l) {
      @if (l.source === 'demo') { <app-demo-banner /> }
      <div class="stack">
        <section class="kpis">
          <div class="card kpi"><span>Balance today</span><strong>{{ eurShort(l.opening_balance) }}</strong><small>{{ l.as_of | date: 'd MMM yyyy' }}</small></div>
          <div class="card kpi"><span>Lowest point</span><strong [class.neg]="l.min_balance < 0">{{ eurShort(l.min_balance) }}</strong><small>{{ l.min_balance_date | date: 'd MMM yyyy' }}</small></div>
          <div class="card kpi"><span>Days below zero</span><strong [class.neg]="l.days_below_zero > 0">{{ l.days_below_zero }}</strong><small>in the next {{ l.days }} days</small></div>
          <div class="card kpi"><span>Balance in {{ l.days }} days</span><strong>{{ eurShort(l.end_balance) }}</strong><small>expected</small></div>
        </section>

        <section class="card">
          <h2>Balance forecast</h2>
          @if (l.summary) {
            <p class="summary">{{ l.summary }}</p>
          }
          @if (chart(); as c) {
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Balance forecast">
              @for (t of c.ticks; track t.v) {
                <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
                <text x="2" [attr.y]="t.y + 4" class="axis">{{ eurShort(t.v) }}</text>
              }
              <path [attr.d]="c.band" class="band" />
              <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="c.zeroY" [attr.y2]="c.zeroY" class="zero" />
              <line [attr.x1]="c.todayX" [attr.x2]="c.todayX" [attr.y1]="PAD" [attr.y2]="H - PAD" class="today" />
              <text [attr.x]="c.todayX + 4" [attr.y]="PAD + 10" class="axis">today</text>
              <path [attr.d]="c.history" class="hist" />
              <path [attr.d]="c.line" class="fc" />
              <circle [attr.cx]="c.min.x" [attr.cy]="c.min.y" r="4.5" class="min-dot" />
              @for (m of c.months; track m.x) {
                <text [attr.x]="m.x" [attr.y]="H + 16" class="axis">{{ m.label }}</text>
              }
            </svg>
            <div class="legend">
              <span class="sw hist-sw"></span> actual
              <span class="sw fc-sw"></span> forecast
              <span class="sw band-sw"></span> likely range
            </div>
          }
        </section>

        <section>
          <h2>Proposed credit facilities</h2>
          @if (l.source === 'unavailable') {
            <app-agent-error agent="The liquidity agent" [error]="l.error ?? ''" [hasFacts]="true" [loading]="bank.liquidityLoading()" (retry)="reload(true)" />
          } @else if (l.facilities.length) {
            <div class="stack">
              @for (f of l.facilities; track $index) {
                <article class="card facility">
                  <span class="chip">{{ f.product }}</span>
                  <h3>{{ f.title }}</h3>
                  <div class="ff">
                    <div><span>Limit</span><strong>{{ eurShort(f.limit_eur) }}</strong></div>
                    <div><span>Term</span><strong class="sm">{{ f.term }}</strong></div>
                    <div><span>Interest (indicative)</span><strong>{{ pct(f.interest_min_pct) }}–{{ pct(f.interest_max_pct) }}%</strong><small>a year, only on what you use</small></div>
                    <div><span>Estimated cost</span><strong>≈ {{ eurShort(f.est_cost_eur) }}</strong><small>if used as forecast</small></div>
                  </div>
                  <p><b>What is it?</b> {{ f.plain_explanation }}</p>
                  <p><b>Why now?</b> {{ f.rationale }}</p>
                  @if (f.steps.length) {
                    <ol>
                      @for (s of f.steps; track $index) {
                        <li>{{ s }}</li>
                      }
                    </ol>
                  }
                </article>
              }
            </div>
          } @else {
            <p class="card ok">No financing needed for this period — your balance stays positive.</p>
          }
          <p class="muted cost-note">
            For comparison: last year's overdraft would have cost about <b>{{ eurShort(l.overdraft_cost_last_year) }}</b>
            in interest as an unarranged overdraft.
          </p>
        </section>

        <section class="card">
          <h2>Biggest scheduled payments</h2>
          <table class="tx">
            <tbody>
              @for (s of bigFlows(); track $index) {
                <tr>
                  <td class="date">{{ s.date | date: 'd MMM' }}</td>
                  <td class="cp">{{ s.label }}</td>
                  <td class="amt" [class.neg]="s.amount < 0" [class.pos]="s.amount > 0">{{ eur(s.amount) }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="muted method">
            How the forecast works: fixed payments (rent, salaries, taxes, utilities) repeat last year's dates;
            card revenue and supplier costs follow last year's average for the same month, including the June
            shutdown. The Zurich instalments have ended and are not included.
          </p>
        </section>

        @if (l.warnings.length) {
          <section class="card warn">
            <h2>Watch out for</h2>
            <ul>
              @for (w of l.warnings; track $index) {
                <li>{{ w }}</li>
              }
            </ul>
          </section>
        }
        <app-agent-source [meta]="l" disclaimer="Forecasts are estimates; rates are indicative, not offers." />
      </div>
    } @else {
      <p class="muted">The liquidity agent is forecasting your cash flow…</p>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    .head button { flex-shrink: 0; margin-top: .25rem; }
    .controls { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .seg { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
    .seg button { background: #fff; color: #151515; border: 1px solid #c7c7c7; padding: .4rem .75rem; }
    .seg button.on { background: #151515; color: #fff; border-color: #151515; }
    .toggle { font-size: .9rem; display: flex; gap: .45rem; align-items: center; cursor: pointer; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
    .kpi { display: flex; flex-direction: column; gap: .2rem; }
    .kpi span { font-size: .8rem; color: #6a6e73; }
    .kpi strong { font-size: 1.4rem; }
    .kpi small { font-size: .75rem; color: #6a6e73; }
    .summary { line-height: 1.5; margin-top: 0; }
    .chart { width: 100%; height: auto; display: block; }
    .grid-line { stroke: #eee; }
    .zero { stroke: #8a8d90; stroke-dasharray: 4 4; }
    .today { stroke: #151515; stroke-dasharray: 2 3; }
    .axis { font-size: 11px; fill: #6a6e73; }
    .band { fill: rgba(0, 102, 204, .12); }
    .hist { fill: none; stroke: #6a6e73; stroke-width: 2; }
    .fc { fill: none; stroke: #0066cc; stroke-width: 2.2; }
    .min-dot { fill: #c9190b; }
    .legend { font-size: .82rem; color: #6a6e73; display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
    .sw { width: 14px; height: 4px; display: inline-block; border-radius: 2px; margin-left: .6rem; }
    .hist-sw { background: #6a6e73; }
    .fc-sw { background: #0066cc; }
    .band-sw { background: rgba(0, 102, 204, .25); height: 10px; }
    .facility { border-left: 5px solid #0066cc; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6a6e73; }
    .facility h3 { font-size: 1.15rem; margin: .35rem 0 .8rem; }
    .ff { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin-bottom: .5rem; }
    .ff div { background: #eef5fc; border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .ff span { font-size: .75rem; color: #6a6e73; }
    .ff strong { font-size: 1.2rem; }
    .ff strong.sm { font-size: .95rem; }
    .ff small { font-size: .72rem; color: #4f5255; }
    .facility p { line-height: 1.5; margin: .45rem 0; font-size: .92rem; }
    .facility ol { margin: .3rem 0 0; padding-left: 1.3rem; line-height: 1.55; font-size: .92rem; }
    .ok { background: #f3faf2; }
    .cost-note { margin: .6rem 0 0; }
    .method { line-height: 1.5; margin-bottom: 0; }
    .warn { background: #fdf7e7; }
    .warn ul { margin: 0; padding-left: 1.2rem; line-height: 1.6; color: #6b3600; }
    @media (max-width: 800px) {
      .head { flex-direction: column; }
      .kpis, .ff { grid-template-columns: 1fr 1fr; }
    }
  `,
})
export class LiquidityPage {
  readonly bank = inject(BankService);
  readonly eur = eur;
  readonly eurShort = eurShort;
  readonly pct = pct;
  readonly W = W;
  readonly H = H;
  readonly PAD = PAD;
  readonly LEFT = LEFT;
  readonly horizons = [30, 90, 180, 365];

  readonly days = signal(this.bank.liquidity()?.days ?? 90);
  readonly includeTax = signal(false);

  setDays(d: number): void {
    this.days.set(d);
    this.reload(false);
  }

  toggleTax(): void {
    this.includeTax.update((v) => !v);
    this.reload(false);
  }

  reload(refresh: boolean): void {
    this.bank.loadLiquidity(this.days(), this.includeTax(), refresh);
  }

  readonly bigFlows = computed(() =>
    [...(this.bank.liquidity()?.scheduled ?? [])].sort((a, b) => a.amount - b.amount).slice(0, 10)
      .sort((a, b) => a.date.localeCompare(b.date)),
  );

  readonly chart = computed(() => {
    const l = this.bank.liquidity();
    const o = this.bank.overview();
    if (!l || !o) return null;
    const hist = o.daily_balance.slice(-HISTORY_DAYS);
    const fc = l.forecast;
    const values = [...hist.map((p) => p.balance), ...fc.flatMap((p) => [p.low, p.high]), 0];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const t0 = Date.parse(hist[0].date);
    const tSpan = Date.parse(fc[fc.length - 1].date) - t0 || 1;
    const x = (d: string) => LEFT + ((Date.parse(d) - t0) / tSpan) * (W - PAD - LEFT);
    const y = (v: number) => PAD + ((max - v) / span) * (H - 2 * PAD);
    const path = (pts: { date: string; v: number }[]) =>
      pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join('');

    const today = hist[hist.length - 1];
    const line = path([{ date: today.date, v: today.balance }, ...fc.map((p) => ({ date: p.date, v: p.balance }))]);
    const upper = fc.map((p) => `L${x(p.date).toFixed(1)},${y(p.high).toFixed(1)}`).join('');
    const lower = [...fc].reverse().map((p) => `L${x(p.date).toFixed(1)},${y(p.low).toFixed(1)}`).join('');
    const band = `M${x(today.date).toFixed(1)},${y(today.balance).toFixed(1)}${upper}${lower}Z`;

    const months: { label: string; x: number }[] = [];
    const seen = new Set<string>();
    for (const p of [...hist, ...fc]) {
      const key = p.date.slice(0, 7);
      if (!seen.has(key) && p.date.endsWith('-01')) {
        seen.add(key);
        months.push({ label: new Date(p.date).toLocaleString('en-GB', { month: 'short' }), x: x(p.date) });
      }
    }
    const step = Math.ceil(months.length / 12);
    const low = fc.reduce((a, b) => (b.balance < a.balance ? b : a));
    return {
      history: path(hist.map((p) => ({ date: p.date, v: p.balance }))),
      line,
      band,
      zeroY: y(0),
      todayX: x(today.date),
      months: months.filter((_, i) => i % step === 0),
      ticks: [max, max / 2, 0, min / 2, min].filter((v, i, a) => a.indexOf(v) === i && Math.abs(v) > 1 || v === 0)
        .map((v) => ({ v, y: y(v) })),
      min: { x: x(low.date), y: y(low.balance) },
    };
  });
}
