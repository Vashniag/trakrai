import { useCallback, type ComponentPropsWithoutRef } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { useFlow } from '@trakrai-workflow/ui';
import { useReactFlow } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { Download } from 'lucide-react';
import encode from 'png-chunks-encode';
import extract from 'png-chunks-extract';

import { serializeWorkflowData } from './workflow-data-utils';

/**
 * Captures the current canvas as a PNG and embeds the serialized workflow in a `WorkflowData`
 * `tEXt` chunk so the image can be previewed and later re-imported.
 *
 * This component depends on browser DOM APIs and a mounted React Flow canvas.
 */
export const ExportImageButton = ({
  fileName,
  ...props
}: ComponentPropsWithoutRef<typeof Button> & {
  fileName: string;
}) => {
  const { getViewport, fitView, setViewport } = useReactFlow();
  const {
    workflow: { nodes, edges },
  } = useFlow();

  const exportAsImage = useCallback(async () => {
    const flowElement = document.querySelector('.react-flow');
    if (!(flowElement instanceof HTMLElement)) return;

    const previousViewport = getViewport();

    await fitView({ padding: 0.2 });
    const SETTLE_DELAY = 100;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SETTLE_DELAY);
    });

    const isDark = flowElement.classList.contains('dark');
    const bgColor = isDark ? '#1a1a1a' : '#ffffff';
    const { width, height } = flowElement.getBoundingClientRect();
    const currentViewport = getViewport();
    const data = serializeWorkflowData(nodes, edges);
    const dataUrl = await toPng(flowElement, {
      backgroundColor: bgColor,
      width,
      height,
      style: {
        width: `${String(width)}px`,
        height: `${String(height)}px`,
      },
      pixelRatio: Math.ceil(1 / currentViewport.zoom),
      filter: (node) => {
        return !(
          node instanceof HTMLElement &&
          typeof node.className === 'string' &&
          (node.className.includes('react-flow__minimap') ||
            node.className.includes('react-flow__controls') ||
            node.className.includes('react-flow__panel'))
        );
      },
    });

    await setViewport(previousViewport);

    // Embed workflow data in PNG tEXt chunk
    const base64Data = dataUrl.split(',')[1];
    if (base64Data === undefined || base64Data === '') {
      throw new Error('Failed to extract base64 data from image');
    }
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const chunks = extract(bytes) as Array<{ name: string; data: Uint8Array }>;
    const workflowDataString = JSON.stringify(data);
    const keyword = 'WorkflowData';
    const textData = new Uint8Array(keyword.length + 1 + workflowDataString.length);
    for (let i = 0; i < keyword.length; i++) {
      textData[i] = keyword.charCodeAt(i);
    }
    textData[keyword.length] = 0;
    for (let i = 0; i < workflowDataString.length; i++) {
      textData[keyword.length + 1 + i] = workflowDataString.charCodeAt(i);
    }

    const textChunk = {
      name: 'tEXt',
      data: textData,
    };

    chunks.splice(chunks.length - 1, 0, textChunk);

    const newPngBuffer = encode(chunks) as Uint8Array;
    const buffer = new Uint8Array(newPngBuffer);
    const blob = new Blob([buffer], { type: 'image/png' });
    const newDataUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `${fileName}.png`;
    link.href = newDataUrl;
    link.click();

    URL.revokeObjectURL(newDataUrl);
  }, [fileName, getViewport, fitView, setViewport, nodes, edges]);

  return (
    <Button
      size="icon"
      title="Download as image"
      variant="outline"
      {...props}
      onClick={(e) => {
        void exportAsImage();
        props.onClick?.(e);
      }}
    >
      {props.children ?? <Download className="h-4 w-4" />}
    </Button>
  );
};
