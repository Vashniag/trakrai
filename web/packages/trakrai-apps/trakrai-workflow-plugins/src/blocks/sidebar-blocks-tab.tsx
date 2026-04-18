'use client';

import { useState, type DragEvent } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@trakrai/design-system/components/button';
import { Input } from '@trakrai/design-system/components/input';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  createFluxerySidebarTab,
  useFlow,
  useSidebarTabAutoSelect,
  useTRPCPluginAPIs,
} from '@trakrai-workflow/ui';
import { Boxes, BoxSelect, Save } from 'lucide-react';

import { FLUXERY_BLOCK_TEMPLATE_MIME, type FluxeryBlockTemplate } from './block-utils';
import { useBlocks } from './blocks-context';

import type { BlocksPlugin } from './blocks-plugin';

const BlockLibraryCard = ({ blockId, name }: { blockId: string; name: string }) => {
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(FLUXERY_BLOCK_TEMPLATE_MIME, blockId);
    event.dataTransfer.setData('text/plain', name);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className="border-border bg-card hover:bg-accent/50 flex w-full cursor-grab flex-col gap-1 border p-3 text-left transition-colors active:cursor-grabbing"
      draggable
      role="button"
      tabIndex={-1}
      onDragStart={onDragStart}
    >
      <div className="flex items-center gap-2">
        <Boxes className="size-4" />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">Drag onto the canvas to insert.</p>
    </div>
  );
};

const SidebarBlocksTabContent = () => {
  const flow = useFlow();
  const blocks = useBlocks();
  const { isReadOnly } = flow;
  const { client: trpc } = useTRPCPluginAPIs<BlocksPlugin>('blocks');
  const listBlocksQuery = useQuery(trpc.listBlocks.queryOptions());
  const getUploadUrlMutation = useMutation(trpc.getUploadUrl.mutationOptions());
  const [blockName, setBlockName] = useState('');

  const canCreate = !isReadOnly && blocks.canCreateFromSelection && blockName.trim() !== '';

  const createBlock = async () => {
    const trimmedName = blockName.trim();
    if (!canCreate) {
      return;
    }

    const template = blocks.buildTemplateFromSelection(trimmedName);
    if (template === null) {
      return;
    }

    const { blockId, uploadUrl } = await getUploadUrlMutation.mutateAsync({});
    const templatePayload: FluxeryBlockTemplate = {
      ...template,
      id: blockId,
      name: trimmedName,
    };

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templatePayload),
    });
    if (!uploadResponse.ok) {
      throw new Error('Failed to upload block definition');
    }

    blocks.createBlockFromSelection({
      name: trimmedName,
      template: templatePayload,
    });
    setBlockName('');
    await listBlocksQuery.refetch();
  };

  return (
    <div className="h-full w-full">
      <ScrollArea className="h-full w-full px-4 pt-4">
        <div className="space-y-4 pb-4">
          {blocks.canCreateFromSelection ? (
            <section className="border-border bg-card space-y-3 border p-3">
              <div className="flex items-center gap-2">
                <BoxSelect className="size-4" />
                <h3 className="text-sm font-semibold">Create Block</h3>
              </div>
              <p className="text-muted-foreground text-xs">
                Save the selected nodes as a reusable block and collapse them into one node.
              </p>
              <Input
                disabled={isReadOnly}
                placeholder="Block name"
                value={blockName}
                onChange={(event) => {
                  setBlockName(event.target.value);
                }}
              />
              <Button disabled={!canCreate} type="button" onClick={() => void createBlock()}>
                <Save className="size-4" />
                Save Selection As Block
              </Button>
            </section>
          ) : null}

          <section className="border-border bg-card space-y-3 border p-3">
            <div className="flex items-center gap-2">
              <Boxes className="size-4" />
              <h3 className="text-sm font-semibold">Block Library</h3>
            </div>
            <p className="text-muted-foreground text-xs">
              Reuse saved node groups by dragging a block onto the canvas.
            </p>
            <div className={cn('space-y-2', listBlocksQuery.isLoading && 'opacity-60')}>
              {listBlocksQuery.data?.map((block) => (
                <BlockLibraryCard key={block.blockId} blockId={block.blockId} name={block.name} />
              ))}
              {listBlocksQuery.data?.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No saved blocks yet. Create one from a multi-node selection.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
};

/**
 * Sidebar tab that lists saved block templates and enables creating new blocks from the current
 * canvas selection.
 *
 * This tab expects the editor to be wrapped in {@link BlocksProvider} so it can read block
 * projection state and mutation helpers through {@link useBlocks}.
 */
export const SidebarBlocksTab = createFluxerySidebarTab({
  id: 'blocks',
  label: 'Blocks',
  contentClassName: 'min-h-0 h-full',
  order: 2,
  useAutoSelect: () => {
    const blocks = useBlocks();
    useSidebarTabAutoSelect(
      'blocks',
      blocks.canCreateFromSelection ? blocks.selectedNodeIds.join('|') : null,
    );
  },
  render: () => <SidebarBlocksTabContent />,
});
