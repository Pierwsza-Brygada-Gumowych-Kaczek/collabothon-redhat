import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BankService, Analytics, AnalyticsRange } from '../bank.service';
import { eur, eurShort } from '../format';

const W = 800;
const H = 220;
const PAD = 14;
const LEFT = 58; // room for Y-axis labels

const RANGES: { id: AnalyticsRange; label: string; phrase: string }[] = [
  { id: 'week', label: 'Last week', phrase: 'the last 7 days' },
  { id: 'month', label: 'Last month', phrase: 'the last 30 days' },
  { id: 'year', label: 'Last year', phrase: 'the last 12 months' },
  { id: 'all', label: 'All time', phrase: 'all time' },
];

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [DatePipe],
  template: `
    <h1 class="page-title">Analytics</h1>
    <p class="page-lead">
      How the money in your business account changed in {{ phrase() }}
      @if (data(); as d) { ({{ d.period_from | date: 'd MMM yyyy' }} – {{ d.period_to | date: 'd MMM yyyy' }}) }.
    </p>

    <div class="range" role="group" aria-label="Period">
      @for (r of ranges; track r.id) {
        <button type="button" [class.on]="range() === r.id" [attr.aria-pressed]="range() === r.id" (click)="setRange(r.id)">
          {{ r.label }}
        </button>
      }
    </div>

    @if (data(); as d) {
      <div class="stack" [class.loading]="loading()">
        <section class="kpis">
          <div class="card kpi"><span>Money in</span><strong class="pos">{{ eurShort(d.total_income) }}</strong></div>
          <div class="card kpi"><span>Money out</span><strong class="neg">{{ eurShort(d.total_expenses) }}</strong></div>
          <div class="card kpi">
            <span>Lowest balance ({{ d.min_balance_date | date: 'd MMM' }})</span>
            <strong [class.neg]="d.min_balance < 0">{{ eurShort(d.min_balance) }}</strong>
          </div>
          <div class="card kpi"><span>Days in overdraft</span><strong>{{ d.overdraft_days }}</strong></div>
        </section>

        <section class="card">
          <h2>Balance day by day</h2>
          @if (chart(); as c) {
            <p class="muted hint">Hover the chart to see the balance on any day.</p>
            <div class="wrap">
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Daily balance chart"
                 (mousemove)="onMove($event)" (mouseleave)="hover.set(null)">
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
              @for (m of c.labels; track m.x) {
                <text [attr.x]="m.x" [attr.y]="H + 16" class="axis mid">{{ m.label }}</text>
              }
              @if (hovered(); as h) {
                <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="PAD" [attr.y2]="H - PAD" class="guide" />
                <circle [attr.cx]="h.x" [attr.cy]="h.y" r="5.5" class="dot-active" [class.low]="h.balance < 0" />
              }
              <!-- invisible layer that catches the mouse over the whole plot -->
              <rect [attr.x]="LEFT" y="0" [attr.width]="W - LEFT" [attr.height]="H" class="catch" />
            </svg>
            @if (hovered(); as h) {
              <div class="tip" [style.left.%]="(h.x / W) * 100" [style.top.%]="(h.y / (H + 22)) * 100" [class.flip]="h.x > W * 0.7">
                <div class="t-period">{{ h.date | date: 'EEE d MMM yyyy' }}</div>
                <div class="t-row"><span>Balance</span><b [class.neg]="h.balance < 0">{{ eur(h.balance) }}</b></div>
                <div class="t-row"><span>Change that day</span>
                  <b [class.pos]="h.change > 0" [class.neg]="h.change < 0">{{ h.change > 0 ? '+' : '' }}{{ eur(h.change) }}</b></div>
              </div>
            }
            </div>
            <p class="note">
              <span class="sw neg-sw"></span> The red area shows when the account was overdrawn.
              @if (range() === 'year' || range() === 'all') {
                In June the restaurant was closed for 3 weeks (no revenue) while costs and the Zurich instalments kept going out.
              }
            </p>
          }
        </section>

        <section class="card">
          <h2>{{ range() === 'year' || range() === 'all' ? 'Money in and out per month' : 'Money in and out per day' }}</h2>
          @if (bars(); as bs) {
            <div class="wrap">
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + (H + 22)" class="chart" role="img" aria-label="Money in and out"
                 (mouseleave)="barHover.set(null)">
              @for (b of bs; track b.key) {
                <rect [attr.x]="b.inX" [attr.y]="H - b.inH" [attr.width]="b.w" [attr.height]="b.inH" class="bar-in" />
                <rect [attr.x]="b.outX" [attr.y]="H - b.outH" [attr.width]="b.w" [attr.height]="b.outH" class="bar-out" />
                @if (b.showLabel) {
                  <text [attr.x]="b.x" [attr.y]="H + 16" class="axis center">{{ b.label }}</text>
                }
              }
              @for (b of bs; track b.key; let i = $index) {
                <rect [attr.x]="b.slotX" y="0" [attr.width]="b.slotW" [attr.height]="H" class="catch"
                      [class.on]="barHover() === i" (mouseenter)="barHover.set(i)" />
              }
            </svg>
            @if (barHovered(); as b) {
              <div class="tip" [style.left.%]="(b.x / W) * 100" [style.top.%]="8" [class.flip]="b.x > W * 0.6">
                <div class="t-period">{{ b.label }}</div>
                <div class="t-row"><span>Money in</span><b class="pos">+{{ eur(b.income) }}</b></div>
                <div class="t-row"><span>Money out</span><b class="neg">-{{ eur(b.expenses) }}</b></div>
                <div class="t-row"><span>Net</span>
                  <b [class.pos]="b.income >= b.expenses" [class.neg]="b.income < b.expenses">{{ eur(b.income - b.expenses) }}</b></div>
              </div>
            }
            </div>
            <div class="legend"><span class="sw in"></span> money in <span class="sw out"></span> money out</div>
          }
        </section>

        <section class="card">
          <h2>Where the money goes</h2>
          @if (expenseCategories().length) {
            <ul class="cats">
              @for (c of expenseCategories(); track c.name) {
                <li>
                  <div class="cat-row"><span>{{ c.name }}</span><span>{{ eurShort(c.amount) }} · {{ c.pct.toFixed(0) }}%</span></div>
                  <div class="track"><div class="fill" [style.width.%]="c.pct"></div></div>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">No spending in this period.</p>
          }
        </section>
      </div>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
  styles: `
    .range { display: flex; gap: .5rem; flex-wrap: wrap; margin: 0 0 1rem; }
    .range button { padding: .45rem 1.1rem; border-radius: 999px; background: var(--surface-3); color: var(--text-2);
      border: 1px solid var(--border-2); font-weight: 600; font-size: .9rem;
      transition: background-color .15s, color .15s, border-color .15s, box-shadow .15s; }
    .range button:hover { border-color: var(--text-2); color: var(--text); }
    .range button.on { background: #ee0000; border-color: #ee0000; color: #fff; box-shadow: 0 2px 8px rgba(238, 0, 0, .3); }
    .loading { opacity: .6; transition: opacity .15s; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
    .kpi { display: flex; flex-direction: column; gap: .3rem; }
    .kpi span { font-size: .8rem; color: var(--muted); }
    .kpi strong { font-size: 1.35rem; }
    .chart { width: 100%; height: auto; display: block; }
    .grid-line { stroke: var(--grid); }
    .zero { stroke: var(--axis); stroke-dasharray: 4 4; }
    .axis { font-size: 11px; fill: var(--muted); }
    .axis.center, .axis.mid { text-anchor: middle; }
    .area-pos { fill: rgba(0, 102, 204, .12); }
    .area-neg { fill: rgba(201, 25, 11, .18); }
    .line { fill: none; stroke: var(--blue); stroke-width: 2; }
    .min-dot { fill: var(--red); }
    .wrap { position: relative; }
    .hint { margin: 0 0 .4rem; font-size: .85rem; }
    .guide { stroke: var(--text); stroke-dasharray: 3 3; opacity: .45; }
    .dot-active { fill: var(--blue); stroke: var(--surface); stroke-width: 2; }
    .dot-active.low { fill: var(--red); }
    .catch { fill: transparent; cursor: crosshair; }
    .catch.on { fill: rgba(128, 128, 128, .12); }
    .tip { position: absolute; transform: translate(12px, -50%); background: var(--tip-bg); color: #fff; border-radius: 8px;
      padding: .5rem .65rem; font-size: .78rem; min-width: 170px; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,.25); z-index: 2; }
    .tip.flip { transform: translate(calc(-100% - 12px), -50%); }
    .t-period { font-weight: 700; margin-bottom: .3rem; }
    .t-row { display: flex; justify-content: space-between; gap: 1rem; }
    .t-row .pos { color: #8fd18a; }
    .t-row .neg { color: #ff8f86; }
    .note { font-size: .88rem; color: var(--text-2); margin: .6rem 0 0; line-height: 1.5; }
    .bar-in { fill: var(--green); }
    .bar-out { fill: var(--red); opacity: .8; }
    .legend { font-size: .85rem; color: var(--muted); display: flex; align-items: center; gap: .35rem; }
    .sw { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }
    .sw.in { background: var(--green); }
    .sw.out { background: var(--red); margin-left: .75rem; }
    .neg-sw { background: rgba(201, 25, 11, .35); }
    .cats { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .8rem; }
    .cat-row { display: flex; justify-content: space-between; font-size: .9rem; margin-bottom: .25rem; }
    .track { background: var(--surface-3); border-radius: 4px; height: 8px; }
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
  readonly PAD = PAD;
  readonly LEFT = LEFT;
  readonly ranges = RANGES;

  readonly range = signal<AnalyticsRange>('year');
  readonly data = signal<Analytics | null>(null);
  readonly loading = signal(false);
  readonly hover = signal<number | null>(null);
  readonly barHover = signal<number | null>(null);

  readonly phrase = computed(() => RANGES.find((r) => r.id === this.range())?.phrase ?? '');

  constructor() {
    this.load('year');
  }

  setRange(r: AnalyticsRange): void {
    if (r === this.range()) return;
    this.range.set(r);
    this.hover.set(null);
    this.barHover.set(null);
    this.load(r);
  }

  private load(r: AnalyticsRange): void {
    this.loading.set(true);
    this.bank.analytics(r).subscribe({
      next: (a) => {
        // Ignore a slow answer for a period the user has already left.
        if (this.range() !== r) return;
        this.data.set(a);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Daily balance: line + area above/below zero; X axis by date. */
  readonly chart = computed(() => {
    const d = this.data();
    if (!d || !d.daily_balance.length) return null;
    const pts = d.daily_balance;
    const values = pts.map((p) => p.balance);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const t0 = Date.parse(pts[0].date);
    const tSpan = Date.parse(pts[pts.length - 1].date) - t0 || 1;
    const xAt = (date: string) => LEFT + ((Date.parse(date) - t0) / tSpan) * (W - PAD - LEFT);
    const y = (v: number) => PAD + ((max - v) / span) * (H - 2 * PAD);
    const zeroY = y(0);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.date).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
    const xEnd = xAt(pts[pts.length - 1].date).toFixed(1);
    const area = `${line}L${xEnd},${zeroY.toFixed(1)}L${LEFT},${zeroY.toFixed(1)}Z`;

    const minIdx = values.indexOf(Math.min(...values));
    const month = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
    const labels =
      d.range === 'year' || d.range === 'all'
        ? pts
            .filter((p) => p.date.endsWith('-01'))
            .filter((_, i, a) => i % Math.ceil(a.length / 12) === 0)
            .map((p) => ({ x: xAt(p.date), label: month(p.date) + (d.period_from.slice(0, 4) !== d.period_to.slice(0, 4) ? ' ' + p.date.slice(2, 4) : '') }))
        : pts
            .filter((_, i) => i % Math.ceil(pts.length / 8) === 0)
            .map((p) => ({ x: xAt(p.date), label: `${+p.date.slice(8)} ${month(p.date)}` }));
    return {
      line,
      area,
      zeroY,
      labels,
      ticks: [max, max / 2, 0, min / 2, min].filter((v, i, a) => a.indexOf(v) === i).map((v) => ({ v, y: y(v) })),
      minPoint: { x: xAt(pts[minIdx].date), y: y(values[minIdx]) },
      pts: pts.map((p, i) => ({
        x: xAt(p.date),
        y: y(p.balance),
        date: p.date,
        balance: p.balance,
        change: i ? p.balance - pts[i - 1].balance : 0,
      })),
    };
  });

  /** Map the mouse position to the nearest day of the balance line. */
  onMove(e: MouseEvent): void {
    const c = this.chart();
    if (!c) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < c.pts.length; i++) {
      if (Math.abs(c.pts[i].x - x) < Math.abs(c.pts[best].x - x)) best = i;
    }
    this.hover.set(best);
  }

  readonly hovered = computed(() => {
    const i = this.hover();
    const c = this.chart();
    return i === null || !c ? null : (c.pts[i] ?? null);
  });

  readonly bars = computed(() => {
    const d = this.data();
    if (!d || !d.buckets.length) return null;
    const max = Math.max(...d.buckets.flatMap((b) => [b.income, b.expenses]), 1);
    const slot = W / d.buckets.length;
    const bw = slot * 0.32;
    const h = (v: number) => (v / max) * (H - 30);
    const every = Math.ceil(d.buckets.length / 12);
    return d.buckets.map((b, i) => ({
      key: b.key,
      label: b.label,
      showLabel: i % every === 0,
      x: i * slot + slot / 2,
      slotX: i * slot,
      slotW: slot,
      inX: i * slot + slot / 2 - bw - 1,
      outX: i * slot + slot / 2 + 1,
      w: bw,
      inH: h(b.income),
      outH: h(b.expenses),
      income: b.income,
      expenses: b.expenses,
    }));
  });

  readonly barHovered = computed(() => {
    const i = this.barHover();
    const b = this.bars();
    return i === null || !b ? null : (b[i] ?? null);
  });

  readonly expenseCategories = computed(() => {
    const d = this.data();
    if (!d) return [];
    const total = d.categories.reduce((s, c) => s + c.amount, 0) || 1;
    return d.categories.map((c) => ({ name: c.name, amount: c.amount, pct: (c.amount / total) * 100 }));
  });
}
