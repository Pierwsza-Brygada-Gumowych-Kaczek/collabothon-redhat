import { Component, computed, inject } from '@angular/core';
import { BankService } from '../bank.service';
import { ProposalCardComponent } from '../proposal-card.component';
import { AgentSourceComponent } from '../agent-source.component';
import { AgentErrorComponent } from '../agent-error.component';
import { DemoBannerComponent } from '../demo-banner.component';
import { RISK_INFO, eurShort } from '../format';

@Component({
  selector: 'app-investments-page',
  standalone: true,
  imports: [ProposalCardComponent, AgentSourceComponent, AgentErrorComponent, DemoBannerComponent],
  template: `
    <div class="head">
      <div>
        <h1 class="page-title">Investment agent</h1>
        <p class="page-lead">
          The agent looked at a full year of money coming in and going out and suggests what to do with
          spare cash — and how to pay for new equipment without draining your account. Safest first.
        </p>
      </div>
      <button class="secondary" (click)="bank.loadInsights(true)" [disabled]="bank.insightsLoading()">
        {{ bank.insightsLoading() ? 'Analysing…' : 'Run analysis again' }}
      </button>
    </div>

    @if (bank.insights(); as ins) {
      @if (ins.source === 'demo') { <app-demo-banner /> }
      @if (ins.source === 'unavailable') {
        <app-agent-error agent="The investment agent" [error]="ins.error ?? ''" [loading]="bank.insightsLoading()" (retry)="bank.loadInsights(true)" />
      } @else {
      <div class="stack">
        <section class="card summary">
          <h2>In short</h2>
          <p>{{ ins.summary }}</p>
          <div class="totals">
            <div><span class="muted">Invest now</span><strong>{{ eurShort(totals().oneOff) }}</strong></div>
            @if (totals().monthly > 0) {
              <div><span class="muted">Save every month</span><strong>{{ eurShort(totals().monthly) }}</strong></div>
            }
            @if (totals().financing > 0) {
              <div><span class="muted">Equipment financing</span><strong>{{ eurShort(totals().financing) }}</strong></div>
            }
          </div>
        </section>

        <details class="card howto">
          <summary>How to read the proposals</summary>
          <ul>
            <li><b>You invest</b> — the amount you move from your business account (one-off or every month).</li>
            <li><b>For how long</b> — when it is best to take the money out again.</li>
            <li><b>You could earn</b> — an estimate in euros at the end. Not a guarantee.</li>
            <li><b>Capex financing</b> (blue cards) — the bank lends you money for equipment; you see the total interest cost.</li>
            @for (r of risks; track r.label) {
              <li><b>{{ r.label }} risk</b> — {{ r.text }}</li>
            }
          </ul>
        </details>

        @for (p of ins.proposals; track $index) {
          <app-proposal-card [proposal]="p" />
        }

        @if (ins.warnings.length) {
          <section class="card warn">
            <h2>Watch out for</h2>
            <ul>
              @for (w of ins.warnings; track $index) {
                <li>{{ w }}</li>
              }
            </ul>
          </section>
        }
        <app-agent-source [meta]="ins" disclaimer="Prototype — not investment advice. Talk to an adviser before deciding." />
      </div>
      }
    } @else {
      <p class="muted">The investment agent is analysing your account…</p>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    .head button { flex-shrink: 0; margin-top: .25rem; }
    .summary { border-top: 4px solid var(--green); }
    .summary p { line-height: 1.55; font-size: 1.02rem; margin-top: 0; }
    .totals { display: flex; flex-wrap: wrap; gap: 2rem; }
    .totals div { display: flex; flex-direction: column; }
    .totals strong { font-size: 1.3rem; }
    .howto summary { cursor: pointer; font-weight: 600; }
    .howto ul { margin: .75rem 0 0; padding-left: 1.2rem; line-height: 1.6; font-size: .92rem; }
    .warn { background: var(--amber-bg); }
    .warn ul { margin: 0; padding-left: 1.2rem; line-height: 1.6; color: var(--amber-text); }
    @media (max-width: 700px) { .head { flex-direction: column; } }
  `,
})
export class InvestmentsPage {
  readonly bank = inject(BankService);
  readonly eurShort = eurShort;
  readonly risks = Object.values(RISK_INFO);

  readonly totals = computed(() => {
    const ps = this.bank.insights()?.proposals ?? [];
    const sum = (f: (p: (typeof ps)[number]) => boolean) => ps.filter(f).reduce((s, p) => s + p.amount_eur, 0);
    return {
      oneOff: sum((p) => p.kind === 'investment' && p.contribution === 'one-off'),
      monthly: sum((p) => p.kind === 'investment' && p.contribution === 'monthly'),
      financing: sum((p) => p.kind === 'financing'),
    };
  });
}
