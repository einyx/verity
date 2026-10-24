import { render, screen } from '@testing-library/react';

import Block from '@/pages/Dashboard/components/Block';

import StatTile from '.';

jest.mock('@/scss/modal.module.scss', () => ({}));

describe('<StatTile />', () => {
  it('renders the count with thousands separators and a positive delta', () => {
    render(<StatTile title="Total leads" count={1892} delta={6} />);

    expect(screen.getByText('1,892')).not.toBeNull();
    expect(screen.getByText('(+6)')).not.toBeNull();
    expect(screen.getByText('(+6)').parentElement?.querySelectorAll('svg').length).toBe(1);
  });

  it('renders a ReactNode title directly with the eyebrow appearance', () => {
    const { container } = render(
      <StatTile title={<span>NEW · 7 DAYS</span>} count={24} appearance="eyebrow" />
    );

    expect(screen.getByText('NEW · 7 DAYS')).not.toBeNull();
    expect(container.firstElementChild?.classList.contains('eyebrow')).toBe(true);
  });

  it('omits the delta when there is none', () => {
    render(<StatTile title="Qualified" count={147} />);

    expect(screen.queryByText(/^\(/)).toBeNull();
  });

  it('preserves the default classes without opting into eyebrow styling', () => {
    const { container } = render(<StatTile title="Total" count={0} />);

    expect(container.firstElementChild?.className).toBe('card block default');
    expect(screen.getByText('Total').className).toBe('title');
    expect(screen.getByText('0').className).toBe('number');
  });

  it.each(['default', 'bordered', 'plain'] as const)(
    'preserves the %s variant and accepts a custom class',
    (variant) => {
      const { container } = render(
        <StatTile title="Total" count={1} variant={variant} className="custom" />
      );

      expect(container.firstElementChild?.classList.contains(variant)).toBe(true);
      expect(container.firstElementChild?.classList.contains('custom')).toBe(true);
    }
  );

  it('renders a negative delta with the down class and arrow', () => {
    render(<StatTile title="Total" count={10} delta={-2} />);

    const delta = screen.getByText('(-2)').parentElement;

    expect(delta?.classList.contains('down')).toBe(true);
    expect(delta?.querySelectorAll('svg').length).toBe(1);
  });

  it('renders a zero delta with a plus sign and no arrow', () => {
    render(<StatTile title="Total" count={10} delta={0} />);

    const delta = screen.getByText('(+0)').parentElement;

    expect(delta?.classList.contains('down')).toBe(false);
    expect(delta?.querySelectorAll('svg').length).toBe(0);
  });

  it('preserves the optional tip anchor', () => {
    render(<StatTile title="Total" count={10} tip="More information" />);

    expect(screen.getByRole('button')).not.toBeNull();
  });

  it.each(['default', 'bordered', 'plain'] as const)(
    'keeps the Dashboard wrapper translated with the %s variant and default appearance',
    (variant) => {
      const { container, unmount } = render(
        <Block title="general.add" count={1234} delta={-2} variant={variant} />
      );
      const dashboardMarkup = container.innerHTML;

      expect(screen.getByText('Add')).not.toBeNull();
      unmount();

      const { container: sharedContainer } = render(
        <StatTile title="Add" count={1234} delta={-2} variant={variant} />
      );

      expect(sharedContainer.innerHTML).toBe(dashboardMarkup);
    }
  );
});
