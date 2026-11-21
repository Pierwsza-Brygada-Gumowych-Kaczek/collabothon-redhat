import { Component, computed, input } from '@angular/core';
import { InvestmentProposal } from './bank.service';
import { RISK_INFO, duration, eurShort, loanInterest, loanPayment, pct, projection } from './format';

@Component({
  selector: 'app-proposal-card',
  standalone: true,
  template: `
    @let p = proposal();
    @let r = risk();
    @let pr = proj();
    <article class="proposal" [attr.data-risk]="p.risk" [class.financing]="isLoan()">
      <header>
        <span class="chip">{{ p.category }}</span>
        <h3>{{ p.title }}</h3>
      </header>

      @if (isLoan()) {
        <div class="facts">
          <div class="fact">
            <span class="q">Loan amount</span>
            <strong>{{ eurShort(p.amount_eur) }}</strong>
            <small>paid out once for the purchase</small>
          </div>
          <div class="fact">
            <span class="q">Repayment period</span>
            <strong>{{ duration(p.horizon_months) }}</strong>
            <small>≈ {{ eurShort(monthly()) }} per month</small>
          </div>
          <div class="fact cost">
            <span class="q">Total interest cost</span>
            <strong><span class="upto">up to</span> {{ eurShort(interest().max) }}</strong>
            <small>up to {{ pct(p.return_max_pct) }}% a year (indicative)</small>
          </div>
          <div class="fact">
            <span class="q">Risk</span>
            <div class="meter"><span [class.on]="true"></span><span [class.on]="r.level > 1"></span><span [class.on]="r.level > 2"></span><b>{{ r.label }}</b></div>
            <small>Fixed instalments — you always know what you pay.</small>
          </div>
        </div>
      } @else {
        <div class="facts">
          <div class="fact">
            <span class="q">You invest</span>
            <strong>{{ eurShort(p.amount_eur) }}</strong>
            <small>{{ p.contribution === 'monthly' ? 'every month' : 'one-off' }}</small>
          </div>
          <div class="fact">
            <span class="q">For how long</span>
            <strong>{{ duration(p.horizon_months) }}</strong>
            @if (p.contribution === 'monthly') {
              <small>{{ eurShort(pr.paidIn) }} paid in total</small>
            }
          </div>
          <div class="fact gain">
            <span class="q">You could earn</span>
            @if (proj().gainMax > 0) {
              <strong><span class="upto">up to</span> +{{ eurShort(proj().gainMax) }}</strong>
            } @else {
              <strong>€0</strong>
            }
            <small>up to {{ pct(p.return_max_pct) }}% a year</small>
          </div>
          <div class="fact">
            <span class="q">Risk</span>
            <div class="meter" [attr.aria-label]="'Risk ' + r.label">
              @for (i of [1, 2, 3]; track i) {
                <span [class.on]="i <= r.level"></span>
              }
              <b>{{ r.label }}</b>
            </div>
            <small>{{ r.text }}</small>
          </div>
        </div>
      }

      @if (!compact()) {
        <div class="explain">
          <p><b>What is it?</b> {{ p.plain_explanation }}</p>
          <p><b>Why for you?</b> {{ p.rationale }}</p>
        </div>
        @if (!isLoan()) {
          <p class="end">
            At the end you could have up to <b>{{ eurShort(pr.endMax) }}</b>.
          </p>
        }
      }
    </article>
  `,
  styles: `
    .proposal { border: 1px solid var(--border); border-left: 5px solid var(--risk); border-radius: 12px;
      padding: 1.1rem 1.25rem; background: var(--surface); }
    .proposal[data-risk='low'] { --risk: var(--green); --risk-bg: var(--green-bg); }
    .proposal[data-risk='medium'] { --risk: #f0ab00; --risk-bg: var(--amber-bg); }
    .proposal[data-risk='high'] { --risk: var(--red); --risk-bg: var(--red-bg); }
    .proposal.financing { border-left-color: var(--blue); }
    h3 { font-size: 1.15rem; margin: .35rem 0 .9rem; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; }
    .fact { background: var(--surface-2); border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .fact.gain { background: var(--green-bg); }
    .fact.cost { background: var(--blue-bg); }
    .q { font-size: .75rem; color: var(--muted); }
    .fact strong { font-size: 1.2rem; }
    .fact.gain strong { color: var(--green); }
    .fact.cost strong { color: var(--blue); }
    small { font-size: .75rem; color: var(--text-2); line-height: 1.3; }
    .upto { font-size: .75rem; font-weight: 500; color: var(--muted); margin-right: .15rem; }
    .meter { display: flex; align-items: center; gap: 3px; }
    .meter span { width: 18px; height: 8px; border-radius: 3px; background: var(--track); }
    .meter span.on { background: var(--risk); }
    .meter b { margin-left: .4rem; font-size: 1.05rem; }
    .explain { margin-top: .9rem; font-size: .9rem; line-height: 1.45; }
    .explain p { margin: .3rem 0; }
    .end { background: var(--risk-bg); border-radius: 8px; padding: .55rem .8rem; margin: .6rem 0 0; font-size: .9rem; }
    @media (max-width: 800px) { .facts { grid-template-columns: 1fr 1fr; } }
  `,
})
export class ProposalCardComponent {
  readonly proposal = input.required<InvestmentProposal>();
  readonly compact = input(false);

  readonly eurShort = eurShort;
  readonly pct = pct;
  readonly duration = duration;

  readonly isLoan = computed(() => this.proposal().kind === 'financing');
  readonly risk = computed(() => RISK_INFO[this.proposal().risk]);
  readonly proj = computed(() => projection(this.proposal()));
  readonly interest = computed(() => {
    const p = this.proposal();
    return {
      min: loanInterest(p.amount_eur, p.horizon_months, p.return_min_pct),
      max: loanInterest(p.amount_eur, p.horizon_months, p.return_max_pct),
    };
  });
  readonly monthly = computed(() => {
    const p = this.proposal();
    return loanPayment(p.amount_eur, p.horizon_months, (p.return_min_pct + p.return_max_pct) / 2);
  });
}
