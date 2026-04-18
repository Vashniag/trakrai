'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@trakrai/design-system/components/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@trakrai/design-system/components/drawer';
import { useIsMobile } from '@trakrai/design-system/hooks/use-mobile';
import { cn } from '@trakrai/design-system/lib/utils';

type ResponsiveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export const ResponsiveModal = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
}: ResponsiveModalProps) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="p-4 pb-8">
          {title === undefined && description === undefined ? null : (
            <DrawerHeader className="text-left">
              {title === undefined ? null : <DrawerTitle>{title}</DrawerTitle>}
              {description === undefined ? null : (
                <DrawerDescription>{description}</DrawerDescription>
              )}
            </DrawerHeader>
          )}
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={cn('sm:max-w-106.25', className)}>
        {title === undefined && description === undefined ? null : (
          <DialogHeader>
            {title === undefined ? null : <DialogTitle>{title}</DialogTitle>}
            {description === undefined ? null : (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
};
