import { Component, input, output } from '@angular/core';

/** Shown instead of AI recommendations when the OpenShift AI model could not be used. */
@Component({
  selector: 'app-agent-error',
  standalone: true,
  template: `
    <section class="ai-error" role="alert">
      <div class="icon">!</div>
      <div class="body">
        <h2>{{ agent() }} is unavailable</h2>
        <p>The AI model could not be reached, so no AI recommendations are shown.{{ hasFacts() ? ' Figures calculated directly from your account data are still shown on this page.' : '' }}</p>
        <p class="detail"><b>Reason:</b> {{ error() }}</p>
        <button (click)="retry.emit()" [disabled]="loading()">{{ loading() ? 'Trying…' : 'Try again' }}</button>
      </div>
    </section>
  `,
  styles: `
    .ai-error { display: flex; gap: 1rem; background: var(--red-bg); border: 1px solid var(--red-border); border-left: 5px solid var(--red);
      border-radius: 12px; padding: 1rem 1.25rem; }
    .icon { width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; background: var(--red); color: var(--bg);
      display: grid; place-items: center; font-weight: 800; }
    h2 { color: var(--red-text); font-size: 1.1rem; margin: .2rem 0 .4rem; }
    p { margin: .3rem 0; line-height: 1.5; }
    .detail { font-size: .85rem; color: var(--red-text); word-break: break-word; }
    button { margin-top: .5rem; }
  `,
})
export class AgentErrorComponent {
  readonly agent = input.required<string>();
  readonly error = input.required<string>();
  readonly hasFacts = input(false);
  readonly loading = input(false);
  readonly retry = output<void>();
}
