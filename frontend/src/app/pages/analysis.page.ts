import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BankService } from '../bank.service';
import { eur, eurShort } from '../format';

const W = 800;
const H = 220;
const PAD = 14;
const LEFT = 58; // room for Y-axis labels

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [DatePipe],
  template: `
    <h1 class="page-title">Analytics</h1>
    <p class="page-lead">How the money in your business account changed during {{ year() }}.</p>

    @if (bank.overview(); as o) {
      <div class="stack">
        <section class="kpis">
          <div class="card kpi"><span>Money in this year</span><strong class="pos">{{ eurShort(o.kpis.total_income) }}</strong></div>
          <div class="card kpi"><span>Money out this year</span><strong class="neg">{{ eurShort(o.kpis.total_expenses) }}</strong></div>
          <div class="card kpi">
            <span>Lowest balance ({{ o.kpis.min_balance_date | date: 'd MMM' }})</span>
            <strong class="neg">{{ eurShort(o.kpis.min_balance) }}</strong>
          </div>
          <div class="card kpi"><span>Days in overdraft</span><strong>{{ o.kpis.overdraft_days }}</strong></div>
        </section>

        <section class="card">
          <h2>Balance day by day</h2>
          @if (chart(); as c) {
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Daily balance chart">
              <defs>
                <clipPath id="above"><rect x="0" y="0" [attr.width]="W" [attr.height]="c.zeroY" /></clipPath>
                <clipPath id="below"><rect x="0" [attr.y]="c.zeroY" [attr.width]="W" [attr.height]="H" /></clipPath>
              </defs>
              @for (t of c.ticks; track t.v) {
                <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
                <text x="2" [attr.y]="t.y + 4" class="axis">{{ eurShort(t.v) }}</text>
              }
              <path [attr.d]="c.area" class="area-pos" clip-path="url(#above)" />
              <path [attr.d]="c.area" class="area-neg" clip-path="url(#below)" />
              <line [attr.x1]="LEFT" [attr.x2]="W" [attr.y1]="c.zeroY" [attr.y2]="c.zeroY" class="zero" />
              <path [attr.d]="c.line" class="line" />
              <circle [attr.cx]="c.minPoint.x" [attr.cy]="c.minPoint.y" r="4" class="min-dot" />
              @for (m of c.months; track m.label) {
                <text [attr.x]="m.x" [attr.y]="H + 16" class="axis">{{ m.label }}</text>
              }
            </svg>
            <p class="note">
              <span class="sw neg-sw"></span> The red area shows when the account was overdrawn. In June the restaurant
              was closed for 3 weeks (no revenue) while costs and the Zurich instalments kept going out.
            </p>
          }
        </section>

        <section class="card">
          <h2>Money in and out per month</h2>
          @if (bars(); as bs) {
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Monthly income and expenses">
              @for (b of bs; track b.label) {
                <rect [attr.x]="b.inX" [attr.y]="H - b.inH" [attr.width]="b.w" [attr.height]="b.inH" class="bar-in">
                  <title>{{ b.label }}: income {{ eur(b.income) }}</title>
                </rect>
                <rect [attr.x]="b.outX" [attr.y]="H - b.outH" [attr.width]="b.w" [attr.height]="b.outH" class="bar-out">
                  <title>{{ b.label }}: expenses {{ eur(b.expenses) }}</title>
                </rect>
                <text [attr.x]="b.x" [attr.y]="H + 16" class="axis center">{{ b.label }}</text>
              }
            </svg>
            <div class="legend"><span class="sw in"></span> money in <span class="sw out"></span> money out</div>
          }
        </section>

        <section class="card">
          <h2>Where the money goes</h2>
          <ul class="cats">
            @for (c of expenseCategories(); track c.name) {
              <li>
                <div class="cat-row"><span>{{ c.name }}</span><span>{{ eurShort(c.amount) }} · {{ c.pct.toFixed(0) }}%</span></div>
                <div class="track"><div class="fill" [style.width.%]="c.pct"></div></div>
              </li>
            }
          </ul>
        </section>
      </div>
    }
  `,
  styles: `
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
    .kpi { display: flex; flex-direction: column; gap: .3rem; }
    .kpi span { font-size: .8rem; color: #6a6e73; }
    .kpi strong { font-size: 1.35rem; }
    .chart { width: 100%; height: auto; display: block; }
    .grid-line { stroke: #eee; }
    .zero { stroke: #8a8d90; stroke-dasharray: 4 4; }
    .axis { font-size: 11px; fill: #6a6e73; }
    .axis.center { text-anchor: middle; }
    .area-pos { fill: rgba(0, 102, 204, .12); }
    .area-neg { fill: rgba(201, 25, 11, .18); }
    .line { fill: none; stroke: #0066cc; stroke-width: 2; }
    .min-dot { fill: #c9190b; }
    .note { font-size: .88rem; color: #4f5255; margin: .6rem 0 0; line-height: 1.5; }
    .bar-in { fill: #3e8635; }
    .bar-out { fill: #c9190b; opacity: .8; }
    .legend { font-size: .85rem; color: #6a6e73; display: flex; align-items: center; gap: .35rem; }
    .sw { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }
    .sw.in { background: #3e8635; }
    .sw.out { background: #c9190b; margin-left: .75rem; }
    .neg-sw { background: rgba(201, 25, 11, .35); }
    .cats { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .8rem; }
    .cat-row { display: flex; justify-content: space-between; font-size: .9rem; margin-bottom: .25rem; }
    .track { background: #f0f0f0; border-radius: 4px; height: 8px; }
    .fill { background: #ee0000; height: 100%; border-radius: 4px; }
    @media (max-width: 800px) { .kpis { grid-template-columns: 1fr 1fr; } }
  `,
})
export class AnalysisPage {
  readonly bank = inject(BankService);
  readonly eur = eur;
  readonly eurShort = eurShort;
  readonly W = W;
  readonly H = H;
  readonly LEFT = LEFT;

