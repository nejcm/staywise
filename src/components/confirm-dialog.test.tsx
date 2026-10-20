import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useConfirmDialog } from './confirm-dialog';

function Host() {
  return useConfirmDialog().dialog;
}

describe('useConfirmDialog', () => {
  it('server-renders a closed, labelled dialog with real buttons', () => {
    const html = renderToString(<Host />);

    expect(html).toMatch(/^<dialog [^>]*aria-labelledby="([^"]+)"[^>]*>.*<h2 id="\1">/);
    expect(html).not.toMatch(/<dialog[^>]* open/);
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
  });
});
