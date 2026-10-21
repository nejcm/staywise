import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { expectNamedControlsAndHiddenIcons } from './a11y';

const icon = '<svg class="lucide" aria-hidden="true" focusable="false"></svg>';

function check(html: string) {
  const { document } = new Window();
  document.body.innerHTML = html;
  return () => expectNamedControlsAndHiddenIcons(document.body as unknown as ParentNode);
}

describe('expectNamedControlsAndHiddenIcons', () => {
  it('accepts controls named by their own text beside a hidden icon', () => {
    expect(check(`<button>${icon}Move up</button><a href="/x">${icon}Call</a>`)).not.toThrow();
  });

  it('rejects an icon-only button named only by aria-label', () => {
    expect(check(`<button aria-label="Move up">${icon}</button>`)).toThrow();
  });

  it('rejects a link whose only text is inside an aria-hidden subtree', () => {
    expect(check('<a href="/x"><span aria-hidden="true">Call</span></a>')).toThrow();
  });

  it('rejects an exposed or focusable icon', () => {
    expect(check('<button><svg class="lucide" focusable="false"></svg>Save</button>')).toThrow();
    expect(check('<button><svg class="lucide" aria-hidden="true"></svg>Save</button>')).toThrow();
  });
});
