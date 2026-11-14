import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

type NotifType = 'success' | 'info' | 'warning' | 'error';
export interface NotificationOptions { duration?: number; closeable?: boolean; icon?: string; }

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private container: HTMLElement | null = null;
  private notifications: HTMLElement[] = [];
  private readonly doc = inject(DOCUMENT, { optional: true });

  show(type: NotifType, title: string, message: string, options?: NotificationOptions): void {
    const doc = this.doc;
    if (!doc?.body) return;
    this.ensureContainer(doc);
    this.ensureStyles(doc);

    const el = doc.createElement('article');
    el.className = `toast toast--${type}`;

    const icon = doc.createElement('i');
    icon.className = `toast__icon ${options?.icon ?? this.defaultIcon(type)}`;

    const content = doc.createElement('div');
    content.className = 'toast__content';
    const strong = doc.createElement('strong');
    strong.textContent = title;
    const para = doc.createElement('p');
    para.textContent = message;   // textContent : les messages d'erreur du serveur ne sont jamais interprétés comme du HTML
    content.append(strong, para);

    el.append(icon, content);

    if (options?.closeable !== false) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'toast__close';
      btn.setAttribute('aria-label', 'Fermer');
      btn.innerHTML = '&times;';
      btn.addEventListener('click', () => this.remove(el));
      el.appendChild(btn);
    }

    this.container?.appendChild(el);
    this.notifications.push(el);

    const duration = options?.duration ?? 5000;
    if (duration > 0) window.setTimeout(() => this.remove(el), duration);
  }

  success(title: string, message: string, options?: NotificationOptions): void { this.show('success', title, message, options); }
  error(title: string, message: string, options?: NotificationOptions): void { this.show('error', title, message, options); }
  info(title: string, message: string, options?: NotificationOptions): void { this.show('info', title, message, options); }
  warning(title: string, message: string, options?: NotificationOptions): void { this.show('warning', title, message, options); }

  private remove(el: HTMLElement): void {
    this.notifications = this.notifications.filter(n => n !== el);
    el.remove();
  }

  private ensureContainer(doc: Document): void {
    if (this.container?.isConnected) return;
    const c = doc.createElement('div');
    c.className = 'toast-container';
    doc.body.appendChild(c);
    this.container = c;
  }

  private ensureStyles(doc: Document): void {
    if (doc.getElementById('toast-styles')) return;
    const style = doc.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      .toast-container{position:fixed;top:1rem;right:1rem;z-index:9200;display:flex;flex-direction:column;gap:.75rem;width:min(24rem,calc(100vw - 2rem))}
      .toast{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:.75rem;padding:.9rem 1rem;border-radius:var(--radius-lg,.75rem);border:1px solid var(--color-border,#d9dce3);background:var(--color-background,#fff);box-shadow:0 14px 30px rgba(0,0,0,.14)}
      .toast--success{border-left:4px solid var(--color-success,#16a34a)}
      .toast--info{border-left:4px solid var(--color-info,#2563eb)}
      .toast--warning{border-left:4px solid var(--color-warning,#f59e0b)}
      .toast--error{border-left:4px solid var(--color-error,#ef4444)}
      .toast__icon{margin-top:.1rem;color:var(--color-primary,#2563eb)}
      .toast--success .toast__icon{color:var(--color-success,#16a34a)}
      .toast--error .toast__icon{color:var(--color-error,#ef4444)}
      .toast--warning .toast__icon{color:var(--color-warning,#f59e0b)}
      .toast__content strong{display:block;margin-bottom:.2rem;color:var(--color-text,#111827)}
      .toast__content p{margin:0;color:var(--color-text-muted,#4b5563)}
      .toast__close{border:none;background:transparent;color:var(--color-text-muted,#6b7280);cursor:pointer;font-size:1.1rem;line-height:1;padding:0}
    `;
    doc.head.appendChild(style);
  }

  private defaultIcon(type: NotifType): string {
    return { success: 'fa-solid fa-circle-check', warning: 'fa-solid fa-triangle-exclamation', error: 'fa-solid fa-circle-xmark', info: 'fa-solid fa-circle-info' }[type];
  }
}
