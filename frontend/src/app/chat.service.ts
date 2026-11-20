import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  message: Message;
  model: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  // Ścieżka względna: w dev przez proxy.conf.json, w klastrze przez nginx -> backend.
  send(messages: Message[]): Observable<ChatResponse> {
    return this.http.post<ChatResponse>('/api/chat', { messages });
  }
}
