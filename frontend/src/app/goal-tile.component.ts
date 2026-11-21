import { Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Goal } from './bank.service';
import { duration, eurShort } from './format';
import { goalIcon } from './goal-icons';
import { FREQUENCY_LABEL } from './goal-form.component';

const BLUE: Rgb = [0, 102, 204];
const YELLOW: Rgb = [240, 171, 0];
const GREEN: Rgb = [62, 134, 53];

type Rgb = [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

/** Blue at the start, yellow around the middle, green when the goal is reached. */
export function progressColor(percent: number): string {
  const p = Math.min(Math.max(percent, 0), 100);
  return p < 50 ? mix(BLUE, YELLOW, p / 50) : mix(YELLOW, GREEN, (p - 50) / 50);
}

/** A savings goal: progress towards the target and the chosen way to reach it. */
@Component({
  selector: 'app-goal-tile',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @let g = goal();
    <article class="tile" [style.border-top]="color() ? '5px solid ' + color() : null" [class.done]="g.remaining <= 0" [style.--bar]="progressColor()">
      <div class="photo" [class.plain]="!photo()" [class.themed]="!photo() && icon()"
           [style.background-image]="photo() ? 'url(' + photo() + ')' : null"
           [style.--hue]="hue()" [style.--icon-color]="icon()?.color ?? null">
        @if (icon(); as ic) {
          @if (photo()) {
            <span class="badge" [style.background]="ic.color" [title]="ic.label">
              <lucide-icon [img]="ic.icon" [size]="18" color="#fff" [strokeWidth]="2.2"></lucide-icon>
            </span>
          } @else {
            <span class="big-icon"><lucide-icon [img]="ic.icon" [size]="56" color="rgba(255,255,255,.92)" [strokeWidth]="1.6"></lucide-icon></span>
          }
        } @else if (!photo()) {
          <span class="initial">🎯</span>
        }
        <span class="name">{{ g.name }}</span>
        <button class="edit" type="button" (click)="edit.emit(g)" [attr.aria-label]="'Edit goal ' + g.name"
                title="Edit goal">✎</button>
        <button class="del" type="button" (click)="remove.emit(g)" [attr.aria-label]="'Delete goal ' + g.name"
                title="Delete goal">×</button>
      </div>
      <div class="body">
        <div class="left">
          @if (g.remaining > 0) {
            <span class="label">Still to save</span>
            <strong>{{ eurShort(g.remaining) }}</strong>
          } @else {
            <span class="label">Goal reached</span>
            <strong>🎉 {{ eurShort(g.target) }}</strong>
          }
        </div>
        <div class="bar" role="progressbar" [attr.aria-valuenow]="g.saved" aria-valuemin="0" [attr.aria-valuemax]="g.target">
          <div class="fill" [style.width.%]="g.percent"></div>
        </div>
        <div class="scale">
          <span>saved {{ eurShort(g.saved) }}</span>
          <span>{{ g.percent }}%</span>
          <span>{{ eurShort(g.target) }}</span>
        </div>
        @if (g.way; as w) {
          <div class="way">
            <b>{{ w.title }}</b>
            <div class="stats">
              <span><small>You pay</small><strong>{{ eurShort(w.amount_eur) }}</strong><small>{{ freq[w.frequency] }}</small></span>
              @if (w.months) {
                <span><small>Time to goal</small><strong>{{ duration(w.months) }}</strong></span>
              }
            </div>
          </div>
        } @else {
          <button type="button" class="pick" (click)="edit.emit(g)">Choose a way to reach it →</button>
        }
      </div>
    </article>
  `,
  styles: `
    .tile { background: var(--surface); border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px var(--shadow-strong);
      display: flex; flex-direction: column; --bar: #0066cc; }
    .photo { height: 120px; background-size: cover; background-position: center; position: relative; background-color: var(--track); }
    .photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 35%, rgba(0,0,0,.65)); }
    .photo.themed { background: linear-gradient(135deg, var(--icon-color), color-mix(in srgb, var(--icon-color) 55%, #000)); }
    .big-icon { position: absolute; inset: 0; display: grid; place-items: center; padding-bottom: 1.2rem; }
    .badge { position: absolute; top: .55rem; left: .6rem; z-index: 2; width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
    .photo.plain { background: linear-gradient(135deg, hsl(var(--hue) 55% 42%), hsl(calc(var(--hue) + 40) 60% 30%)); }
    .initial { position: absolute; inset: 0; display: grid; place-items: center; font-size: 3rem; opacity: .35; }
    .name { position: absolute; left: .9rem; bottom: .6rem; z-index: 1; color: #fff; font-weight: 700; font-size: 1.05rem; }
    .edit, .del { position: absolute; top: .5rem; z-index: 2; width: 28px; height: 28px; padding: 0; border-radius: 50%;
      background: rgba(0, 0, 0, .55); color: #fff; line-height: 1; display: grid; place-items: center;
      opacity: 0; transition: opacity .15s; }
    .del { right: .5rem; font-size: 1.1rem; }
    .edit { right: 2.6rem; font-size: 1rem; }
    .tile:hover .edit, .tile:hover .del, .edit:focus-visible, .del:focus-visible { opacity: 1; }
    .del:hover { background: #c9190b; }
    .edit:hover { background: var(--blue); }
    @media (hover: none) { .edit, .del { opacity: 1; } }
    .body { padding: .85rem .9rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
    .left { display: flex; flex-direction: column; }
    .label { font-size: .78rem; color: var(--muted); }
    .left strong { font-size: 1.6rem; color: var(--bar); line-height: 1.15; }
    .bar { height: 10px; background: var(--surface-3); border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: var(--bar); border-radius: 999px; transition: width .6s, background-color .6s; }
    .scale { display: flex; justify-content: space-between; font-size: .72rem; color: var(--muted); }
    .way { display: flex; flex-direction: column; font-size: .82rem; color: var(--text-2);
      border-top: 1px solid var(--surface-3); padding-top: .55rem; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; margin-top: .3rem; }
    .stats span { display: flex; flex-direction: column; background: var(--surface-3); border-radius: 8px; padding: .35rem .5rem; }
    .stats small { font-size: .68rem; color: var(--muted); }
    .stats strong { font-size: 1.05rem; color: var(--blue); line-height: 1.2; }
    .pick { background: none; color: var(--blue); text-align: left; padding: .55rem 0 0; font-size: .85rem;
      border-top: 1px solid var(--surface-3); border-radius: 0; }
  `,
})
export class GoalTileComponent {
  readonly goal = input.required<Goal>();
  /** Colour that links this tile to its slice on the allocation chart. */
  readonly color = input<string | null>(null);
  readonly remove = output<Goal>();
  readonly edit = output<Goal>();

  readonly eurShort = eurShort;
  readonly duration = duration;
  readonly freq = FREQUENCY_LABEL;

  readonly photo = computed(() => {
    const p = this.goal().photo;
    return p?.startsWith('data:image/') ? p : '';
  });
  readonly progressColor = computed(() => progressColor(this.goal().percent));
  readonly icon = computed(() => goalIcon(this.goal().icon));
  readonly hue = computed(() => [...this.goal().id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
}
