import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService, Message } from './chat.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly chat = inject(ChatService);

  readonly messages = signal<Message[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  input = '';

  send(): void {
    const text = this.input.trim();
    if (!text || this.loading()) return;

    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.input = '';
    this.loading.set(true);
    this.error.set(null);

    this.chat.send(this.messages()).subscribe({
      next: (res) => {
        this.messages.update((m) => [...m, res.message]);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Nie udało się połączyć z modelem.');
        this.loading.set(false);
      },
    });
  }
}
