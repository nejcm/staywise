import { expect } from 'vitest';

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 || isHidden(node as Element) || (node as Element).getAttribute('aria-hidden') === 'true') {
    return '';
  }
  return [...node.childNodes].map(visibleText).join('');
}

// The accessible-name precedence for controls: aria-labelledby, then aria-label, then content.
function accessibleName(control: Element): string {
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    return labelledBy
      .split(/\s+/)
      .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  return (control.getAttribute('aria-label') ?? '').trim() || visibleText(control).trim();
}

// Every control has a non-empty accessible name from its visible text or aria-label, and every icon is hidden.
export function expectNamedControlsAndHiddenIcons(root: ParentNode) {
  const unnamed = [...root.querySelectorAll('a, button')]
    .filter((control) => !control.closest('dialog:not([open])'))
    .filter(
      (control) =>
        !accessibleName(control) || (!visibleText(control).trim() && !control.getAttribute('aria-label')?.trim()),
    )
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
