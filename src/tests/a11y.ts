import { expect } from 'vitest';

export function expectNamedControlsAndHiddenIcons(root: ParentNode) {
  const unnamed = [...root.querySelectorAll('a, button')]
    .filter((control) => !control.closest('dialog:not([open])'))
    .filter((control) => !(control.getAttribute('aria-label') ?? control.textContent ?? '').trim())
    .map((control) => control.outerHTML);
  expect(unnamed).toEqual([]);
  const exposed = [...root.querySelectorAll('svg:not([role="img"])')]
    .filter(
      (icon) =>
        icon.getAttribute('aria-hidden') !== 'true' ||
        (icon.classList.contains('lucide') && icon.getAttribute('focusable') !== 'false'),
    )
    .map((icon) => icon.outerHTML);
  expect(exposed).toEqual([]);
}
