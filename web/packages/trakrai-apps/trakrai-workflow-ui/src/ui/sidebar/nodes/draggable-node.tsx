import type { DragEvent } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@trakrai/design-system/components/tooltip';

import { FLUXERY_NODE_TYPE_MIME } from '../../node-dnd';

/**
 * A draggable node card displayed in the sidebar.
 *
 * Sets the node type as MIME data on drag start so it can be dropped onto
 * the React Flow canvas to create a new node.
 *
 * @param type - The registered node type key.
 * @param displayName - Human-readable name shown on the card.
 * @param description - Description shown in a tooltip on hover.
 */
export const DraggableNode = ({
  type,
  displayName,
  description,
}: {
  type: string;
  displayName: string;
  description: string;
}) => {
  const onDragStart = (event: DragEvent<HTMLDivElement>, nodeType: string) => {
    event.dataTransfer.setData(FLUXERY_NODE_TYPE_MIME, nodeType);
    event.dataTransfer.setData('text/plain', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="hover:bg-accent w-full border p-2 text-center transition-colors"
          draggable
          role="button"
          tabIndex={-1}
          onDragStart={(event) => {
            onDragStart(event, type);
          }}
        >
          <div className="text-sm font-medium">{displayName}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" side="right">
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};
