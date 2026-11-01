/**
 * Searchable country selector following the ARIA combobox/listbox pattern.
 * Keyboard: Arrow keys move, Enter selects, Escape closes, typing filters.
 */
import { flagEmoji, h } from './dom.js';

export class CountryPicker {
  constructor({ trigger, panel, search, list, empty, hiddenInput, flagEl, nameEl, dialEl, countries, onChange }) {
    this.trigger = trigger;
    this.panel = panel;
    this.search = search;
    this.list = list;
    this.empty = empty;
    this.hiddenInput = hiddenInput;
    this.flagEl = flagEl;
    this.nameEl = nameEl;
    this.dialEl = dialEl;
    this.countries = countries;
    this.onChange = onChange;
    this.open = false;
    this.activeIndex = 0;
    this.filtered = countries.slice();

    this.bind();
    this.select(countries[0]?.iso, { close: false });
  }

  get selected() {
    return this.countries.find((country) => country.iso === this.hiddenInput.value) ?? this.countries[0];
  }

  bind() {
    this.trigger.addEventListener('click', () => {
      if (this.open) this.close({ focusTrigger: true });
      else this.openPanel();
    });

    this.trigger.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.openPanel();
      }
    });

    this.search.addEventListener('input', () => {
      this.applyFilter(this.search.value);
    });

    this.search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveActive(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveActive(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        this.setActive(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        this.setActive(this.filtered.length - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const option = this.filtered[this.activeIndex];
        if (option) this.select(option.iso);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close({ focusTrigger: true });
      } else if (event.key === 'Tab') {
        this.close();
      }
    });

    this.list.addEventListener('click', (event) => {
      const option = event.target.closest('[role="option"]');
      if (option?.dataset.iso) this.select(option.dataset.iso);
    });

    this.list.addEventListener('mousemove', (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      const index = this.filtered.findIndex((country) => country.iso === option.dataset.iso);
      if (index !== -1 && index !== this.activeIndex) this.setActive(index, { scroll: false });
    });

    this.onDocumentPointerDown = (event) => {
      if (!this.open) return;
      if (this.panel.contains(event.target) || this.trigger.contains(event.target)) return;
      this.close();
    };
    document.addEventListener('pointerdown', this.onDocumentPointerDown);
  }

  openPanel() {
    if (this.open) return;
    this.open = true;
    this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.applyFilter('');
    const selectedIndex = this.filtered.findIndex((country) => country.iso === this.selected?.iso);
    this.setActive(selectedIndex >= 0 ? selectedIndex : 0);
    this.search.focus({ preventScroll: true });
  }

  close({ focusTrigger = false } = {}) {
    if (!this.open) return;
    this.open = false;
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.search.setAttribute('aria-activedescendant', '');
    if (focusTrigger) this.trigger.focus();
  }

  applyFilter(query) {
    const needle = String(query ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\+/, '');
    this.filtered = needle
      ? this.countries.filter((country) => {
          const digits = country.dialCode.replace('+', '');
          return (
            country.name.toLowerCase().includes(needle) ||
            country.iso.toLowerCase().includes(needle) ||
            digits.startsWith(needle) ||
            digits === needle
          );
        })
      : this.countries.slice();

    this.renderOptions();
    this.empty.hidden = this.filtered.length > 0;
    this.setActive(0, { scroll: false });
  }

  renderOptions() {
    const fragment = document.createDocumentFragment();
    this.filtered.forEach((country, index) => {
      const option = h('li', 'country__option');
      option.id = `country-option-${country.iso}`;
      option.setAttribute('role', 'option');
      option.dataset.iso = country.iso;
      option.setAttribute('aria-selected', country.iso === this.selected?.iso ? 'true' : 'false');
      option.dataset.index = String(index);
      option.appendChild(h('span', 'country__option-flag', flagEmoji(country.iso)));
      option.appendChild(h('span', 'country__option-name', country.name));
      option.appendChild(h('span', 'country__option-dial', country.dialCode));
      fragment.appendChild(option);
    });
    this.list.replaceChildren(fragment);
  }

  moveActive(delta) {
    if (this.filtered.length === 0) return;
    const next = (this.activeIndex + delta + this.filtered.length) % this.filtered.length;
    this.setActive(next);
  }

  setActive(index, { scroll = true } = {}) {
    if (this.filtered.length === 0) {
      this.search.setAttribute('aria-activedescendant', '');
      return;
    }
    this.activeIndex = Math.max(0, Math.min(index, this.filtered.length - 1));
    const options = Array.from(this.list.children);
    options.forEach((option, optionIndex) => {
      option.classList.toggle('is-active', optionIndex === this.activeIndex);
    });
    const active = options[this.activeIndex];
    if (active) {
      this.search.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    }
  }

  select(iso, { close = true } = {}) {
    const country = this.countries.find((entry) => entry.iso === iso) ?? this.countries[0];
    if (!country) return;
    this.hiddenInput.value = country.iso;
    this.flagEl.textContent = flagEmoji(country.iso);
    this.nameEl.textContent = country.name;
    this.dialEl.textContent = country.dialCode;
    this.renderOptions();
    this.onChange?.(country);
    if (close) this.close({ focusTrigger: true });
  }
}
