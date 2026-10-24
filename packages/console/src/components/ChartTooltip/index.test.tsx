import { render, screen } from '@testing-library/react';

import ChartTooltip from '.';

describe('<ChartTooltip />', () => {
  it('renders the formatted count and label', () => {
    render(
      <ChartTooltip label="Oct 12" payload={[{ payload: { count: 1234, date: '2026-10-12' } }]} />
    );

    expect(screen.getByText('1,234')).not.toBeNull();
    expect(screen.getByText('Oct 12')).not.toBeNull();
  });

  it('renders nothing without a label', () => {
    const { container } = render(
      <ChartTooltip payload={[{ payload: { count: 1, date: '2026-10-12' } }]} />
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing without a populated payload', () => {
    const { container, rerender } = render(<ChartTooltip label="Oct 12" />);

    expect(container.innerHTML).toBe('');
    rerender(<ChartTooltip label="Oct 12" payload={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
