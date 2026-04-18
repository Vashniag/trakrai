'use client';

import { useMemo } from 'react';

import { ConditionalEdgeType, type Node } from '@trakrai-workflow/core';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';

import { useFluxeryCanvas } from './canvas-context';
import { useFlow } from './flow-context';
import { ConditionalEdge } from './nodes/conditional-edge';
import { nodeTypes } from './nodes/node-renderer';

import type { FluxeryFlowViewProps } from './flow-types';

const edgeTypes = {
  [ConditionalEdgeType]: ConditionalEdge,
};

export * from './sidebar';

/**
 * Top-level flex container for a Fluxery editor layout.
 *
 * Provides a full-width, full-height flex wrapper. Typically wraps `FluxeryCore`
 * alongside a `FluxerySidebar`.
 *
 * @example
 * ```tsx
 * <FluxeryContainer>
 *   <FluxeryCore />
 *   <FluxerySidebar>...</FluxerySidebar>
 * </FluxeryContainer>
 * ```
 */
export const FluxeryContainer = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex h-full w-full">{children}</div>;
};

/**
 * Core React Flow canvas for the Fluxery workflow editor.
 *
 * Renders the interactive node graph with controls, background, and edge/node type
 * resolution. Must be used within a `FluxeryProvider`.
 *
 * @example
 * ```tsx
 * <FluxeryCore>
 *   <FluxeryTopRightPanel>...</FluxeryTopRightPanel>
 * </FluxeryCore>
 * ```
 */
export const FluxeryCore = ({
  children,
  flowView,
  nodeTypes: additionalNodeTypes,
  onNodeDoubleClick,
}: {
  children?: React.ReactNode;
  flowView?: FluxeryFlowViewProps;
  nodeTypes?: NodeTypes;
  onNodeDoubleClick?: NodeMouseHandler<Node>;
}) => {
  const { flow, nodeSchemas, nodeHandlers, theme } = useFlow();
  const canvas = useFluxeryCanvas();
  const canvasNodeTypes = canvas?.nodeTypes;
  const resolvedNodeTypes = useMemo(
    () =>
      nodeTypes(nodeSchemas, nodeHandlers, { ...(canvasNodeTypes ?? {}), ...additionalNodeTypes }),
    [additionalNodeTypes, canvasNodeTypes, nodeSchemas, nodeHandlers],
  );
  const resolvedFlow = flowView ?? canvas?.flowView ?? flow;
  const resolvedNodeDoubleClick = onNodeDoubleClick ?? canvas?.onNodeDoubleClick;
  return (
    <div className="flex h-full w-full">
      <div className="h-full w-full flex-1">
        <ReactFlow
          colorMode={theme}
          edgeTypes={edgeTypes}
          fitView
          nodeTypes={resolvedNodeTypes}
          proOptions={{ hideAttribution: true }}
          {...resolvedFlow}
          minZoom={0.1}
          onNodeDoubleClick={resolvedNodeDoubleClick}
        >
          <Controls />
          <Background />
          {children}
        </ReactFlow>
      </div>
    </div>
  );
};

/**
 * Panel positioned at the top-right corner of the React Flow canvas.
 *
 * Use inside `FluxeryCore` to overlay controls or status indicators.
 */
export const FluxeryTopRightPanel = ({ children }: { children: React.ReactNode }) => {
  return (
    <Panel className="m-4" position="top-right">
      {children}
    </Panel>
  );
};

/**
 * Panel positioned at the top-left corner of the React Flow canvas.
 *
 * Use inside `FluxeryCore` to overlay controls or action buttons.
 */
export const FluxeryTopLeftPanel = ({ children }: { children: React.ReactNode }) => {
  return (
    <Panel className="flex gap-1" position="top-left">
      {children}
    </Panel>
  );
};
