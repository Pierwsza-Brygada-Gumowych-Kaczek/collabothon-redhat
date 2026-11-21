import { Component, inject, signal } from '@angular/core';
import { BankService, Goal } from './bank.service';
import { goalColor } from './colors';
import { GoalFormComponent } from './goal-form.component';
import { GoalTileComponent } from './goal-tile.component';

/** The "Goals" block: tiles plus add / edit / delete. Used on Overview and Allocation. */
@Component({
  selector: 'app-goals-section',
  standalone: true,
  imports: [GoalFormComponent, GoalTileComponent],
  template: `
    <section>
      <div class="section-head">
        <h2>Goals</h2>
        <span class="muted">save up for something — the AI shows ways to get there</span>
      </div>
      @if (adding()) {
        <app-goal-form (saved)="onSaved()" (cancel)="adding.set(false)" />
      }
      @if (editing(); as eg) {
        <app-goal-form [goal]="eg" (saved)="onSaved()" (cancel)="editing.set(null)" />
      }
      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
      <div class="grid">
        @for (g of bank.goals(); track g.id; let i = $index) {
          <app-goal-tile [goal]="g" [color]="color(i)" (remove)="remove($event)" (edit)="startEdit($event)" />
        }
        @if (!adding()) {
          <button type="button" class="add-tile" (click)="startAdd()">
            <span class="plus">+</span>
            <span>Add goal</span>
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1rem; }
    app-goal-form { display: block; margin-bottom: 1rem; }
    .add-tile { min-height: 260px; border-radius: 14px; border: 2px dashed var(--border-2); background: transparent;
      color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4rem;
      font-weight: 600; }
    .add-tile:hover { border-color: var(--blue); color: var(--blue); background: var(--blue-bg); }
    .plus { font-size: 2.4rem; line-height: 1; font-weight: 300; }
    .err { color: var(--red); margin: 0 0 .6rem; }
  `,
})
export class GoalsSectionComponent {
  readonly bank = inject(BankService);
  readonly color = goalColor;
  readonly adding = signal(false);
  readonly editing = signal<Goal | null>(null);
  readonly error = signal<string | null>(null);

  startAdd(): void {
    this.editing.set(null);
    this.adding.set(true);
  }

  startEdit(g: Goal): void {
    this.adding.set(false);
    this.editing.set(g);
  }

  onSaved(): void {
    this.adding.set(false);
    this.editing.set(null);
    this.bank.loadGoals();
  }

  remove(g: Goal): void {
    if (!confirm(`Delete the goal "${g.name}"?`)) return;
    this.error.set(null);
    this.bank.deleteGoal(g.id).subscribe({
      next: () => this.bank.goals.update((list) => list.filter((x) => x.id !== g.id)),
      error: () => this.error.set(`Could not delete "${g.name}". Please try again.`),
    });
  }
}
