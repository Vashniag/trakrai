'use client';

import { createContext, useContext, useMemo } from 'react';

import type { FluxeryFlowViewProps } from './flow-types';
import type { Node } from '@trakrai-workflow/core';
import type { NodeMouseHandler, NodeTypes } from '@xyflow/react';

type FluxeryCanvasContextValue = {
  flowView?: FluxeryFlowViewProps;
  nodeTypes?: NodeTypes;
  onNodeDoubleClick?: NodeMouseHandler<Node>;
};

const FluxeryCanvasContext = createContext<FluxeryCanvasContextValue | null>(null);

/**
 * Overrides portions of the canvas configuration consumed by {@link FluxeryCore}.
 *
 * Nested providers merge with their parent value instead of replacing it outright:
 * `flowView` and `onNodeDoubleClick` fall back to the nearest parent, while
 * `nodeTypes` are shallow-merged so local overrides can add or replace custom nodes.
 */
export const FluxeryCanvasProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FluxeryCanvasContextValue;
}) => {
  const parentValue = useContext(FluxeryCanvasContext);
  const parentFlowView = parentValue?.flowView;
  const parentNodeDoubleClick = parentValue?.onNodeDoubleClick;
  const parentNodeTypes = parentValue?.nodeTypes;
  const mergedNodeTypes = useMemo(() => {
    if (value.nodeTypes === undefined) {
      return parentNodeTypes;
    }
    if (parentNodeTypes === undefined) {
      return value.nodeTypes;
    }

    return {
      ...parentNodeTypes,
      ...value.nodeTypes,
    };
  }, [parentNodeTypes, value.nodeTypes]);
  const mergedValue = useMemo<FluxeryCanvasContextValue>(
    () => ({
      flowView: value.flowView ?? parentFlowView,
      nodeTypes: mergedNodeTypes,
      onNodeDoubleClick: value.onNodeDoubleClick ?? parentNodeDoubleClick,
    }),
    [
      mergedNodeTypes,
      parentFlowView,
      parentNodeDoubleClick,
      value.flowView,
      value.onNodeDoubleClick,
    ],
  );

  return (
    <FluxeryCanvasContext.Provider value={mergedValue}>{children}</FluxeryCanvasContext.Provider>
  );
};

/**
 * Reads the nearest canvas override registered through {@link FluxeryCanvasProvider}.
 *
 * Returns `null` when no override has been registered, which lets consumers layer
 * optional canvas customizations on top of the base editor state.
 */
export const useFluxeryCanvas = () => {
  return useContext(FluxeryCanvasContext);
};
