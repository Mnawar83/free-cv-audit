import { fireEvent, render, screen } from '@testing-library/react';
import Modal from '../Modal';

describe('Modal', () => {
  test('closes on escape key', () => {
    const onClose = jest.fn();
    render(
      <Modal open title="Checkout" description="desc" onClose={onClose}>
        <button type="button">Pay</button>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('has dialog semantics', () => {
    render(
      <Modal open title="Checkout" description="desc" onClose={() => {}}>
        <button type="button">Pay</button>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: /checkout/i })).toHaveAttribute('aria-modal', 'true');
  });
});
