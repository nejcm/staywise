import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guestThemes } from '../guide/guide-validation';

const css = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(source: string): { selector: string; tokens: Record<string, string> }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
    selector: selector.trim(),
    tokens: Object.fromEntries(
      [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value?.trim()]),
    ),
  }));
}

const root = blocks(css('../../styles.css')).find((block) => block.selector === ':root')?.tokens ?? {};
const themed = blocks(css('./themes.css'));

function tokensFor(theme: string): Record<string, string> {
  const own = themed.find((block) => block.selector.includes(`[data-theme='${theme}']`))?.tokens ?? {};
  return { ...root, ...own };
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`not a #rrggbb color: ${hex}`);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
    const channel = parseInt(match[1]!.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// Text pairs need 4.5:1; the input border is a non-text UI component and needs 3:1.
const pairs = [
  ['--text', '--ground', 4.5],
  ['--text', '--surface', 4.5],
  ['--muted', '--ground', 4.5],
  ['--muted', '--surface', 4.5],
  ['--accent-ink', '--accent-soft', 4.5],
  ['--on-accent', '--accent', 4.5],
  ['--link', '--surface', 4.5],
  ['--control', '--surface', 3],
] as const;

describe('guest themes', () => {
  it('defines a preset block for every non-default theme key', () => {
    const missing = guestThemes.filter(
      (key) => key !== 'staywise' && !themed.some((block) => block.selector.includes(`[data-theme='${key}']`)),
    );
    expect(missing).toEqual([]);
  });

  it.each(guestThemes)('%s meets WCAG AA contrast for text and input borders', (theme) => {
    const tokens = tokensFor(theme);
    const failing = pairs
      .map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, min, ratio: contrast(tokens[fg] ?? '', tokens[bg] ?? '') }))
      .filter(({ min, ratio }) => ratio < min);
    expect(failing).toEqual([]);
  });
});
