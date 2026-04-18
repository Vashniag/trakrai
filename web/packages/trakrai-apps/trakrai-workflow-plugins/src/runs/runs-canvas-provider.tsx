'use client';

import { useMemo } from 'react';

import { FluxeryCanvasProvider, useFlow } from '@trakrai-workflow/ui';

/**
 * Narrows the shared canvas context to the run overlay view while a workflow run is selected.
 *
 * When `selectedRunId` is absent, the provider leaves the canvas override unset so consumers fall
 * back to the live editor canvas state.
 */
export const RunsCanvasProvider = ({
  children,
  selectedRunId,
}: {
  children: React.ReactNode;
  selectedRunId?: string;
}) => {
  const { flow } = useFlow();
  const value = useMemo(
    () => ({
      flowView: selectedRunId === undefined ? undefined : flow,
    }),
    [flow, selectedRunId],
  );

  return <FluxeryCanvasProvider value={value}>{children}</FluxeryCanvasProvider>;
};
