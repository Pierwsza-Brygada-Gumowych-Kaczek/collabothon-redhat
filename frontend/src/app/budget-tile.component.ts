import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Budget } from './bank.service';
import { eurShort, plural } from './format';

// Local photos in public/budgets/ (downloaded from Unsplash, Unsplash licence — free to use).
// Sources: photo-1582284540020-8acbe03f4924, photo-1578911373434-0cb395d2cbfb,
//         photo-1573621622238-f7ac6ac0429a, photo-1767713362918-d6db856570ba
const PHOTOS: Record<string, string> = {
  food: '/budgets/food.jpg',
  beverages: '/budgets/beverages.jpg',
  utilities: '/budgets/utilities.jpg',
  rent: '/budgets/rent.jpg',
};

@Component({
  selector: 'app-budget-tile',
  standalone: true,
  imports: [DatePipe],
  template: `
    @let b = budget();
    <article class="tile" [class.over]="b.remaining < 0" [class.warn]="state() === 'warn'">
      <div class="photo" [style.background-image]="'url(' + photo() + ')'">
        <span class="name">{{ b.name }}</span>
      </div>
      <div class="body">
        <div class="left">
          @if (b.remaining >= 0) {
            <span class="label">Left to spend</span>
            <strong>{{ eurShort(b.remaining) }}</strong>
          } @else {
            <span class="label">Over budget by</span>
            <strong>{{ eurShort(-b.remaining) }}</strong>
          }
        </div>
        <div class="bar" role="progressbar" [attr.aria-valuenow]="b.spent" aria-valuemin="0" [attr.aria-valuemax]="b.limit">
          <div class="fill" [style.width.%]="pct()"></div>
        </div>
        <div class="scale">
          <span>€0</span>
          <span>spent {{ eurShort(b.spent) }}</span>
          <span>{{ eurShort(b.limit) }}</span>
        </div>
        <div class="reset">
          ↻ Budget resets in <b>{{ b.reset_in_days }} {{ dni() }}</b> ({{ b.reset_date | date: 'd MMM' }})
        </div>
      </div>
    </article>
  `,
  styles: `
    .tile { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1);
      display: flex; flex-direction: column; --bar: #3e8635; }
    .tile.warn { --bar: #f0ab00; }
    .tile.over { --bar: #c9190b; }
    .photo { height: 120px; background-size: cover; background-position: center; position: relative; background-color: #ddd; }
    .photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 35%, rgba(0,0,0,.65)); }
    .name { position: absolute; left: .9rem; bottom: .6rem; z-index: 1; color: #fff; font-weight: 700; font-size: 1.05rem; }
    .body { padding: .85rem .9rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
    .left { display: flex; flex-direction: column; }
    .label { font-size: .78rem; color: #6a6e73; }
    .left strong { font-size: 1.6rem; color: var(--bar); line-height: 1.15; }
    .bar { height: 10px; background: #ececec; border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: var(--bar); border-radius: 999px; transition: width .6s; }
    .scale { display: flex; justify-content: space-between; font-size: .72rem; color: #6a6e73; }
    .reset { font-size: .82rem; color: #4f5255; border-top: 1px solid #f0f0f0; padding-top: .55rem; }
  `,
})
export class BudgetTileComponent {
  readonly budget = input.required<Budget>();
  readonly eurShort = eurShort;

  readonly photo = computed(() => PHOTOS[this.budget().id] ?? '');
  readonly pct = computed(() => {
    const b = this.budget();
    return b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
  });
  readonly state = computed(() => (this.pct() >= 85 ? 'warn' : 'ok'));
  readonly dni = computed(() => plural(this.budget().reset_in_days, 'day', 'days'));
}
