import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BankService } from '../bank.service';
import { eur } from '../format';
import { ThemeService } from '../theme.service';

/** Profile, account details, preferences, AI connection and security — opened from the user in the top bar. */
@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    @if (bank.user(); as u) {
      <h1 class="page-title">Account &amp; settings</h1>
      <p class="page-lead">Your profile, bank account details and how the app looks and behaves.</p>

      <div class="stack">
        <section class="card who">
          <div class="avatar">{{ u.initials }}</div>
          <div>
            <h2>{{ u.name }}</h2>
            <div class="muted">{{ u.business }} · {{ u.segment }}</div>
            <div class="muted">{{ u.email }} · signed in as <b>{{ u.username }}</b></div>
          </div>
        </section>

        <section class="card">
          <h2>Profile</h2>
          <form class="form" (ngSubmit)="saveProfile()">
            <label class="field"><span>Name</span>
              <input name="name" [(ngModel)]="name" required maxlength="120" autocomplete="name" /></label>
            <label class="field"><span>Business</span>
              <input name="business" [(ngModel)]="business" maxlength="120" autocomplete="organization" /></label>
            <label class="field wide"><span>E-mail</span>
              <input name="email" type="email" [(ngModel)]="email" maxlength="200" autocomplete="email" /></label>
            <div class="actions wide">
              @if (profileMsg(); as m) {
                <span [class.ok]="m.ok" [class.err]="!m.ok">{{ m.text }}</span>
              }
              <button type="submit" [disabled]="savingProfile() || !name.trim() || !profileChanged()">
                {{ savingProfile() ? 'Saving…' : 'Save profile' }}
              </button>
            </div>
          </form>
        </section>

        @if (bank.overview(); as o) {
          <section class="card">
            <h2>Bank account</h2>
            <dl class="facts">
              <div><dt>IBAN</dt><dd class="mono">{{ o.account_iban }}</dd></div>
              <div><dt>Currency</dt><dd>{{ o.currency }}</dd></div>
              <div><dt>Current balance</dt><dd>{{ eur(o.balance) }}</dd></div>
              <div><dt>Opening balance</dt><dd>{{ eur(o.opening_balance) }}</dd></div>
              <div><dt>Statement period</dt><dd>{{ o.period_from | date: 'd MMM yyyy' }} – {{ o.period_to | date: 'd MMM yyyy' }}</dd></div>
              <div><dt>Segment</dt><dd>{{ u.segment }}</dd></div>
            </dl>
          </section>
        }

        <section class="card">
          <h2>Appearance</h2>
          <div class="row">
            <span>Theme</span>
            <div class="pills" role="group" aria-label="Theme">
              <button type="button" class="pill-toggle" [class.on]="themes.theme() === 'light'"
                      [attr.aria-pressed]="themes.theme() === 'light'" (click)="themes.set('light')">☀ Light</button>
              <button type="button" class="pill-toggle" [class.on]="themes.theme() === 'dark'"
                      [attr.aria-pressed]="themes.theme() === 'dark'" (click)="themes.set('dark')">☾ Dark</button>
            </div>
          </div>
          <small class="muted">Saved in this browser.</small>
        </section>

        <section class="card">
          <div class="section-head">
            <h2>AI connection</h2>
            <button type="button" class="secondary small" (click)="bank.loadAiStatus()">Check again</button>
          </div>
          @if (bank.aiStatus(); as s) {
            <dl class="facts">
              <div><dt>Status</dt>
                <dd [class.pos]="aiOk()" [class.neg]="!aiOk() && !s.demo_fallback">
                  {{ aiOk() ? 'Connected' : s.demo_fallback ? 'Demo mode — AI not connected' : 'Offline' }}</dd></div>
              <div><dt>Model</dt><dd>{{ s.model }}</dd></div>
              <div class="wide"><dt>Endpoint</dt><dd class="mono">{{ s.url }}</dd></div>
              @if (s.available_models.length) {
                <div class="wide"><dt>Models served there</dt><dd>{{ s.available_models.join(', ') }}</dd></div>
              }
            </dl>
            @if (s.error) {
              <p class="note">{{ s.error }}</p>
            }
          } @else {
            <p class="muted">Checking…</p>
          }
        </section>

        <section class="card">
          <h2>Security</h2>
          <form class="form" (ngSubmit)="changePassword()">
            <label class="field"><span>Current password</span>
              <input name="current" type="password" [(ngModel)]="current" autocomplete="current-password" /></label>
            <label class="field"><span>New password (at least 8 characters)</span>
              <input name="next" type="password" [(ngModel)]="next" minlength="8" autocomplete="new-password" /></label>
            <div class="actions wide">
              @if (passwordMsg(); as m) {
                <span [class.ok]="m.ok" [class.err]="!m.ok">{{ m.text }}</span>
              }
              <button type="submit" [disabled]="changing() || !current || next.length < 8">
                {{ changing() ? 'Changing…' : 'Change password' }}
              </button>
            </div>
          </form>
          <hr />
          <div class="row">
            <span>Sign out of this browser</span>
            <button type="button" class="secondary" (click)="logout()">Sign out</button>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .who { display: flex; align-items: center; gap: 1.2rem; }
    .who h2 { margin: 0 0 .2rem; }
    .avatar { width: 64px; height: 64px; border-radius: 50%; background: #ee0000; color: #fff; font-size: 1.5rem;
      font-weight: 700; display: grid; place-items: center; flex: none; }
    .form { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: .9rem; margin-top: .6rem; }
    .field { display: flex; flex-direction: column; gap: .35rem; }
    .field > span { font-size: .85rem; font-weight: 600; }
    .wide { grid-column: 1 / -1; }
    input { padding: .5rem .6rem; border: 1px solid var(--border-2); border-radius: 6px; font: inherit; }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: .8rem; }
    .ok { color: var(--green); font-size: .88rem; }
    .err { color: var(--red); font-size: .88rem; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .9rem 1.5rem; margin: .8rem 0 0; }
    .facts div { display: flex; flex-direction: column; gap: .15rem; }
    .facts dt { font-size: .78rem; color: var(--muted); }
    .facts dd { margin: 0; font-weight: 600; word-break: break-all; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: .9rem; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin: .6rem 0; }
    .pills { display: flex; gap: .5rem; }
    .small { font-size: .8rem; padding: .3rem .7rem; }
    .note { margin: .8rem 0 0; font-size: .85rem; color: var(--text-2); line-height: 1.5; }
    hr { border: 0; border-top: 1px solid var(--border); margin: 1.2rem 0 .6rem; }
  `,
})
export class AccountPage {
  readonly bank = inject(BankService);
  readonly themes = inject(ThemeService);
  private readonly router = inject(Router);
  readonly eur = eur;

  name = this.bank.user()?.name ?? '';
  business = this.bank.user()?.business ?? '';
  email = this.bank.user()?.email ?? '';
  current = '';
  next = '';

  readonly savingProfile = signal(false);
  readonly changing = signal(false);
  readonly profileMsg = signal<{ ok: boolean; text: string } | null>(null);
  readonly passwordMsg = signal<{ ok: boolean; text: string } | null>(null);

  readonly aiOk = computed(() => {
    const s = this.bank.aiStatus();
    return !!s && s.reachable && s.model_found;
  });

  profileChanged(): boolean {
    const u = this.bank.user();
    return !!u && (u.name !== this.name.trim() || u.business !== this.business.trim() || u.email !== this.email.trim());
  }

  saveProfile(): void {
    this.savingProfile.set(true);
    this.profileMsg.set(null);
    this.bank.updateProfile({ name: this.name.trim(), business: this.business.trim(), email: this.email.trim() }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.profileMsg.set({ ok: true, text: 'Saved.' });
      },
      error: (e) => {
        this.savingProfile.set(false);
        this.profileMsg.set({ ok: false, text: e?.error?.detail?.toString?.() ?? 'Could not save your profile.' });
      },
    });
  }

  changePassword(): void {
    this.changing.set(true);
    this.passwordMsg.set(null);
    this.bank.changePassword(this.current, this.next).subscribe({
      next: () => {
        this.changing.set(false);
        this.current = '';
        this.next = '';
        this.passwordMsg.set({ ok: true, text: 'Password changed.' });
      },
      error: (e) => {
        this.changing.set(false);
        this.passwordMsg.set({ ok: false, text: e?.error?.detail?.toString?.() ?? 'Could not change the password.' });
      },
    });
  }

  logout(): void {
    const go = () => this.router.navigate(['/login']);
    this.bank.logout().subscribe({ next: go, error: go });
  }
}
