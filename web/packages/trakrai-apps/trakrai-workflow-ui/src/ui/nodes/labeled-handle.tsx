import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type HTMLAttributes,
  useState,
} from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@trakrai/design-system/components/tooltip';
import { cn } from '@trakrai/design-system/lib/utils';
import { type OnConnect, type HandleProps } from '@xyflow/react';

import { BaseHandle } from './base-handle';

const flexDirections = {
  top: 'flex-col',
  right: 'flex-row-reverse justify-end',
  bottom: 'flex-col-reverse justify-end',
  left: 'flex-row',
};

/**
 * A React Flow handle paired with a text label and optional tooltip.
 *
 * Label placement is determined automatically based on the handle `position`
 * (e.g. labels appear to the right of left-positioned handles). When `connectable`
 * is `false`, the handle dot is hidden while the label remains visible. Tooltips
 * stay mounted around the label even when the underlying handle is hidden, which
 * lets callers explain why a port is unavailable without sacrificing the label.
 *
 * @param title - The label text displayed next to the handle.
 * @param position - Handle position (`'top'` | `'right'` | `'bottom'` | `'left'`).
 * @param connectable - Whether the handle allows new connections. Defaults to `true`.
 * @param tooltipContent - React node rendered inside the tooltip on hover.
 * @param tooltipEnabled - Whether the tooltip is active. Defaults to `true`; when
 * `false`, attempted opens are ignored and the underline hover state never persists.
 * @param handleClassName - Additional CSS classes for the handle element.
 * @param labelClassName - Additional CSS classes for the label element.
 */
export const LabeledHandle: ForwardRefExoticComponent<
  HandleProps &
    Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
      onConnect?: OnConnect;
    } & HTMLAttributes<HTMLDivElement> & {
      title: string;
      handleClassName?: string;
      labelClassName?: string;
      connectable?: boolean;
      tooltipContent?: React.ReactNode;
      tooltipEnabled?: boolean;
    } & RefAttributes<HTMLDivElement>
> = forwardRef<
  HTMLDivElement,
  HandleProps &
    HTMLAttributes<HTMLDivElement> & {
      title: string;
      handleClassName?: string;
      labelClassName?: string;
      connectable?: boolean;
      tooltipContent?: React.ReactNode;
      tooltipEnabled?: boolean;
    }
>(
  (
    {
      className,
      labelClassName,
      handleClassName,
      title,
      position,
      connectable = true,
      tooltipEnabled = true,
      tooltipContent,
      ...props
    },
    ref,
  ) => {
    const [tooltipDisplayed, setTooltipDisplayed] = useState(false);
    return (
      <div
        ref={ref}
        className={cn('relative flex items-center', flexDirections[position], className)}
        title={title}
      >
        {connectable === true && (
          <BaseHandle className={handleClassName} position={position} {...props} />
        )}
        <Tooltip
          open={tooltipDisplayed}
          onOpenChange={(open) => {
            if (!tooltipEnabled && open) {
              return;
            }
            setTooltipDisplayed(open);
          }}
        >
          <TooltipTrigger>
            <label
              className={cn(
                'text-foreground px-3',
                labelClassName,
                `${tooltipDisplayed ? 'underline' : ''}`,
              )}
            >
              {title}
            </label>
          </TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
      </div>
    );
  },
);

LabeledHandle.displayName = 'LabeledHandle';
