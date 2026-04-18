import type { ComponentPropsWithoutRef } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { useFlow, useFluxeryEditorActions } from '@trakrai-workflow/ui';
import { ArrowLeftRight } from 'lucide-react';

/**
 * Toolbar button that asks the current editor instance to recompute the workflow layout.
 *
 * The button is disabled when no editable workflow controller is available from the Fluxery context.
 */
export const AutoLayoutButton = (props: ComponentPropsWithoutRef<typeof Button>) => {
  const { editing: baseEditing } = useFlow();
  const editorActions = useFluxeryEditorActions();
  const editing = editorActions?.editing ?? baseEditing;
  return (
    <Button
      disabled={editing === null || props.disabled}
      size="icon"
      title="Auto layout"
      variant="outline"
      {...props}
      onClick={(e) => {
        if (editing !== null) {
          void editing.layoutWorkflow();
        }
        props.onClick?.(e);
      }}
    >
      {props.children ?? <ArrowLeftRight className="h-4 w-4" />}
    </Button>
  );
};
