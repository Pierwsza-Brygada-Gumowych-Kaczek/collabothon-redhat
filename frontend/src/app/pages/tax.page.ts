import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BankService } from '../bank.service';
import { AgentSourceComponent } from '../agent-source.component';
import { AgentErrorComponent } from '../agent-error.component';
import { DemoBannerComponent } from '../demo-banner.component';
import { eur, eurShort } from '../format';

const DIFFICULTY = { easy: 1, medium: 2, hard: 3 } as const;

@Component({
  selector: 'app-tax-page',
  standalone: true,
  imports: [DatePipe, AgentSourceComponent, AgentErrorComponent, DemoBannerComponent],
  template: `
    <div class="head">
      <div>
        <h1 class="page-title">Tax agent</h1>
        <p class="page-lead">
          Based on the account flows, the agent checks your advance tax payments, plans the next ones
          and finds legal ways to pay less. All amounts are estimates.
        </p>
      </div>
      <button class="secondary" (click)="bank.loadTaxTips(true)" [disabled]="bank.taxLoading()">
        {{ bank.taxLoading() ? 'Analysing…' : 'Run analysis again' }}
      </button>
    </div>

    @if (bank.taxTips(); as tx) {
      @if (tx.source === 'demo') { <app-demo-banner /> }
      @let f = tx.facts;
      <div class="stack">
        @if (f.estimated_additional_payment > 0) {
          <section class="card alert-card">
            <div class="alert-icon">!</div>
            <div class="alert-body">
              <h2>Set aside about {{ eurShort(f.estimated_additional_payment) }} for a tax back-payment</h2>
              <p>
                The tax office based your prepayments on a profit of <b>{{ eurShort(f.prepayment_basis) }}</b>,
                but your {{ f.year }} profit is about <b>{{ eurShort(f.estimated_profit) }}</b>. After you file the
                return you will get a bill, and next year's prepayments will go up.
              </p>
              <div class="compare">
                <div class="cmp-row">
                  <span>Profit used for prepayments</span>
                  <div class="cmp-track"><div class="cmp-fill basis" [style.width.%]="basisPct()"></div></div>
                  <b>{{ eurShort(f.prepayment_basis) }}</b>
                </div>
                <div class="cmp-row">
                  <span>Your estimated profit</span>
                  <div class="cmp-track"><div class="cmp-fill profit" style="width: 100%"></div></div>
                  <b>{{ eurShort(f.estimated_profit) }}</b>
                </div>
              </div>
            </div>
          </section>
        }

        <section class="card">
          <h2>Your {{ f.year }} taxes in numbers</h2>
          <div class="facts">
            <div><span>Business profit (estimate)</span><strong>{{ eurShort(f.estimated_profit) }}</strong></div>
            <div><span>Income tax + solidarity surcharge (estimate)</span><strong>{{ eurShort(f.estimated_income_tax) }}</strong></div>
            <div><span>Trade tax, Frankfurt (estimate)</span><strong>{{ eurShort(f.estimated_trade_tax) }}</strong></div>
            <div><span>Prepayments already paid</span><strong>{{ eurShort(f.income_tax_prepaid + f.trade_tax_prepaid) }}</strong></div>
            <div><span>Wage tax for employees</span><strong>{{ eurShort(f.wage_tax_paid) }}</strong></div>
            <div><span>Social security for employees</span><strong>{{ eurShort(f.social_security_paid) }}</strong></div>
          </div>
          <p class="rate">
            Your tax rate is about <b>{{ f.marginal_rate_pct }}%</b> — of every extra <b>€1,000</b> of profit,
            about <b>{{ eurShort(f.marginal_rate_pct * 10) }}</b> goes to tax. That is why every legal deduction counts.
          </p>
        </section>

        <section class="card">
          <div class="section-head">
            <h2>Advance tax payment plan</h2>
            <label class="muted"><input type="checkbox" [checked]="showWage()" (change)="showWage.set(!showWage())" /> show monthly wage tax</label>
          </div>
          <div class="plan-tiles">
            <div><span>Recommended income tax prepayment</span><strong>{{ eurShort(f.recommended_quarterly_prepayment) }}</strong><small>per quarter (now {{ eurShort(f.income_tax_prepaid / 4) }})</small></div>
            <div><span>Move into a tax reserve</span><strong>{{ eurShort(f.monthly_tax_reserve) }}</strong><small>per month for the next 6 months</small></div>
          </div>
          <table class="plan">
            <thead><tr><th>Due</th><th>Tax</th><th class="num">Today</th><th class="num">Recommended</th><th>What to do</th></tr></thead>
            <tbody>
              @for (p of schedule(); track $index) {
                <tr [class.changed]="p.recommended_amount > p.current_amount">
                  <td class="date">{{ p.date | date: 'd MMM yyyy' }}</td>
                  <td>{{ p.tax }}</td>
                  <td class="num">{{ eur(p.current_amount) }}</td>
                  <td class="num rec">{{ eur(p.recommended_amount) }}</td>
                  <td class="muted">{{ p.note }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        @if (tx.source === 'unavailable') {
          <app-agent-error agent="The tax agent" [error]="tx.error ?? ''" [hasFacts]="true" [loading]="bank.taxLoading()" (retry)="bank.loadTaxTips(true)" />
        } @else {
        <section class="card total">
          <span class="muted">You could legally save about</span>
          <strong>{{ eurShort(totals().min) }} – {{ eurShort(totals().max) }}</strong>
          <span class="muted">a year if you use all the tips below ({{ tx.tips.length }})</span>
        </section>

        @for (t of tx.tips; track $index) {
          <article class="card tip">
            <div class="tip-top">
              <span class="chip">{{ t.category }}</span>
              @if (t.legal_basis) {
                <span class="law" title="Legal basis">{{ t.legal_basis }}</span>
              }
            </div>
            <h3>{{ t.title }}</h3>
            <div class="tip-facts">
              <div class="tf save">
                <span>You could save</span>
                <strong>{{ eurShort(t.saving_min_eur) }} – {{ eurShort(t.saving_max_eur) }}</strong>
                <small>in tax, per year</small>
              </div>
              <div class="tf">
                <span>Effort</span>
                <div class="meter" [attr.data-level]="level(t.difficulty)">
                  @for (i of [1, 2, 3]; track i) {
                    <i [class.on]="i <= level(t.difficulty)"></i>
                  }
                  <b>{{ t.difficulty }}</b>
                </div>
              </div>
              <div class="tf">
                <span>When to act</span>
                <strong class="when">{{ t.when }}</strong>
              </div>
            </div>
            <p><b>What is it?</b> {{ t.plain_explanation }}</p>
            @if (t.steps.length) {
              <div class="steps">
                <b>How to do it:</b>
                <ol>
                  @for (s of t.steps; track $index) {
                    <li>{{ s }}</li>
                  }
                </ol>
              </div>
            }
            <p class="why"><b>Why for you?</b> {{ t.rationale }}</p>
          </article>
        }

        @if (tx.warnings.length) {
          <section class="card warn">
            <h2>Watch out for</h2>
            <ul>
              @for (w of tx.warnings; track $index) {
                <li>{{ w }}</li>
              }
            </ul>
          </section>
        }

        }
        <app-agent-source
          [meta]="tx"
          [disclaimer]="'Estimate for a single filer using the German ' + f.year + ' tax tariff; costs outside this account are not included. Not tax advice — talk to a tax adviser before deciding.'"
        />
      </div>
    } @else {
      <p class="muted">The tax agent is analysing your account…</p>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    .head button { flex-shrink: 0; margin-top: .25rem; }
    .alert-card { display: flex; gap: 1rem; border-left: 5px solid #c9190b; }
    .alert-icon { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; background: #c9190b; color: #fff;
      display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; }
    .alert-body h2 { color: #a30000; font-size: 1.2rem; }
    .alert-body p { line-height: 1.55; margin: 0 0 .8rem; }
    .compare { display: flex; flex-direction: column; gap: .4rem; font-size: .85rem; }
    .cmp-row { display: grid; grid-template-columns: 200px 1fr 90px; gap: .6rem; align-items: center; }
    .cmp-row b { text-align: right; }
    .cmp-track { height: 12px; background: #f0f0f0; border-radius: 999px; overflow: hidden; }
    .cmp-fill { height: 100%; border-radius: 999px; }
    .cmp-fill.basis { background: #8a8d90; }
    .cmp-fill.profit { background: #c9190b; }
    .facts, .plan-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }
    .plan-tiles { grid-template-columns: repeat(2, 1fr); margin-bottom: .9rem; }
    .facts div, .plan-tiles div { background: #f7f7f7; border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .plan-tiles div { background: #eef5fc; }
    .facts span, .plan-tiles span { font-size: .78rem; color: #6a6e73; }
    .facts strong, .plan-tiles strong { font-size: 1.2rem; }
    .plan-tiles small { font-size: .75rem; color: #4f5255; }
    .rate { margin: .9rem 0 0; line-height: 1.5; }
    .plan { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .plan th { text-align: left; font-size: .75rem; color: #6a6e73; font-weight: 600; padding: .4rem .3rem; border-bottom: 1px solid #e3e3e3; }
    .plan td { padding: .5rem .3rem; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .plan .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .plan .date { white-space: nowrap; }
    .plan tr.changed .rec { color: #c9190b; font-weight: 700; }
    .total { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .2rem;
      background: #f3faf2; box-shadow: none; border: 1px solid #c8e6c3; }
    .total strong { font-size: 2rem; color: #3e8635; }
    .tip { border-left: 5px solid #3e8635; }
    .tip-top { display: flex; justify-content: space-between; gap: .5rem; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6a6e73; }
    .law { font-size: .72rem; background: #f0f0f0; padding: .1rem .5rem; border-radius: 999px; color: #4f5255; }
    h3 { font-size: 1.15rem; margin: .35rem 0 .9rem; }
    .tip-facts { display: grid; grid-template-columns: 1.3fr 1fr 1.3fr; gap: .75rem; margin-bottom: .6rem; }
    .tf { background: #f7f7f7; border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .tf span { font-size: .75rem; color: #6a6e73; }
    .tf strong { font-size: 1.2rem; }
    .tf small { font-size: .75rem; color: #4f5255; }
    .tf.save { background: #f3faf2; }
    .tf.save strong { color: #3e8635; }
    .tf .when { font-size: .95rem; font-weight: 600; }
    .meter { display: flex; align-items: center; gap: 3px; --c: #3e8635; }
    .meter[data-level='2'] { --c: #f0ab00; }
    .meter[data-level='3'] { --c: #c9190b; }
    .meter i { width: 18px; height: 8px; border-radius: 3px; background: #ddd; }
    .meter i.on { background: var(--c); }
    .meter b { margin-left: .4rem; font-size: 1.05rem; text-transform: capitalize; }
    .tip p { line-height: 1.5; margin: .45rem 0; font-size: .92rem; }
    .steps { font-size: .92rem; }
    .steps ol { margin: .3rem 0 .4rem; padding-left: 1.3rem; line-height: 1.55; }
    .warn { background: #fdf7e7; }
    .warn ul { margin: 0; padding-left: 1.2rem; line-height: 1.6; color: #6b3600; }
    @media (max-width: 800px) {
      .head { flex-direction: column; }
      .facts { grid-template-columns: 1fr 1fr; }
      .tip-facts, .plan-tiles { grid-template-columns: 1fr; }
      .cmp-row { grid-template-columns: 1fr 80px; }
      .cmp-row .cmp-track { grid-column: 1 / -1; grid-row: 2; }
      .plan td:last-child, .plan th:last-child { display: none; }
    }
  `,
})
export class TaxPage {
  readonly bank = inject(BankService);
  readonly eur = eur;
  readonly eurShort = eurShort;
  readonly showWage = signal(false);
  readonly level = (d: keyof typeof DIFFICULTY): number => DIFFICULTY[d] ?? 2;

  readonly schedule = computed(() => {
    const all = this.bank.taxTips()?.schedule ?? [];
    return this.showWage() ? all : all.filter((p) => !p.tax.startsWith('Wage tax'));
  });

  readonly basisPct = computed(() => {
    const f = this.bank.taxTips()?.facts;
    return f && f.estimated_profit > 0 ? Math.min((f.prepayment_basis / f.estimated_profit) * 100, 100) : 0;
  });

  readonly totals = computed(() => {
    const tips = this.bank.taxTips()?.tips ?? [];
    return {
      min: tips.reduce((s, t) => s + t.saving_min_eur, 0),
      max: tips.reduce((s, t) => s + t.saving_max_eur, 0),
    };
  });
}
