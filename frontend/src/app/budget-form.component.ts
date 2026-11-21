import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Budget, BudgetOptions, BankService } from './bank.service';
import { BUDGET_PHOTOS } from './budget-tile.component';
import { eurShort } from './format';

/** Form for adding a monthly budget: name, what to track, limit (optional) and a photo. */
@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="card form" (ngSubmit)="save()" #f="ngForm">
      <div class="head">
        <h2>New budget</h2>
        <button type="button" class="x" (click)="cancel.emit()" aria-label="Close">×</button>
      </div>

      <label class="field">
        <span>Name</span>
        <input name="name" [(ngModel)]="name" required maxlength="60" placeholder="e.g. Staff wages" autocomplete="off" />
      </label>

      <div class="field">
        <span>What should it track?</span>
        <div class="seg" role="group">
          <button type="button" [class.on]="kind() === 'category'" (click)="setKind('category')">Category</button>
          <button type="button" [class.on]="kind() === 'merchant'" (click)="setKind('merchant')">Merchant</button>
        </div>
        @if (options(); as o) {
          <select name="target" [(ngModel)]="target" required>
            <option value="" disabled>Choose {{ kind() === 'category' ? 'a category' : 'a merchant' }}…</option>
            @for (opt of kind() === 'category' ? o.categories : o.merchants; track opt.value) {
              <option [value]="opt.value">{{ opt.value }} · ~{{ eurShort(opt.suggested_limit) }}/month</option>
            }
          </select>
        } @else {
          <span class="muted">Loading options…</span>
        }
      </div>

      <label class="field">
        <span>Monthly limit (€)</span>
        <input name="limit" type="number" min="1" step="50" [(ngModel)]="limit"
               [placeholder]="suggested() ? 'Suggested: ' + suggested() : 'Leave empty to use a suggestion'" />
        <small class="muted">Leave empty to use the suggestion: last year's average spending + 10%.</small>
      </label>

      <div class="field">
        <span>Picture</span>
        <div class="photos">
          <button type="button" class="ph none" [class.on]="!photo()" (click)="photo.set(null)">None</button>
          @for (p of photoIds; track p) {
            <button type="button" class="ph" [class.on]="photo() === p" (click)="photo.set(p)"
                    [style.background-image]="'url(' + photos[p] + ')'" [attr.aria-label]="'Picture ' + p"></button>
          }
        </div>
      </div>

      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <div class="actions">
        <button type="button" class="secondary" (click)="cancel.emit()">Cancel</button>
        <button type="submit" [disabled]="saving() || !name.trim() || !target">{{ saving() ? 'Saving…' : 'Add budget' }}</button>
      </div>
    </form>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: .9rem; border: 2px solid var(--blue); }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .head h2 { margin: 0; }
    .x { background: none; color: var(--muted); font-size: 1.4rem; padding: 0 .3rem; }
    .field { display: flex; flex-direction: column; gap: .35rem; }
    .field > span { font-size: .85rem; font-weight: 600; }
    input, select { padding: .5rem .6rem; border: 1px solid var(--border-2); border-radius: 6px; font: inherit; }
    .seg { display: inline-flex; align-self: flex-start; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; }
    .seg button { background: var(--surface); color: var(--text); border-radius: 0; padding: .35rem .8rem; font-size: .85rem; }
    .seg button.on { background: var(--btn-bg); color: var(--btn-fg); }
    .photos { display: flex; gap: .5rem; flex-wrap: wrap; }
    .ph { width: 64px; height: 44px; padding: 0; border-radius: 8px; background-size: cover; background-position: center;
      border: 2px solid transparent; }
    .ph.none { background: var(--surface-3); color: var(--muted); font-size: .8rem; }
    .ph.on { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); }
    .err { color: var(--red); margin: 0; font-size: .9rem; }
    .actions { display: flex; justify-content: flex-end; gap: .6rem; }
  `,
})
export class BudgetFormComponent {
  private readonly bank = inject(BankService);
  readonly saved = output<Budget>();
  readonly cancel = output<void>();

  readonly eurShort = eurShort;
  readonly photos = BUDGET_PHOTOS;
  readonly photoIds = Object.keys(BUDGET_PHOTOS);

  readonly options = signal<BudgetOptions | null>(null);
  readonly kind = signal<'category' | 'merchant'>('category');
  readonly photo = signal<string | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  name = '';
  target = '';
  limit: number | null = null;

  readonly suggested = computed(() => {
    const o = this.options();
    if (!o) return null;
    const list = this.kind() === 'category' ? o.categories : o.merchants;
    return list.find((x) => x.value === this.targetSig())?.suggested_limit ?? null;
  });
  // ngModel writes `target` directly; mirror it into a signal for the suggestion.
  private readonly targetSig = signal('');

  constructor() {
    this.bank.budgetOptions().subscribe({
      next: (o) => this.options.set(o),
      error: () => this.error.set('Could not load the list of categories and merchants.'),
    });
  }

  setKind(k: 'category' | 'merchant'): void {
    this.kind.set(k);
    this.target = '';
    this.targetSig.set('');
  }

  ngDoCheck(): void {
    if (this.targetSig() !== this.target) this.targetSig.set(this.target);
  }

  save(): void {
    if (!this.name.trim() || !this.target) return;
    this.saving.set(true);
    this.error.set(null);
    const isCat = this.kind() === 'category';
    this.bank
      .addBudget({
        name: this.name.trim(),
        description: isCat ? `Category: ${this.target}` : this.target,
        category: isCat ? this.target : null,
        merchants: isCat ? [] : [this.target],
        limit: this.limit && this.limit > 0 ? this.limit : null,
        photo: this.photo(),
      })
      .subscribe({
        next: (b) => {
          this.saving.set(false);
          this.saved.emit(b);
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(e?.error?.detail ?? 'Could not save the budget.');
        },
      });
  }
}
