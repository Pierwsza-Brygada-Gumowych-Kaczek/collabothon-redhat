import { AfterViewInit, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BankService } from './bank.service';

const THEME_KEY = 'duckbank-theme';

function initialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements AfterViewInit {
  readonly bank = inject(BankService);
  /** Light / dark theme: saved per browser, defaults to the system setting. */
  readonly theme = signal<'light' | 'dark'>(initialTheme());

  private readonly applyTheme = effect(() => {
    const t = this.theme();
    document.documentElement.dataset['theme'] = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable (private mode) — theme still works for this visit */
    }
  });

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
  private readonly duck = viewChild.required<ElementRef<HTMLVideoElement>>('duck');

  readonly nav = [
    { path: '/', label: 'Overview', exact: true },
    { path: '/liquidity', label: 'Liquidity', exact: false },
    { path: '/investments', label: 'Investments', exact: false },
    { path: '/tax', label: 'Tax', exact: false },
    { path: '/fx', label: 'FX hedging', exact: false },
    { path: '/transactions', label: 'Transactions', exact: false },
    { path: '/analytics', label: 'Analytics', exact: false },
  ];

  ngAfterViewInit(): void {
    // Angular does not set the `muted` property from the template attribute, and browsers only
    // autoplay muted videos — so set it explicitly.
    const v = this.duck().nativeElement;
    v.muted = true;
    v.defaultMuted = true;
    const play = () => v.play().catch(() => undefined);
    play();
    // If the browser still blocks it (e.g. energy saver), start on the first user interaction.
    document.addEventListener('pointerdown', play, { once: true });
    document.addEventListener('keydown', play, { once: true });
  }
}
