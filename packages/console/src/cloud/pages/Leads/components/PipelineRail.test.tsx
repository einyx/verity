import { render, screen, within } from '@testing-library/react';

import type { PipelineRow } from '../lead-stats';

import PipelineRail, { type PipelineRailProps } from './PipelineRail';

const rows: readonly PipelineRow[] = [
  { key: 'new', label: 'New', count: 892, share: 1, isClosed: false },
  { key: 'closed', label: 'Closed / rejected', count: 12, share: 0.013, isClosed: true },
  { key: 'future', label: 'Future stage', count: 0, share: 0, isClosed: false },
];

describe('<PipelineRail />', () => {
  it('labels its region with a distinct heading and explains the percentages', () => {
    render(<PipelineRail rows={rows} />);

    const region = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Pipeline' })).not.toBeNull();
    expect(within(region).getByText('Share of leads by stage')).not.toBeNull();
  });

  it('renders every stage, including zero-count and unknown stages, as a list item', () => {
    const props: PipelineRailProps = { rows };
    render(<PipelineRail {...props} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('New')).not.toBeNull();
    expect(within(items[0]!).getByText('892')).not.toBeNull();
    expect(within(items[0]!).getByText('100%')).not.toBeNull();
    expect(within(items[1]!).getByText('Closed / rejected')).not.toBeNull();
    expect(within(items[1]!).getByText('12')).not.toBeNull();
    expect(within(items[1]!).getByText('1%')).not.toBeNull();
    expect(within(items[2]!).getByText('Future stage')).not.toBeNull();
    expect(within(items[2]!).getByText('0')).not.toBeNull();
    expect(within(items[2]!).getByText('0%')).not.toBeNull();
  });

  it('rounds bar widths to tenths of a percent without floating-point noise', () => {
    render(
      <PipelineRail
        rows={[...rows, { ...rows[0]!, key: 'noise', share: 0.013_000_000_000_000_003 }]}
      />
    );

    expect(screen.getAllByTestId('pipeline-bar').map((bar) => bar.style.width)).toEqual([
      '100%',
      '1.3%',
      '0%',
      '1.3%',
    ]);
  });

  it.each([
    [-0.2, '0%'],
    [1.2, '100%'],
    [Number.NaN, '0%'],
    [Number.POSITIVE_INFINITY, '100%'],
    [Number.NEGATIVE_INFINITY, '0%'],
  ])('bounds a share of %s defensively to %s', (share, percentage) => {
    render(<PipelineRail rows={[{ ...rows[0]!, share }]} />);

    expect(screen.getByTestId('pipeline-bar').style.width).toBe(percentage);
    expect(screen.getByText(percentage)).not.toBeNull();
  });

  it('uses the same open-stage styling for unknown stages and distinguishes closed stages', () => {
    render(<PipelineRail rows={rows} />);

    const bars = screen.getAllByTestId('pipeline-bar');
    expect(bars[0]!.className).toBe(bars[2]!.className);
    expect(bars[0]!.classList.contains('closed')).toBe(false);
    expect(bars[1]!.classList.contains('closed')).toBe(true);
    expect(bars.every((bar) => bar.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('keeps heading references unique when multiple rails render', () => {
    render(
      <>
        <PipelineRail rows={[]} />
        <PipelineRail rows={[]} />
      </>
    );

    const regions = screen.getAllByRole('region', { name: 'Pipeline' });
    const headings = screen.getAllByRole('heading', { name: 'Pipeline' });
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
    expect(regions.map((region) => region.getAttribute('aria-labelledby'))).toEqual(
      headings.map((heading) => heading.id)
    );
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
