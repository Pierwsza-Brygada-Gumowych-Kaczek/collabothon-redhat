import { Component, computed, inject } from '@angular/core';
import { AllocationChartComponent, Pot } from '../allocation-chart.component';
import { BankService } from '../bank.service';
import { categoryColor, FREE_COLOR, goalColor } from '../colors';
import { GoalsSectionComponent } from '../goals-section.component';

/** Where the money goes: goals, spending by category (from the bank statement) and free cash. */
@Component({
  selector: 'app-allocation-page',
  standalone: true,
  imports: [AllocationChartComponent, GoalsSectionComponent],
  template: `
    <h1 class="page-title">Allocation</h1>
    <p class="page-lead">How your money is divided between goals, what you spend per category and free cash. The chart updates as soon as you change a goal.</p>

    @if (bank.overview()) {
      <div class="stack">
        <section class="card">
          <div class="head">
            <h2>Right now</h2>
            <span class="muted">
              goals = saved so far · spending = {{ month() }} by category, from your bank statement · free = balance not set aside for goals
            </span>
          </div>
          <app-allocation-chart [pots]="pots()" [balance]="balance()" [expenseTitle]="'Spending in ' + month()" label="Total" />
        </section>

        <app-goals-section />
      </div>
    } @else if (!bank.error()) {
      <p class="muted">Loading account…</p>
    }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .head h2 { margin: 0; }
  `,
})
export class AllocationPage {
  readonly bank = inject(BankService);

  readonly balance = computed(() => this.bank.overview()?.balance ?? 0);
  readonly month = computed(() => this.bank.overview()?.monthly.at(-1)?.label ?? 'this month');

  /** Goals: saved so far. Spending: category totals of the latest statement month. Free: balance minus goals. */
  readonly pots = computed<Pot[]>(() => {
    const goals: Pot[] = this.bank.goals().map((g, i) => ({
      key: `g:${g.id}`, kind: 'goal', name: g.name, amount: Math.max(g.saved, 0), color: goalColor(i),
    }));
    const spending: Pot[] = (this.bank.overview()?.month_categories ?? []).map((c, i) => ({
      key: `c:${c.name}`, kind: 'expense', name: c.name, amount: c.amount, color: categoryColor(i),
    }));
    const saved = goals.reduce((s, p) => s + p.amount, 0);
    const free: Pot = { key: 'free', kind: 'free', name: 'Free to use', amount: Math.max(this.balance() - saved, 0), color: FREE_COLOR };
    return [...goals, ...spending, free];
  });
}
