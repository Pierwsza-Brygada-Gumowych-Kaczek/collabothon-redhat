import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { eurShort } from './format';

interface Flow {
  date: string;
  label: string;
  amount: number;
}

interface Point {
  date: string;
  balance: number;
  expected_in: number;
}

/** One point of the line: a day, a Monday–Sunday week or a calendar month. */
interface Bucket {
  from: string;
  to: string;
  balanceEnd: number;
  in: number;
  out: number;
  labels: string[];
}

type Mode = 'days' | 'weeks' | 'months';

const W = 760;
const H = 240;
const LEFT = 56;
const RIGHT = 14;
const TOP = 16;
const BOTTOM = 34;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIMITS: Record<Mode, number> = { days: 30, weeks: 12, months: 6 };

const utc = (iso: string) => new Date(iso + 'T00:00:00Z');
const dm = (iso: string) => {
  const d = utc(iso);
  return { d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], y: d.getUTCFullYear() };
};
const compact = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `€${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k` : `€${Math.round(a)}`;
  return v < 0 ? `-${s}` : s;
};

/** Balance forecast as a line chart; hover a point to see the amounts. Days / weeks / months. */
@Component({
  selector: 'app-cashflow-chart',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card">
      <div class="head">
        <div>
          <h2>Balance forecast</h2>
          @if (chart(); as c) {
            <p class="muted">{{ c.rangeLabel }} · hover the line to see the amounts</p>
          }
        </div>
        <div class="right">
          <div class="seg" role="group" aria-label="Chart period">
            @for (m of modes; track m.id) {
              <button [class.on]="mode() === m.id" (click)="setMode(m.id)">{{ m.label }}</button>
            }
          </div>
          <a routerLink="/liquidity" class="more">Full forecast →</a>
        </div>
      </div>

      @if (chart(); as c) {
        <div class="wrap">
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="chart" role="img" aria-label="Balance forecast line chart"
               (mousemove)="onMove($event)" (mouseleave)="hover.set(null)">
            @for (t of c.ticks; track t.v) {
              <line [attr.x1]="LEFT" [attr.x2]="W - RIGHT" [attr.y1]="t.y" [attr.y2]="t.y" class="grid" />
              <text [attr.x]="LEFT - 8" [attr.y]="t.y + 4" class="axis end">{{ compact(t.v) }}</text>
            }
            @if (c.zeroY !== null) {
              <line [attr.x1]="LEFT" [attr.x2]="W - RIGHT" [attr.y1]="c.zeroY" [attr.y2]="c.zeroY" class="zero" />
            }
            <path [attr.d]="c.area" class="area" />
            <path [attr.d]="c.line" class="line" />
            @for (p of c.pts; track p.from; let i = $index) {
              @if (p.showLabel) {
                <text [attr.x]="p.x" [attr.y]="H - BOTTOM + 18" class="axis mid">{{ p.tick }}</text>
              }
              @if (mode() !== 'days') {
                <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="dot" [class.low]="p.balanceEnd < 0" />
              }
            }

            @if (hovered(); as h) {
              <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="TOP" [attr.y2]="H - BOTTOM" class="guide" />
              <circle [attr.cx]="h.x" [attr.cy]="h.y" r="5.5" class="dot active" [class.low]="h.balanceEnd < 0" />
            }
            <!-- invisible layer that catches the mouse over the whole plot -->
            <rect [attr.x]="LEFT" [attr.y]="TOP" [attr.width]="W - LEFT - RIGHT" [attr.height]="H - TOP - BOTTOM" class="catch" />
          </svg>

          @if (hovered(); as h) {
            <div class="tip" [style.left.%]="(h.x / W) * 100" [style.top.%]="(h.y / H) * 100" [class.flip]="h.x > W * 0.7">
              <div class="t-period">{{ h.period }}</div>
              <div class="t-row"><span>Balance{{ mode() === 'days' ? '' : ' at the end' }}</span><b [class.neg]="h.balanceEnd < 0">{{ eurShort(h.balanceEnd) }}</b></div>
              <div class="t-row"><span>Money in (cards)</span><b class="pos">+{{ eurShort(h.in) }}</b></div>
              @if (h.out < 0) {
                <div class="t-row"><span>Scheduled payments</span><b class="neg">{{ eurShort(h.out) }}</b></div>
                <div class="t-lbl">{{ h.labels }}</div>
              }
            </div>
          }
        </div>
      } @else {
        <p class="muted">Not enough forecast data for this view.</p>
      }
    </section>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .head h2 { margin-bottom: .2rem; }
    .head p { margin: 0 0 .6rem; }
    .right { display: flex; align-items: center; gap: 1rem; }
    .seg { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; }
    .seg button { background: var(--surface); color: var(--text); border: 0; border-radius: 0; padding: .3rem .75rem; font-size: .8rem; }
    .seg button.on { background: var(--btn-bg); color: var(--btn-fg); }
    .wrap { position: relative; }
    .chart { width: 100%; height: auto; display: block; }
    .grid { stroke: var(--grid); }
    .axis { font-size: 11px; fill: var(--muted); }
    .axis.end { text-anchor: end; }
    .axis.mid { text-anchor: middle; }
    .zero { stroke: var(--red); stroke-dasharray: 4 4; }
    .area { fill: rgba(0, 102, 204, .10); }
    .line { fill: none; stroke: var(--blue); stroke-width: 2.4; stroke-linejoin: round; }
    .dot { fill: var(--surface); stroke: var(--blue); stroke-width: 1.6; }
    .dot.low { stroke: var(--red); }
    .dot.active { fill: var(--blue); stroke: var(--surface); stroke-width: 2; }
    .dot.active.low { fill: var(--red); }
    .guide { stroke: var(--text); stroke-dasharray: 3 3; opacity: .45; }
    .catch { fill: transparent; cursor: crosshair; }
    .tip { position: absolute; transform: translate(12px, -50%); background: var(--tip-bg); color: #fff; border-radius: 8px;
      padding: .5rem .65rem; font-size: .78rem; min-width: 170px; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,.25); z-index: 2; }
    .tip.flip { transform: translate(calc(-100% - 12px), -50%); }
    .t-period { font-weight: 700; margin-bottom: .3rem; }
    .t-row { display: flex; justify-content: space-between; gap: 1rem; }
    .t-row .pos { color: #8fd18a; }
    .t-row .neg { color: #ff8f86; }
    .t-lbl { color: #bbb; font-size: .72rem; margin-top: .2rem; max-width: 220px; }
  `,
})
export class CashflowChartComponent {
  readonly flows = input.required<Flow[]>();
  readonly forecast = input.required<Point[]>();
  readonly mode = signal<Mode>('weeks');
  readonly hover = signal<number | null>(null);

  readonly modes: { id: Mode; label: string }[] = [
    { id: 'days', label: 'Days' },
    { id: 'weeks', label: 'Weeks' },
    { id: 'months', label: 'Months' },
  ];

  readonly eurShort = eurShort;
  readonly compact = compact;
  readonly W = W;
  readonly H = H;
  readonly LEFT = LEFT;
  readonly RIGHT = RIGHT;
  readonly TOP = TOP;
  readonly BOTTOM = BOTTOM;

  setMode(m: Mode): void {
    this.mode.set(m);
    this.hover.set(null);
  }

  /** Map the mouse position to the nearest point of the line. */
  onMove(e: MouseEvent): void {
    const c = this.chart();
    if (!c) return;
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < c.pts.length; i++) {
      if (Math.abs(c.pts[i].x - x) < Math.abs(c.pts[best].x - x)) best = i;
    }
    this.hover.set(best);
  }

  private readonly outByDate = computed(() => {
    const out = new Map<string, { amount: number; labels: string[] }>();
    for (const f of this.flows()) {
      if (f.amount >= 0) continue;
      const o = out.get(f.date) ?? { amount: 0, labels: [] };
      o.amount += f.amount;
      if (!o.labels.includes(f.label)) o.labels.push(f.label);
      out.set(f.date, o);
    }
    return out;
  });

  private readonly buckets = computed<Bucket[]>(() => {
    const pts = this.forecast();
    const out = this.outByDate();
    const mode = this.mode();
    const toBucket = (g: Point[]): Bucket => {
      const labels: string[] = [];
      let o = 0;
      for (const p of g) {
        const x = out.get(p.date);
        if (!x) continue;
        o += x.amount;
        for (const l of x.labels) if (!labels.includes(l)) labels.push(l);
      }
      return {
        from: g[0].date,
        to: g[g.length - 1].date,
        balanceEnd: g[g.length - 1].balance,
        in: g.reduce((s, p) => s + p.expected_in, 0),
        out: Math.round(o),
        labels,
      };
    };

    if (mode === 'days') return pts.slice(0, LIMITS.days).map((p) => toBucket([p]));

    const groups: Point[][] = [];
    let key = '';
    for (const p of pts) {
      const d = utc(p.date);
      const k = mode === 'weeks' ? (d.getUTCDay() === 1 || !groups.length ? p.date : key) : p.date.slice(0, 7);
      if (k !== key) {
        groups.push([]);
        key = k;
      }
      groups[groups.length - 1].push(p);
    }
    // Drop a trailing incomplete week/month so every point is comparable.
    const last = groups[groups.length - 1];
    if (groups.length > 1 && last) {
      const incomplete = mode === 'weeks'
        ? last.length < 7
        : dm(last[last.length - 1].date).d < new Date(Date.UTC(dm(last[0].date).y, utc(last[0].date).getUTCMonth() + 1, 0)).getUTCDate();
      if (incomplete) groups.pop();
    }
    return groups.slice(0, LIMITS[mode]).map(toBucket);
  });

  readonly chart = computed(() => {
    const b = this.buckets();
    if (b.length < 2) return null;
    const mode = this.mode();

    const vals = b.map((x) => x.balanceEnd);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const pad = Math.max((max - min) * 0.15, 1000);
    const top = max + pad;
    const bottom = Math.min(min - pad, min < 0 ? min - pad : min - pad);
    const INSET = 22; // keep first/last points and their labels inside the plot
    const plotW = W - LEFT - RIGHT - 2 * INSET;
    const plotH = H - TOP - BOTTOM;
    const x = (i: number) => LEFT + INSET + (b.length === 1 ? plotW / 2 : (i / (b.length - 1)) * plotW);
    const y = (v: number) => TOP + ((top - v) / (top - bottom)) * plotH;

    const labelEvery = mode === 'days' ? 5 : 1;
    const pts = b.map((p, i) => {
      const f = dm(p.from);
      const t = dm(p.to);
      const tick = mode === 'days' ? `${f.d} ${f.m}` : mode === 'weeks' ? `${f.d} ${f.m}` : `${f.m}`;
      const period = mode === 'days'
        ? `${f.d} ${f.m} ${f.y}`
        : mode === 'weeks' ? `Week ${f.d} ${f.m} – ${t.d} ${t.m}` : `${f.m} ${f.y}`;
      return {
        ...p,
        x: x(i),
        y: y(p.balanceEnd),
        tick,
        period,
        showLabel: i % labelEvery === 0,
        labels: p.labels.join(', '),
      };
    });

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
    const baseY = H - BOTTOM;
    const area = `${line}L${pts[pts.length - 1].x.toFixed(1)},${baseY}L${pts[0].x.toFixed(1)},${baseY}Z`;
    const ticks = [top - pad, (top + bottom) / 2, bottom + pad].map((v) => ({ v, y: y(v) }));
    const f = dm(b[0].from);
    const t = dm(b[b.length - 1].to);

    return {
      pts,
      line,
      area,
      ticks,
      zeroY: bottom < 0 && top > 0 ? y(0) : null,
      rangeLabel: `${b.length} ${mode} · ${f.d} ${f.m} – ${t.d} ${t.m} ${t.y}`,
    };
  });

  readonly hovered = computed(() => {
    const i = this.hover();
    const c = this.chart();
    return i === null || !c ? null : c.pts[Math.min(i, c.pts.length - 1)];
  });
}
