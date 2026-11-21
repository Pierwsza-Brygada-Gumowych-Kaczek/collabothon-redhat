import { effect, Injectable, signal } from '@angular/core';

const THEME_KEY = 'duckbank-theme';

export type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light / dark theme: saved per browser, defaults to the system setting. Shared by the header and the settings page. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(initialTheme());

  private readonly apply = effect(() => {
    const t = this.theme();
    document.documentElement.dataset['theme'] = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable (private mode) — theme still works for this visit */
    }
  });

  set(t: Theme): void {
    this.theme.set(t);
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
