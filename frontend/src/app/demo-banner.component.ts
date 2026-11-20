import { Component } from '@angular/core';

/** Shown above agent results while the AI model is not connected and demo content is used. */
@Component({
  selector: 'app-demo-banner',
  standalone: true,
  template: `
    <div class="demo" role="note">
      <span class="tag">DEMO</span>
      <span>
        The AI model is not connected yet. These recommendations are <b>demo content</b> generated
        by rules from your real account figures — they will be replaced by the AI agent once OpenShift AI is connected.
      </span>
    </div>
  `,
  styles: `
    .demo { display: flex; gap: .7rem; align-items: flex-start; background: #fdf7e7; border: 1px solid #f4d48b;
      border-radius: 10px; padding: .7rem .9rem; font-size: .88rem; line-height: 1.45; color: #5c3a00; margin-bottom: 1rem; }
    .tag { background: #f0ab00; color: #151515; font-weight: 800; font-size: .7rem; letter-spacing: .06em;
      border-radius: 4px; padding: .15rem .4rem; flex-shrink: 0; margin-top: .1rem; }
  `,
})
export class DemoBannerComponent {}
