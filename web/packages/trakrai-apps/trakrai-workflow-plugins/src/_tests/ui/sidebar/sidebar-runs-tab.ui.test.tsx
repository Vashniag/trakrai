// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FunctionRunStatus } from '../../../runs/inngest-graphql/graphql';
import { SidebarRunsTab } from '../../../runs/sidebar-runs-tab';

const mockUseFlow = vi.fn();
const getRunsMock = vi.fn();
vi.mock('@trakrai-workflow/ui', () => ({
  FluxerySidebarTab: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  createFluxerySidebarTab:
    <Props extends object>({ render }: { render: (props: Props) => React.ReactNode }) =>
    (props: Props) =>
      render(props),
  useFlow: () => mockUseFlow() as unknown,
  useSidebarTabAutoSelect: vi.fn(),
  useTRPCPluginAPIs: () => ({
    client: {
      getRuns: {
        queryOptions: (
          input: { startTime: Date; celQuery: string },
          opts?: Record<string, unknown>,
        ) => ({
          queryKey: ['runs', input.celQuery],
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          queryFn: () => getRunsMock(input),
          ...opts,
        }),
      },
      getRunDetails: {
        queryOptions: () => ({
          queryKey: ['run-details'],
          queryFn: vi.fn(),
        }),
      },
      getNodeRunDetails: {
        queryOptions: () => ({
          queryKey: ['node-run-details'],
          queryFn: vi.fn(),
        }),
      },
      getTraceResult: {
        queryOptions: () => ({
          queryKey: ['trace-result'],
          queryFn: vi.fn(),
        }),
      },
    },
  }),
}));

describe('SidebarRunsTab', () => {
  const defaultProps = {
    selectedRunId: undefined,
    runPollingEnabled: false,
    setRunId: vi.fn(),
    celQuery: 'workflow-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFlow.mockReturnValue({
      flow: { nodes: [] },
      setDummyWorkflowData: vi.fn(),
      setUseDummyWorkflow: vi.fn(),
      setNodeRunPresentation: vi.fn(),
      clearNodeRunPresentation: vi.fn(),
    });
    getRunsMock.mockResolvedValue([]);
  });

  const renderWithQueryClient = (element: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
  };

  it('shows empty state when no runs are available', () => {
    renderWithQueryClient(<SidebarRunsTab {...defaultProps} />);

    expect(screen.getByText('No workflow runs yet')).toBeInTheDocument();
  });

  it('renders runs and selects a run on click', async () => {
    const setRunId = vi.fn();
    getRunsMock.mockResolvedValue([
      {
        id: 'run-1',
        status: FunctionRunStatus.Running,
        queuedAt: new Date('2026-02-16T10:00:00.000Z'),
        startedAt: new Date('2026-02-16T10:00:01.000Z'),
        endedAt: null,
      },
    ]);

    renderWithQueryClient(<SidebarRunsTab {...defaultProps} setRunId={setRunId} />);

    fireEvent.click(await screen.findByRole('button'));
    expect(setRunId).toHaveBeenCalledWith('run-1');
    expect(screen.getByText(FunctionRunStatus.Running)).toBeInTheDocument();
  });
});
