import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BankService, Transaction } from '../bank.service';
import { BudgetTileComponent } from '../budget-tile.component';
import { eur, eurShort } from '../format';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [DatePipe, RouterLink, BudgetTileComponent],
  template: `
    @if (bank.overview(); as o) {
      <h1 class="page-title">Good morning, {{ firstName() }}</h1>
      <p class="page-lead">Here is your business account at a glance.</p>

      <div class="stack">
        <section class="card hero">
          <div>
            <div class="muted">Available balance</div>
            <div class="balance">{{ eur(o.balance) }}</div>
            <div class="muted">as of {{ o.period_to | date: 'd MMM yyyy' }} · {{ o.account_iban }}</div>
          </div>
          @if (lastMonth(); as m) {
            <div class="month">
              <div class="muted">Last month ({{ m.label }})</div>
              <div class="row"><span>Money in</span><strong class="pos">+{{ eurShort(m.income) }}</strong></div>
              <div class="row"><span>Money out</span><strong class="neg">−{{ eurShort(m.expenses) }}</strong></div>
              <div class="row total">
                <span>Left over</span>
                <strong [class.pos]="m.net >= 0" [class.neg]="m.net < 0">{{ eurShort(m.net) }}</strong>
              </div>
            </div>
          }
        </section>

        <section>
          <div class="section-head">
            <h2>Your AI CFO agents</h2>
            <span class="muted">{{ demoMode() ? 'demo mode — AI model not connected yet' : 'powered by OpenShift AI' }}</span>
          </div>
          <div class="agents">
            <a routerLink="/liquidity" class="card agent" data-tone="blue">
              <span class="a-name">Liquidity agent</span>
              @if (bank.liquidity(); as l) {
                @if (l.source === 'unavailable') { <strong class="down">AI unavailable</strong><span class="a-text">Forecast low: {{ eurShort(l.min_balance) }} in {{ l.days }} days</span> } @else {
                <strong>Lowest in {{ l.days }} days: {{ eurShort(l.min_balance) }}</strong>
                <span class="a-text">
                  {{ l.facilities.length ? l.facilities.length + ' credit facility proposed' + (l.facilities.length > 1 ? 's' : '') : 'No financing needed' }}
                </span>
                }
              } @else { <span class="a-text">Forecasting cash flow…</span> }
              <span class="more">Open forecast →</span>
            </a>
            <a routerLink="/investments" class="card agent" data-tone="green">
              <span class="a-name">Investment agent</span>
              @if (bank.insights(); as i) {
                @if (i.source === 'unavailable') { <strong class="down">AI unavailable</strong><span class="a-text">No investment proposals right now</span> } @else {
                <strong>{{ i.proposals.length }} ideas for your cash</strong>
                <span class="a-text">{{ i.proposals.length ? i.proposals[0].title : "" }}</span>
                }
              } @else { <span class="a-text">Analysing available liquidity…</span> }
              <span class="more">See proposals →</span>
            </a>
            <a routerLink="/tax" class="card agent" data-tone="red">
              <span class="a-name">Tax agent</span>
              @if (bank.taxTips(); as t) {
                @if (t.source === 'unavailable') { <strong class="down">AI unavailable</strong><span class="a-text">Calculated: reserve ≈ {{ eurShort(t.facts.estimated_additional_payment) }} for a tax back-payment</span> } @else {
                <strong>Save up to {{ eurShort(taxSavingMax()) }} a year</strong>
                <span class="a-text">Reserve ≈ {{ eurShort(t.facts.estimated_additional_payment) }} for a tax back-payment</span>
                }
              } @else { <span class="a-text">Checking tax prepayments…</span> }
              <span class="more">See tax plan →</span>
            </a>
            <a routerLink="/fx" class="card agent" data-tone="amber">
              <span class="a-name">FX hedging agent</span>
              @if (bank.fx(); as f) {
                @if (f.source === 'unavailable') {
                  <strong class="down">AI unavailable</strong><span class="a-text">No hedge proposals right now</span>
                } @else if (f.exposures.length) {
                  <strong>{{ f.exposures[0].currency }} risk: {{ f.risk_level }}</strong>
                  <span class="a-text">Rate moved {{ f.exposures[0].rate_swing_pct }}% · {{ f.hedges.length }} hedges proposed</span>
                } @else { <strong>No currency risk</strong> }
              } @else { <span class="a-text">Scanning foreign payments…</span> }
              <span class="more">See hedges →</span>
            </a>
          </div>
        </section>

        @if (bank.budgets().length) {
          <section>
            <div class="section-head">
              <h2>Budgets this month</h2>
              <span class="muted">how much you can still spend</span>
            </div>
            <div class="budgets">
              @for (b of bank.budgets(); track b.id) {
                <app-budget-tile [budget]="b" />
              }
            </div>
          </section>
        }

        <section class="card">
          <div class="section-head">
            <h2>Recent transactions</h2>
            <a routerLink="/transactions" class="more">All transactions →</a>
          </div>
          <table class="tx">
            <tbody>
              @for (t of recent(); track $index) {
                <tr>
                  <td class="date">{{ t.date | date: 'd MMM' }}</td>
                  <td><div class="cp">{{ t.counterparty }}</div><small class="muted">{{ t.category }}</small></td>
                  <td class="amt" [class.pos]="t.amount > 0" [class.neg]="t.amount < 0">{{ eur(t.amount_eur) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      </div>
    } @else if (!bank.error()) {
      <p class="muted">Loading account…</p>
    }
  `,
  styles: `
    .hero { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem; align-items: center; }
    .balance { font-size: 2.6rem; font-weight: 700; margin: .2rem 0; }
    .month { min-width: 260px; display: flex; flex-direction: column; gap: .35rem; }
    .row { display: flex; justify-content: space-between; gap: 2rem; }
    .row.total { border-top: 1px solid #e3e3e3; padding-top: .35rem; }
    .agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1rem; }
    .agent { display: flex; flex-direction: column; gap: .35rem; text-decoration: none; color: inherit;
      border-top: 4px solid var(--tone); transition: box-shadow .15s; }
    .agent:hover { box-shadow: 0 3px 10px rgba(0,0,0,.12); }
    .agent[data-tone='blue'] { --tone: #0066cc; }
    .agent[data-tone='green'] { --tone: #3e8635; }
    .agent[data-tone='red'] { --tone: #ee0000; }
    .agent[data-tone='amber'] { --tone: #f0ab00; }
    .down { color: #c9190b; }
    .a-name { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #6a6e73; font-weight: 600; }
    .agent strong { font-size: 1.1rem; }
    .a-text { font-size: .88rem; color: #4f5255; flex: 1; }
    .budgets { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1rem; }
  `,
})
export class HomePage {
  readonly bank = inject(BankService);
  readonly eur = eur;
  readonly eurShort = eurShort;
  readonly recent = signal<Transaction[]>([]);

  readonly firstName = computed(() => this.bank.user()?.name.split(' ')[0] ?? '');
  readonly demoMode = computed(() =>
    [this.bank.insights(), this.bank.taxTips(), this.bank.liquidity(), this.bank.fx()].some((r) => r?.source === 'demo'),
  );
  readonly lastMonth = computed(() => this.bank.overview()?.monthly.at(-1) ?? null);
  readonly taxSavingMax = computed(
    () => this.bank.taxTips()?.tips.reduce((s, t) => s + t.saving_max_eur, 0) ?? 0,
  );

  constructor() {
    this.bank.transactions(5).subscribe((p) => this.recent.set(p.items));
  }
}
