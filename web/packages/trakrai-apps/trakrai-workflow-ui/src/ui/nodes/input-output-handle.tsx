import { useEffect, useMemo } from 'react';

import { createDisplayName } from '@trakrai-workflow/core/utils';
import { Position, useNodeId, useUpdateNodeInternals } from '@xyflow/react';

import { LabeledHandle } from './labeled-handle';

/**
 * Wrapper for creating a labeled input or output handle.
 *
 * Derives a human-readable label from `propName`, positions the handle based on
 * `type` (left for input, right for output), and triggers a React Flow internal
 * update when `connectable` changes. That forced `useUpdateNodeInternals()` call is
 * important because React Flow caches handle geometry; without it, hiding or showing
 * a handle after configuration changes can leave stale connection hitboxes behind.
 *
 * @param propName - The schema property name (also used as the handle ID).
 * @param title - Optional override for the displayed label.
 * @param type - Whether this is an `'input'` (target) or `'output'` (source) handle.
 * @param connectable - Whether the handle accepts new connections.
 * @param tooltipContent - Content shown in the handle tooltip on hover.
 * @param tooltipEnabled - Whether the tooltip is active.
 */
export const InputOutputHandle = ({
  propName,
  title,
  type,
  ...rest
}: {
  propName: string;
  title?: string;
  type: 'input' | 'output';
  connectable?: boolean;
  tooltipContent?: React.ReactNode;
  tooltipEnabled?: boolean;
}) => {
  const readableTitle = useMemo(() => title ?? createDisplayName(propName), [propName, title]);
  const updateNodeInternals = useUpdateNodeInternals();
  const id = useNodeId();
  useEffect(() => {
    if (id !== null) {
      updateNodeInternals(id);
    }
  }, [rest.connectable, id, updateNodeInternals]);
  return (
    <LabeledHandle
      key={propName}
      id={propName}
      labelClassName="text-xs"
      position={type === 'input' ? Position.Left : Position.Right}
      title={readableTitle}
      type={type === 'input' ? 'target' : 'source'}
      {...rest}
    />
  );
};
