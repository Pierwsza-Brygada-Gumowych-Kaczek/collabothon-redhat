import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Budget, BudgetOptions, BankService } from './bank.service';
import { BUDGET_PHOTOS } from './budget-tile.component';
import { eurShort } from './format';

/** Longest side of an uploaded picture; larger images are scaled down in the browser. */
const MAX_SIDE = 900;

/** Form for adding or editing a monthly budget: name, description, what to track, limit and a picture. */
@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="card form" (ngSubmit)="save()" #f="ngForm">
      <div class="head">
        <h2>{{ editing() ? 'Edit budget' : 'New budget' }}</h2>
        <button type="button" class="x" (click)="cancel.emit()" aria-label="Close">×</button>
      </div>

      <label class="field">
        <span>Name</span>
        <input name="name" [(ngModel)]="name" required maxlength="60" placeholder="e.g. Staff wages" autocomplete="off" />
      </label>

      <label class="field">
        <span>Description (optional)</span>
        <input name="description" [(ngModel)]="description" maxlength="120" placeholder="Shown under the budget" autocomplete="off" />
      </label>

      <div class="field">
        <span>What should it track?</span>
        <div class="seg" role="group">
          <button type="button" [class.on]="kind() === 'category'" (click)="setKind('category')">Category</button>
          <button type="button" [class.on]="kind() === 'merchant'" (click)="setKind('merchant')">Merchant</button>
        </div>
        @if (options(); as o) {
          @if (kind() === 'category') {
            <select name="target" [(ngModel)]="target" required>
              <option value="" disabled>Choose a category…</option>
              @for (opt of o.categories; track opt.value) {
                <option [value]="opt.value">{{ opt.value }} · ~{{ eurShort(opt.suggested_limit) }}/month</option>
              }
            </select>
          } @else {
            <input name="target" [(ngModel)]="target" required list="merchant-list" autocomplete="off"
                   placeholder="Merchant name; separate several with commas" />
            <datalist id="merchant-list">
              @for (opt of o.merchants; track opt.value) {
                <option [value]="opt.value">~{{ eurShort(opt.suggested_limit) }}/month</option>
              }
            </datalist>
          }
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
          @if (isUpload()) {
            <button type="button" class="ph on" [style.background-image]="'url(' + photo() + ')'" aria-label="Your picture"></button>
          }
          <label class="ph upload" title="Upload your own picture">
            + Upload
            <input type="file" accept="image/*" hidden (change)="onFile($event)" />
          </label>
        </div>
      </div>

      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <div class="actions">
        <button type="button" class="secondary" (click)="cancel.emit()">Cancel</button>
        <button type="submit" [disabled]="saving() || !name.trim() || !target.trim()">
          {{ saving() ? 'Saving…' : editing() ? 'Save changes' : 'Add budget' }}
        </button>
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
    .ph.none, .ph.upload { background: var(--surface-3); color: var(--muted); font-size: .8rem; display: grid;
      place-items: center; cursor: pointer; }
    .ph.on { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); }
    .err { color: var(--red); margin: 0; font-size: .9rem; }
    .actions { display: flex; justify-content: flex-end; gap: .6rem; }
  `,
})
export class BudgetFormComponent {
  private readonly bank = inject(BankService);
  /** When set, the form edits this budget instead of creating a new one. */
  readonly budget = input<Budget | null>(null);
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
  readonly editing = computed(() => this.budget() !== null);
  readonly isUpload = computed(() => (this.photo() ?? '').startsWith('data:'));
  name = '';
  description = '';
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

  ngOnInit(): void {
    const b = this.budget();
    if (!b) return;
    this.name = b.name;
    this.description = b.description;
    this.limit = b.custom_limit ? b.limit : null;
    this.photo.set(b.photo);
    if (b.category) {
      this.kind.set('category');
      this.target = b.category;
    } else {
      this.kind.set('merchant');
      this.target = b.merchants.join(', ');
    }
  }

  setKind(k: 'category' | 'merchant'): void {
    this.kind.set(k);
    this.target = '';
    this.targetSig.set('');
  }

  ngDoCheck(): void {
    if (this.targetSig() !== this.target) this.targetSig.set(this.target);
  }

  /** Reads the chosen image, scales it down and keeps it as a JPEG/PNG data URL. */
  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error.set('Please choose an image file.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      this.error.set(null);
      this.photo.set(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.error.set('Could not read that image.');
    };
    img.src = url;
  }

  save(): void {
    const target = this.target.trim();
    if (!this.name.trim() || !target) return;
    this.saving.set(true);
    this.error.set(null);
    const isCat = this.kind() === 'category';
    const merchants = isCat ? [] : target.split(',').map((m) => m.trim()).filter(Boolean);
    const body = {
      name: this.name.trim(),
      description: this.description.trim() || (isCat ? `Category: ${target}` : merchants.join(', ')),
      category: isCat ? target : null,
      merchants,
      limit: this.limit && this.limit > 0 ? this.limit : null,
      photo: this.photo(),
    };
    const b = this.budget();
    (b ? this.bank.updateBudget(b.id, body) : this.bank.addBudget(body)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.detail?.toString?.() ?? 'Could not save the budget.');
      },
    });
  }
}
