import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@trakrai/design-system/lib/utils';

/** Base node container with border, hover states, and card styling. */
export const BaseNode = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'base-node bg-card text-card-foreground relative border',
        'hover:border-muted-foreground',
        className,
      )}
      tabIndex={0}
      {...props}
    />
  ),
);
BaseNode.displayName = 'BaseNode';
/** Header section of a base node with flex layout for title and handles. */
export const BaseNodeHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      className={cn(
        'mx-0 my-0 flex flex-row items-center justify-between gap-2 px-3 py-2',
        // Remove or modify these classes if you modify the padding in the
        // `<BaseNode />` component.
        className,
      )}
    />
  ),
);
BaseNodeHeader.displayName = 'BaseNodeHeader';

/** Title heading rendered inside a `BaseNodeHeader`. */
export const BaseNodeHeaderTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('user-select-none flex-1 font-semibold', className)}
    data-slot="base-node-title"
    {...props}
  />
));
BaseNodeHeaderTitle.displayName = 'BaseNodeHeaderTitle';

/** Content area of a base node with vertical flex layout and padding. */
export const BaseNodeContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-y-2 p-3', className)}
      data-slot="base-node-content"
      {...props}
    />
  ),
);
BaseNodeContent.displayName = 'BaseNodeContent';
