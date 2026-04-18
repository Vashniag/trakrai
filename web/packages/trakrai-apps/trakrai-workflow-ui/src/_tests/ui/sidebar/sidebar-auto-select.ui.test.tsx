// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FluxerySidebar } from '../../../ui/sidebar/sidebar';
import {
  SidebarProvider,
  useFluxerySidebar,
  useSidebarTabAutoSelect,
} from '../../../ui/sidebar/sidebar-context';
import { createFluxerySidebarTab } from '../../../ui/sidebar/sidebar-tab';

const INFO_LABEL = 'Info';
const NODES_LABEL = 'Nodes';
const ACTIVE_STATE = 'active';
const CURRENT_TAB_TEST_ID = 'current-tab';
const TAB_STATE_ATTRIBUTE = 'data-state';

const SidebarNodesTab = createFluxerySidebarTab({
  id: 'nodes',
  label: NODES_LABEL,
  render: () => <div>Nodes content</div>,
});

const SidebarInfoTab = createFluxerySidebarTab<{ selected: boolean }>({
  id: 'info',
  label: INFO_LABEL,
  useAutoSelect: ({ selected }) => {
    useSidebarTabAutoSelect('info', selected);
  },
  render: ({ selected }) => <div>{selected ? 'Selected node' : 'No selection'}</div>,
});

const SidebarAutoSelectHarness = ({ selected }: { selected: boolean }) => {
  const { currentTab, setTab } = useFluxerySidebar();

  useSidebarTabAutoSelect('info', selected ? 'node-1' : null);

  return (
    <>
      <div data-testid={CURRENT_TAB_TEST_ID}>{currentTab}</div>
      <button
        type="button"
        onClick={() => {
          setTab('nodes');
        }}
      >
        Show nodes
      </button>
    </>
  );
};

describe('FluxerySidebar auto select', () => {
  it('auto-selects a wrapper tab even when its content is initially inactive', async () => {
    const { rerender } = render(
      <FluxerySidebar>
        <SidebarNodesTab />
        <SidebarInfoTab selected={false} />
      </FluxerySidebar>,
    );

    expect(screen.getByRole('tab', { name: NODES_LABEL })).toHaveAttribute(
      TAB_STATE_ATTRIBUTE,
      ACTIVE_STATE,
    );
    expect(screen.getByRole('tab', { name: INFO_LABEL })).toHaveAttribute(
      TAB_STATE_ATTRIBUTE,
      'inactive',
    );

    rerender(
      <FluxerySidebar>
        <SidebarNodesTab />
        <SidebarInfoTab selected />
      </FluxerySidebar>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: INFO_LABEL })).toHaveAttribute(
        TAB_STATE_ATTRIBUTE,
        ACTIVE_STATE,
      );
    });
  });

  it('allows manual tab changes while the same auto-select key remains active', async () => {
    const { rerender } = render(
      <SidebarProvider availableTabs={['nodes', 'info']} defaultTab="nodes">
        <SidebarAutoSelectHarness selected={false} />
      </SidebarProvider>,
    );

    expect(screen.getByTestId(CURRENT_TAB_TEST_ID)).toHaveTextContent('nodes');

    rerender(
      <SidebarProvider availableTabs={['nodes', 'info']} defaultTab="nodes">
        <SidebarAutoSelectHarness selected />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId(CURRENT_TAB_TEST_ID)).toHaveTextContent('info');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show nodes' }));

    await waitFor(() => {
      expect(screen.getByTestId(CURRENT_TAB_TEST_ID)).toHaveTextContent('nodes');
    });
  });
});
