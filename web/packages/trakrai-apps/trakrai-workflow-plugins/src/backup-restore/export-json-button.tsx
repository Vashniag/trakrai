import { useCallback, type ComponentPropsWithoutRef } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { useFlow } from '@trakrai-workflow/ui';
import { FileJson } from 'lucide-react';

import { serializeWorkflowData } from './workflow-data-utils';

/**
 * Downloads the current editor workflow as a readable JSON snapshot.
 *
 * This component is browser-only and expects to run inside a `useFlow()` context.
 */
export const ExportJsonButton = ({
  fileName,
  ...props
}: ComponentPropsWithoutRef<typeof Button> & { fileName: string }) => {
  const {
    workflow: { nodes, edges },
  } = useFlow();

  const exportAsJson = useCallback(() => {
    const data = serializeWorkflowData(nodes, edges);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${fileName}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, fileName]);

  return (
    <Button
      size="icon"
      title="Export as JSON"
      variant="outline"
      {...props}
      onClick={(e) => {
        exportAsJson();
        props.onClick?.(e);
      }}
    >
      {props.children ?? <FileJson className="h-4 w-4" />}
    </Button>
  );
};
