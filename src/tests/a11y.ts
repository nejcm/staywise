import { expect } from 'vitest';

function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 || (node as Element).getAttribute('aria-hidden') === 'true') return '';
  return [...node.childNodes].map(visibleText).join('');
}

// Every control is named by its own text (aria-label alone does not count) and every icon is hidden.
export function expectNamedControlsAndHiddenIcons(root: ParentNode) {
  const unnamed = [...root.querySelectorAll('a, button')]
    .filter((control) => !control.closest('dialog:not([open])'))
    .filter((control) => !visibleText(control).trim())
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
