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
            <strong>{{ eurShort(interest().min) }} – {{ eurShort(interest().max) }}</strong>
            <small>{{ pct(p.return_min_pct) }}–{{ pct(p.return_max_pct) }}% a year (indicative)</small>
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
            <strong>{{ gainText() }}</strong>
            <small>{{ pct(p.return_min_pct) }}–{{ pct(p.return_max_pct) }}% a year</small>
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
            At the end you could have about <b>{{ eurShort(pr.endMin) }}–{{ eurShort(pr.endMax) }}</b>.
          </p>
        }
      }
    </article>
  `,
  styles: `
    .proposal { border: 1px solid #e3e3e3; border-left: 5px solid var(--risk); border-radius: 12px;
      padding: 1.1rem 1.25rem; background: #fff; }
    .proposal[data-risk='low'] { --risk: #3e8635; --risk-bg: #f3faf2; }
    .proposal[data-risk='medium'] { --risk: #f0ab00; --risk-bg: #fdf7e7; }
    .proposal[data-risk='high'] { --risk: #c9190b; --risk-bg: #faeae8; }
    .proposal.financing { border-left-color: #0066cc; }
    h3 { font-size: 1.15rem; margin: .35rem 0 .9rem; }
    .chip { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6a6e73; }
    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; }
    .fact { background: #f7f7f7; border-radius: 10px; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .2rem; }
    .fact.gain { background: #f3faf2; }
    .fact.cost { background: #eef5fc; }
    .q { font-size: .75rem; color: #6a6e73; }
    .fact strong { font-size: 1.2rem; }
    .fact.gain strong { color: #3e8635; }
    .fact.cost strong { color: #0066cc; }
    small { font-size: .75rem; color: #4f5255; line-height: 1.3; }
    .meter { display: flex; align-items: center; gap: 3px; }
    .meter span { width: 18px; height: 8px; border-radius: 3px; background: #ddd; }
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
  readonly gainText = computed(() => {
    const { gainMin, gainMax } = this.proj();
    if (gainMax <= 0) return '€0';
    return `+${eurShort(gainMin)} – ${eurShort(gainMax)}`;
  });
}
