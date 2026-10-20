// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, buttonClass } from './button';
import { Field } from './field';
import { Mark } from './mark';
import { Pill } from './pill';
import { Toast } from './toast';

afterEach(cleanup);

describe('shared components', () => {
  it('Button forwards props and fires clicks unless disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Button type="button" onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button type="submit" disabled onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('submit');
  });

  it('buttonClass differs per variant', () => {
    expect(buttonClass('danger')).not.toBe(buttonClass('primary'));
    expect(buttonClass()).toBe(buttonClass('secondary'));
  });

  it('Field labels its control and announces errors only when present', () => {
    const { rerender } = render(
      <Field label="Email">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(
      <Field label="Email" error="Invalid" errorId="e1" errorTestId="err">
        <input />
      </Field>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Invalid');
    expect(alert.id).toBe('e1');
  });

  it('Toast is a status region, with an error tone', () => {
    const { rerender } = render(<Toast testId="t">Saved</Toast>);
    const plain = screen.getByRole('status').className;
    rerender(
      <Toast testId="t" tone="error">
        Saved
      </Toast>,
    );
    expect(screen.getByRole('status').className).not.toBe(plain);
  });

  it('Pill and Mark render their content', () => {
    render(
      <>
        <Pill tone="positive" testId="pill">
          Live
        </Pill>
        <Mark name="Villa" />
      </>,
    );
    expect(screen.getByTestId('pill').textContent).toBe('Live');
    expect(screen.getByText('Villa')).toBeTruthy();
  });
});
