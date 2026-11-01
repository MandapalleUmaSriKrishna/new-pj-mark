/**
 * Six-box OTP input.
 *
 * Accessible behaviour:
 *  - Each box is a labelled input ("Digit 1 of 6") inside a labelled group.
 *  - The first box carries autocomplete="one-time-code" so iOS/Android can
 *    offer the SMS code; multi-character autofill is distributed across boxes.
 *  - Paste anywhere fills the remaining boxes.
 *  - Arrow keys, Home/End, Backspace and Delete behave as expected.
 *  - Completion is announced through a polite live region.
 */
export class OtpInput {
  constructor(container, { length = 6, onComplete, onChange, announcer } = {}) {
    this.container = container;
    this.inputs = Array.from(container.querySelectorAll('input'));
    this.length = length || this.inputs.length;
    this.onComplete = onComplete;
    this.onChange = onChange;
    this.announcer = announcer;
    this.inputs.forEach((input, index) => this.bind(input, index));
  }

  get value() {
    return this.inputs.map((input) => input.value).join('');
  }

  get isComplete() {
    return this.value.length === this.length;
  }

  bind(input, index) {
    input.addEventListener('input', (event) => {
      const digits = input.value.replace(/\D/g, '');
      if (digits.length === 0) {
        input.value = '';
        this.syncState();
        return;
      }
      if (digits.length === 1) {
        input.value = digits;
        if (index < this.length - 1) this.focusIndex(index + 1);
        this.syncState();
        return;
      }
      // Autofill or fast typing can drop several characters at once.
      this.distribute(digits, index, event);
    });

    input.addEventListener('keydown', (event) => {
      const { key } = event;
      if (key === 'Backspace') {
        if (input.value) {
          input.value = '';
          this.syncState();
          event.preventDefault();
          return;
        }
        if (index > 0) {
          event.preventDefault();
          const previous = this.inputs[index - 1];
          previous.value = '';
          this.focusIndex(index - 1);
          this.syncState();
        }
        return;
      }
      if (key === 'Delete') {
        input.value = '';
        this.syncState();
        event.preventDefault();
        return;
      }
      if (key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        this.focusIndex(index - 1);
        return;
      }
      if (key === 'ArrowRight' && index < this.length - 1) {
        event.preventDefault();
        this.focusIndex(index + 1);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        this.focusIndex(0);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        this.focusIndex(this.length - 1);
        return;
      }
      // Typing a digit while a box is already filled replaces it.
      if (/^\d$/.test(key) && input.value) {
        input.value = '';
      }
    });

    input.addEventListener('paste', (event) => {
      const text = (event.clipboardData ?? window.clipboardData)?.getData('text') ?? '';
      const digits = text.replace(/\D/g, '');
      if (!digits) return;
      event.preventDefault();
      this.distribute(digits, index, event);
    });

    input.addEventListener('focus', () => input.select());
  }

  distribute(rawDigits, startIndex, event) {
    const digits = rawDigits.slice(0, this.length - startIndex);
    digits.split('').forEach((digit, offset) => {
      const box = this.inputs[startIndex + offset];
      if (box) box.value = digit;
    });
    const nextIndex = Math.min(startIndex + digits.length, this.length - 1);
    this.focusIndex(nextIndex, { select: true });
    this.syncState();
    if (event?.type === 'input') event.target.value = this.inputs[startIndex].value;
  }

  focusIndex(index, { select = false } = {}) {
    const input = this.inputs[Math.max(0, Math.min(index, this.length - 1))];
    if (!input) return;
    input.focus({ preventScroll: false });
    if (select) input.select();
  }

  focus() {
    const firstEmpty = this.inputs.find((input) => !input.value) ?? this.inputs[0];
    firstEmpty?.focus();
    firstEmpty?.select();
  }

  clear({ focus = false } = {}) {
    for (const input of this.inputs) input.value = '';
    this.setError(false);
    // A programmatic clear must not notify listeners: the caller may have just
    // set an inline error and would otherwise wipe it immediately.
    this.syncState({ silent: true, notify: false });
    if (focus) this.focus();
  }

  setError(isError) {
    this.container.classList.toggle('is-error', Boolean(isError));
    for (const input of this.inputs) {
      input.setAttribute('aria-invalid', isError ? 'true' : 'false');
    }
  }

  setDisabled(disabled) {
    for (const input of this.inputs) input.disabled = Boolean(disabled);
  }

  syncState({ silent = false, notify = true } = {}) {
    for (const input of this.inputs) {
      input.classList.toggle('is-filled', Boolean(input.value));
    }
    if (notify) this.onChange?.(this.value);
    if (this.isComplete && !this.wasComplete) {
      this.announce('Code complete. Six digits entered.');
      this.onComplete?.(this.value);
    } else if (!this.isComplete && !silent) {
      this.announce(`${this.value.length} of ${this.length} digits entered.`);
    }
    this.wasComplete = this.isComplete;
  }

  announce(message) {
    if (this.announcer) this.announcer.textContent = message;
  }
}
