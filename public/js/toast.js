/** Accessible toast notifications (announced through the live region). */
import { h, icon, ICONS } from './dom.js';

const VARIANTS = {
  success: { icon: ICONS.check, role: 'status', duration: 5000 },
  error: { icon: ICONS.alert, role: 'alert', duration: 9000 },
  info: { icon: ICONS.info, role: 'status', duration: 6000 },
};

export class ToastManager {
  constructor(region, { max = 4 } = {}) {
    this.region = region;
    this.max = max;
    this.timers = new WeakMap();
  }

  success(title, message = '') {
    return this.show({ variant: 'success', title, message });
  }

  error(title, message = '') {
    return this.show({ variant: 'error', title, message });
  }

  info(title, message = '') {
    return this.show({ variant: 'info', title, message });
  }

  show({ variant = 'info', title, message = '', duration }) {
    if (!this.region) return null;
    const config = VARIANTS[variant] ?? VARIANTS.info;

    while (this.region.children.length >= this.max) {
      this.dismiss(this.region.firstElementChild);
    }

    const toast = h('div', `toast toast--${variant}`);
    toast.setAttribute('role', config.role);
    if (variant === 'error') toast.setAttribute('aria-live', 'assertive');

    const iconWrap = h('span', 'toast__icon');
    iconWrap.appendChild(icon(config.icon));
    toast.appendChild(iconWrap);

    const body = h('div', 'toast__body');
    body.appendChild(h('p', 'toast__title', title));
    if (message) body.appendChild(h('p', 'toast__message', message));
    toast.appendChild(body);

    const close = h('button', 'toast__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.appendChild(icon(ICONS.close));
    close.addEventListener('click', () => this.dismiss(toast));
    toast.appendChild(close);

    const start = () => {
      this.stopTimer(toast);
      const ms = duration ?? config.duration;
      if (ms > 0) {
        this.timers.set(
          toast,
          setTimeout(() => this.dismiss(toast), ms),
        );
      }
    };
    const pause = () => this.stopTimer(toast);

    toast.addEventListener('pointerenter', pause);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('pointerleave', start);
    toast.addEventListener('focusout', (event) => {
      if (!toast.contains(event.relatedTarget)) start();
    });

    this.region.appendChild(toast);
    start();
    return toast;
  }

  stopTimer(toast) {
    const timer = this.timers.get(toast);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(toast);
    }
  }

  dismiss(toast) {
    if (!toast || !toast.isConnected) return;
    this.stopTimer(toast);
    toast.classList.add('is-leaving');
    const remove = () => toast.remove();
    toast.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 350);
  }

  clear() {
    for (const toast of Array.from(this.region?.children ?? [])) this.dismiss(toast);
  }
}
