import { AfterViewInit, Component, ElementRef, inject, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BankService } from './bank.service';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements AfterViewInit {
  readonly bank = inject(BankService);
  private readonly router = inject(Router);

  logout(): void {
    this.bank.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }

  private readonly themes = inject(ThemeService);
  readonly theme = this.themes.theme;

  toggleTheme(): void {
    this.themes.toggle();
  }

  private readonly duck = viewChild.required<ElementRef<HTMLVideoElement>>('duck');

  readonly nav = [
    { path: '/', label: 'Overview', exact: true },
    { path: '/analytics', label: 'Analytics', exact: false },
    { path: '/transactions', label: 'Transactions', exact: false },
    { path: '/allocation', label: 'Allocation', exact: false },
    { path: '/liquidity', label: 'Liquidity', exact: false },
    { path: '/tax', label: 'Tax', exact: false },
    { path: '/investments', label: 'Investments', exact: false },
    { path: '/fx', label: 'FX hedging', exact: false },
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
