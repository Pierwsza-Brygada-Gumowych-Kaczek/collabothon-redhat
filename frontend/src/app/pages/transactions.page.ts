import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BankService, Transaction } from '../bank.service';
import { eur } from '../format';

const PAGE = 25;

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [DatePipe],
  template: `
    <h1 class="page-title">Transactions</h1>
    <p class="page-lead">All transactions on the business account, newest first.</p>

    <section class="card">
      <div class="filters">
        <label>
          Show:
          <select [value]="category()" (change)="setCategory($any($event.target).value)">
            <option value="">All categories</option>
            @for (c of categories(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </label>
        <span class="muted">{{ total() }} transactions</span>
      </div>

      <table class="tx">
        <tbody>
          @for (t of items(); track $index) {
            <tr>
              <td class="date">{{ t.date | date: 'd MMM yy' }}</td>
              <td>
                <div class="cp">{{ t.counterparty }}</div>
                <small class="muted">{{ t.category }} · {{ t.reference }}</small>
              </td>
              <td class="amt" [class.pos]="t.amount > 0" [class.neg]="t.amount < 0">
                {{ eur(t.amount_eur) }}
                @if (t.currency !== 'EUR') {
                  <small class="muted orig">{{ t.amount }} {{ t.currency }}</small>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>

      <div class="pager">
        <button class="secondary" (click)="go(page() - 1)" [disabled]="page() === 0">← Newer</button>
        <span class="muted">Page {{ page() + 1 }} of {{ pages() }}</span>
        <button class="secondary" (click)="go(page() + 1)" [disabled]="page() + 1 >= pages()">Older →</button>
      </div>
    </section>
  `,
  styles: `
    .filters { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: .5rem; flex-wrap: wrap; }
    select { margin-left: .4rem; padding: .4rem .5rem; border-radius: 6px; border: 1px solid #c7c7c7; font: inherit; }
    .orig { display: block; }
    .pager { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; }
  `,
})
export class TransactionsPage {
  private readonly bank = inject(BankService);
  readonly eur = eur;

  readonly items = signal<Transaction[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly category = signal('');
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE)));
  readonly categories = computed(() =>
    (this.bank.overview()?.categories ?? []).map((c) => c.name).sort((a, b) => a.localeCompare(b, 'en')),
  );

  constructor() {
    this.load();
  }

  setCategory(c: string): void {
    this.category.set(c);
    this.go(0);
  }

  go(p: number): void {
    this.page.set(p);
    this.load();
  }

  private load(): void {
    this.bank.transactions(PAGE, this.page() * PAGE, this.category()).subscribe((res) => {
      this.items.set(res.items);
      this.total.set(res.total);
    });
  }
}
