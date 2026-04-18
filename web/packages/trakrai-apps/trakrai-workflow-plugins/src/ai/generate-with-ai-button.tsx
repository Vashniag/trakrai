import { useEffect, useRef, useState } from 'react';

import { experimental_useObject as useObject } from '@ai-sdk/react';
import { Button } from '@trakrai/design-system/components/button';
import { Input } from '@trakrai/design-system/components/input';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@trakrai/design-system/components/popover';
import { createNodeRuntime, type Node } from '@trakrai-workflow/core';
import { useFlow, type FluxeryConfigRecord, type FluxeryConfigValue } from '@trakrai-workflow/ui';
import { Loader, Sparkles } from 'lucide-react';
import { z } from 'zod';

import { GenerateWorkflowSchema, type GenerateWorkflow } from './schema';

const DEFAULT_NODE_WIDTH = 300;

const toConfigValue = (value: unknown): FluxeryConfigValue | undefined => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toConfigValue(entry) ?? null);
  }

  if (value !== undefined && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toConfigValue(entry)]),
    ) as FluxeryConfigRecord;
  }

  return undefined;
};

/**
 * Editor action button that streams a workflow draft from the package's `/ai/generate-workflow`
 * endpoint and incrementally inserts the generated nodes and edges into the current canvas.
 *
 * `apiRoute` should point at the host app route where {@link aiPlugin} is mounted.
 */
const GenerateWithAIButton = ({ apiRoute }: { apiRoute: string }) => {
  const { editing, nodeSchemas, nodeHandlers } = useFlow();
  const { submit, object, isLoading } = useObject({
    api: `${apiRoute}/generate-workflow`,
    schema: GenerateWorkflowSchema,
  });
  const lastNodeRef = useRef<number | null>(null);
  const lastEdgeRef = useRef<number | null>(null);
  const addedNodeIds = useRef<Map<number, string> | null>(null);
  const resetRefs = () => {
    lastNodeRef.current = null;
    lastEdgeRef.current = null;
    addedNodeIds.current = null;
  };
  const [description, setDescription] = useState('');
  useEffect(() => {
    const newNodesInObject = (() => {
      if (object?.nodes === undefined) {
        return [];
      }
      const newObjects = object.nodes.slice(
        lastNodeRef.current === null ? 0 : lastNodeRef.current + 1,
        object.nodes.length,
      );
      if (newObjects.length === 0) {
        return [];
      }
      let completedObjectsCount = 0;
      for (const obj of newObjects) {
        if (obj?.completed === true) {
          completedObjectsCount += 1;
        } else {
          break;
        }
      }
      if (completedObjectsCount === 0) {
        return [];
      }
      return newObjects.slice(0, completedObjectsCount) as GenerateWorkflow['nodes'];
    })();
    const newEdgesInObject = (() => {
      if (object?.edges === undefined) {
        return [];
      }
      const newEdges = object.edges.slice(
        lastEdgeRef.current === null ? 0 : lastEdgeRef.current + 1,
        object.edges.length,
      );
      if (newEdges.length === 0) {
        return [];
      }
      let completedEdgesCount = 0;
      for (const edge of newEdges) {
        if (edge?.completed === true) {
          completedEdgesCount += 1;
        } else {
          break;
        }
      }
      if (completedEdgesCount === 0) {
        return [];
      }
      return newEdges.slice(0, completedEdgesCount) as GenerateWorkflow['edges'];
    })();
    if (newNodesInObject.length > 0) {
      if (editing === null) {
        return;
      }
      newNodesInObject.forEach((node) => {
        const nodeSchema = nodeSchemas[node.type];
        const inputSchema = (() => {
          if (nodeSchema !== undefined) {
            return z.toJSONSchema(nodeSchema.input);
          }
          const previewNode: Node = {
            id: `__ai-preview__${node.index}__${node.type}`,
            type: node.type,
            position: { x: 0, y: 0 },
            data: { configuration: node.configuration },
          };
          const runtime = createNodeRuntime({
            nodes: [previewNode],
            edges: [],
            nodeSchemas,
            nodeHandlers,
          });
          return runtime.resolveNodeSchema(previewNode)?.input;
        })();
        const configuration = Object.entries(node.configuration).reduce<FluxeryConfigRecord>(
          (acc, [key, value]) => {
            const property = inputSchema?.properties?.[key] as { type?: string } | undefined;
            if (property === undefined) {
              acc[key] = value;
              return acc;
            }
            let parsedValue: unknown = value;
            if (property.type === 'number') {
              parsedValue = Number(value);
            } else if (property.type === 'boolean') {
              parsedValue = value === 'true';
            } else if (property.type === 'object') {
              try {
                parsedValue = JSON.parse(value as string);
              } catch {
                parsedValue = value;
              }
            }
            acc[key] = toConfigValue(parsedValue);
            return acc;
          },
          {},
        );
        const newNodeId = editing.addNode({
          type: node.type,
          position: { x: DEFAULT_NODE_WIDTH * node.index, y: 0 },
          data: { configuration: configuration },
        });
        addedNodeIds.current ??= new Map();
        addedNodeIds.current.set(node.index, newNodeId);
      });
      lastNodeRef.current = (lastNodeRef.current ?? -1) + newNodesInObject.length;
    }
    if (newEdgesInObject.length > 0) {
      if (editing === null) {
        return;
      }
      newEdgesInObject.forEach((edge) => {
        const sourceId =
          typeof edge.sourceId === 'number'
            ? (addedNodeIds.current?.get(edge.sourceId) ?? null)
            : edge.sourceId;
        const targetId =
          typeof edge.targetId === 'number'
            ? (addedNodeIds.current?.get(edge.targetId) ?? null)
            : edge.targetId;
        if (sourceId === null || targetId === null) {
          return;
        }
        editing.connectNodes({
          source: sourceId,
          target: targetId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        });
      });
      lastEdgeRef.current = (lastEdgeRef.current ?? -1) + newEdgesInObject.length;
    }
  }, [editing, nodeHandlers, nodeSchemas, object]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="w-full" disabled={editing === null} variant="outline">
          <div className="flex h-full w-full items-center justify-center gap-3">
            Generate with AI <Sparkles className="size-3.5" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Generate with AI</PopoverTitle>
        </PopoverHeader>
        <div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              resetRefs();
              submit({ description });
            }}
          >
            <Input
              name="description"
              placeholder="Describe the workflow you want to create..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
            <Button
              className="mt-2 flex w-full items-center justify-center gap-2"
              disabled={isLoading}
              type="submit"
              variant="outline"
            >
              {isLoading ? <Loader className="size-3.5 animate-spin" /> : null}
              {isLoading ? 'Generating...' : 'Generate'}
            </Button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default GenerateWithAIButton;