  readonly year = computed(() => this.bank.overview()?.period_from.slice(0, 4) ?? '');

  /** Daily balance: line + area above/below zero; X axis by date. */
  readonly chart = computed(() => {
    const o = this.bank.overview();
    if (!o) return null;
    const pts = o.daily_balance;
    const values = pts.map((p) => p.balance);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const t0 = Date.parse(pts[0].date);
    const tSpan = Date.parse(pts[pts.length - 1].date) - t0 || 1;
    const xAt = (d: string) => LEFT + ((Date.parse(d) - t0) / tSpan) * (W - PAD - LEFT);
    const y = (v: number) => PAD + ((max - v) / span) * (H - 2 * PAD);
    const zeroY = y(0);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.date).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
    const xEnd = xAt(pts[pts.length - 1].date).toFixed(1);
    const area = `${line}L${xEnd},${zeroY.toFixed(1)}L${LEFT},${zeroY.toFixed(1)}Z`;

    const minIdx = values.indexOf(Math.min(...values));
    return {
      line,
      area,
      zeroY,
      months: o.monthly.map((m) => ({ label: m.label, x: xAt(`${m.month}-01`) })),
      ticks: [max, max / 2, 0, min / 2, min].filter((v, i, a) => a.indexOf(v) === i).map((v) => ({ v, y: y(v) })),
      minPoint: { x: xAt(pts[minIdx].date), y: y(values[minIdx]) },
    };
  });

  readonly bars = computed(() => {
    const o = this.bank.overview();
    if (!o) return null;
    const max = Math.max(...o.monthly.flatMap((m) => [m.income, m.expenses]));
    const slot = W / o.monthly.length;
    const bw = slot * 0.32;
    const h = (v: number) => (v / max) * (H - 30);
    return o.monthly.map((m, i) => ({
      label: m.label,
      x: i * slot + slot / 2,
      inX: i * slot + slot / 2 - bw - 1,
      outX: i * slot + slot / 2 + 1,
      w: bw,
      inH: h(m.income),
      outH: h(m.expenses),
      income: m.income,
      expenses: m.expenses,
    }));
  });

  readonly expenseCategories = computed(() => {
    const o = this.bank.overview();
    if (!o) return [];
    const exp = o.categories.filter((c) => c.amount < 0);
    const total = exp.reduce((s, c) => s - c.amount, 0);
    return exp.map((c) => ({ name: c.name, amount: -c.amount, pct: (-c.amount / total) * 100 }));
  });
}
