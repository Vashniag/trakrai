import {
  forwardRef,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
} from 'react';

import { cn } from '@trakrai/design-system/lib/utils';
import { Handle, type HandleProps, type OnConnect } from '@xyflow/react';

type BaseHandleProps = HandleProps;

/** Styled wrapper around the React Flow `Handle` component with rounded borders and dark mode support. */
export const BaseHandle: ForwardRefExoticComponent<
  HandleProps &
    Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
      onConnect?: OnConnect;
    } & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, BaseHandleProps>(({ className, children, ...props }, ref) => {
  return (
    <Handle
      ref={ref}
      className={cn(
        'dark:border-muted-foreground dark:bg-secondary h-[11px] w-[11px] rounded-full border border-slate-300 bg-slate-100 transition',
        className,
      )}
      {...props}
    >
      {children}
    </Handle>
  );
});

BaseHandle.displayName = 'BaseHandle';
