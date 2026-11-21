import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BankService } from '../bank.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <form class="card login" (ngSubmit)="submit()">
        <video class="duck" src="/duck.mp4" autoplay loop muted playsinline aria-hidden="true" [muted]="true"></video>
        <h1>Sign in to Duck CFO</h1>
        <p class="muted">Business banking with your AI CFO.</p>

        @if (expired) {
          <p class="note">Your session has ended. Please sign in again.</p>
        }

        <label>
          <span>Username</span>
          <input name="username" [(ngModel)]="username" autocomplete="username" required autofocus />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required />
        </label>

        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        }
        <button type="submit" [disabled]="busy() || !username || !password">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>

        <div class="demo">
          <span>Demo account</span>
          <code>demo</code> / <code>demo</code>
          <button type="button" class="secondary" (click)="useDemo()">Use demo account</button>
        </div>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: calc(100vh - 160px); display: grid; place-items: center; padding: 2rem 0; }
    .login { width: min(380px, 100%); display: flex; flex-direction: column; gap: .9rem; padding: 2rem; }
    .duck { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; align-self: center; border: 3px solid #f5c242; }
    h1 { font-size: 1.35rem; margin: 0; text-align: center; }
    .login > .muted { text-align: center; margin: -.4rem 0 .2rem; }
    label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; font-weight: 600; }
    input { padding: .6rem .7rem; border: 1px solid var(--border-2); border-radius: 6px; font: inherit; font-weight: 400; }
    button[type='submit'] { padding: .7rem; }
    .err { color: var(--red); margin: 0; font-size: .9rem; }
    .note { background: var(--amber-bg); color: var(--amber-text); border-radius: 8px; padding: .5rem .7rem; margin: 0; font-size: .88rem; }
    .demo { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; font-size: .85rem; color: var(--muted);
      border-top: 1px solid var(--border); padding-top: .9rem; }
    .demo span { flex-basis: 100%; font-weight: 600; color: var(--text-2); }
    code { background: var(--surface-3); color: var(--text); padding: .1rem .4rem; border-radius: 4px; }
    .demo button { margin-left: auto; padding: .35rem .7rem; font-size: .8rem; }
  `,
})
export class LoginPage {
  private readonly bank = inject(BankService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  username = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly expired = this.route.snapshot.queryParamMap.has('expired');

  useDemo(): void {
    this.username = 'demo';
    this.password = 'demo';
    this.submit();
  }

  submit(): void {
    if (!this.username || !this.password || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.bank.login(this.username, this.password).subscribe({
      next: () => {
        this.busy.set(false);
        const next = this.route.snapshot.queryParamMap.get('next');
        this.router.navigateByUrl(next && next.startsWith('/') ? next : '/');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(e?.status === 401 ? 'Wrong username or password.' : 'Could not reach the server. Please try again.');
      },
    });
  }
}
