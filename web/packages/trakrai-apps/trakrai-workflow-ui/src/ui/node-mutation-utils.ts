import equal from 'fast-deep-equal';

import type {
  JsonObject,
  Node,
  NodeHandlerRegistry,
  WorkflowData,
  NodeMutationCallbackContext,
} from '@trakrai-workflow/core';

/**
 * Discriminated union representing a single node change between two workflow snapshots.
 *
 * - `'added'`: Node exists in the current data but not in the previous.
 * - `'removed'`: Node exists in the previous data but not in the current (or type changed).
 * - `'updated'`: Node exists in both but its `data` property changed.
 */
type NodeMutation =
  | {
      type: 'added';
      node: Node;
    }
  | {
      type: 'removed';
      node: Node;
    }
  | {
      type: 'updated';
      node: Node;
      /** The node state before the update. */
      previousNode: Node;
    };

/**
 * Detects added, removed, and updated nodes by comparing two workflow snapshots.
 *
 * A node is considered "removed" if it exists in the previous data but not in the current
 * (or its type changed). A node is "added" if it exists in the current but not the previous.
 * A node is "updated" if its `data` changed (position-only changes are ignored).
 *
 * @param previousWorkflowData - The previous workflow state.
 * @param currentWorkflowData - The current workflow state.
 * @returns An array of node mutations.
 */
export const getNodeMutations = (
  previousWorkflowData: WorkflowData,
  currentWorkflowData: WorkflowData,
): NodeMutation[] => {
  const previousNodesById = new Map(previousWorkflowData.nodes.map((node) => [node.id, node]));
  const currentNodesById = new Map(currentWorkflowData.nodes.map((node) => [node.id, node]));
  const mutations: NodeMutation[] = [];

  for (const previousNode of previousWorkflowData.nodes) {
    const currentNode = currentNodesById.get(previousNode.id);
    if (currentNode === undefined || previousNode.type !== currentNode.type) {
      mutations.push({
        type: 'removed',
        node: previousNode,
      });
    }
  }

  for (const currentNode of currentWorkflowData.nodes) {
    const previousNode = previousNodesById.get(currentNode.id);
    if (previousNode === undefined || previousNode.type !== currentNode.type) {
      mutations.push({
        type: 'added',
        node: currentNode,
      });
      continue;
    }
    if (!equal(previousNode.data, currentNode.data)) {
      mutations.push({
        type: 'updated',
        node: currentNode,
        previousNode,
      });
    }
  }

  return mutations;
};

/**
 * Dispatches lifecycle callbacks (onNodeAdded, onNodeRemoved, onNodeUpdated) to
 * registered node handlers for each detected mutation.
 *
 * Compares the previous and current workflow data, then calls the appropriate
 * handler method for each mutation sequentially.
 *
 * @typeParam Context - Application-specific context type.
 * @typeParam ExtraContext - Additional serializable data.
 * @param options.nodeHandlers - Optional registry of node handlers with lifecycle callbacks.
 */
export const dispatchNodeMutationCallbacks = async <
  Context extends object,
  ExtraContext extends JsonObject = JsonObject,
>({
  nodeHandlers,
  ...rest
}: {
  nodeHandlers?: NodeHandlerRegistry<Context>;
} & NodeMutationCallbackContext<ExtraContext>): Promise<void> => {
  if (nodeHandlers === undefined) {
    return;
  }

  const mutations = getNodeMutations(rest.previousWorkflowData, rest.currentWorkflowData);
  if (mutations.length === 0) {
    return;
  }

  for (const mutation of mutations) {
    if (mutation.node.type === undefined) {
      continue;
    }

    const handler = nodeHandlers[mutation.node.type];
    if (handler === undefined) {
      continue;
    }

    if (mutation.type === 'added') {
      await handler.onNodeAdded({
        ...rest,
        node: mutation.node,
      });
      continue;
    }

    if (mutation.type === 'removed') {
      await handler.onNodeRemoved({
        ...rest,
        node: mutation.node,
      });
      continue;
    }

    await handler.onNodeUpdated({
      ...rest,
      node: mutation.node,
      previousNode: mutation.previousNode,
    });
  }
};
