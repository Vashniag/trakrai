import type React from 'react';

import { parseSchemaOrThrow, toEventSchemaLike } from './schema-utils';

import type {
  DependencyMode,
  MaybePromise,
  NodeAddedCallbackArgs,
  NodeEventSchemaLike,
  NodeExecutionArgs,
  NodeOutput,
  NodeRemovedCallbackArgs,
  NodeSchemaLike,
  NodeSchemaResolutionContext,
  NodeUpdatedCallbackArgs,
  RuntimeNodeFunction,
} from './types';
import type { JsonObject, NodeConfigurationField, NodeSchema } from '../../types';
import type { z } from 'zod';

/**
 * Abstract base class for custom node type handlers.
 *
 * Subclass this to define dynamic schema resolution, custom execution logic,
 * and lifecycle callbacks (onNodeAdded/Removed/Updated) for a node type.
 * `createNodeRuntime` prefers a registered handler over the static `NodeSchema`
 * registry, so handlers are the extension point for graph-aware behaviour.
 */
export abstract class WorkflowNodeHandler<Context extends object> {
  /** Returns the input schema for this node given the current graph context. */
  abstract getInputSchema(context: NodeSchemaResolutionContext): NodeSchemaLike | undefined;
  /** Returns the output schema for this node given the current graph context. */
  abstract getOutputSchema(context: NodeSchemaResolutionContext): NodeSchemaLike | undefined;

  /** Returns event schemas emitted by this node, if any. */
  getEvents(
    _context: NodeSchemaResolutionContext,
  ): Record<string, NodeEventSchemaLike> | undefined {
    return undefined;
  }

  /** Returns the display category for this node type. */
  getCategory(_context: NodeSchemaResolutionContext): string | undefined {
    return undefined;
  }

  /** Returns a human-readable description for this node type. */
  getDescription(_context: NodeSchemaResolutionContext): string | undefined {
    return undefined;
  }

  /** Returns configuration field descriptors shown in the node sidebar. */
  getConfigurationFields(
    _context: NodeSchemaResolutionContext,
  ): NodeConfigurationField[] | undefined {
    return undefined;
  }

  /** Returns the dependency wait mode (`'all'` or `'any'`) for execution scheduling. */
  getDependencyMode(_context: NodeSchemaResolutionContext): DependencyMode {
    return 'all';
  }

  /** Returns a custom React component for rendering this node inside the canvas. */
  getRenderer?(): React.ComponentType<{ nodeId: string }>;

  /**
   * Executes the node's logic with the given input/context.
   *
   * The base implementation always throws so subclasses must either override
   * this method or provide a separate runtime function through `createNodeRuntime`.
   */
  execute(_args: NodeExecutionArgs<Context>): MaybePromise<NodeOutput> {
    throw new Error('Node execution is not implemented for this node type');
  }

  /** Lifecycle callback invoked when a node of this type is added to the graph. */
  onNodeAdded<ExtraContext extends JsonObject = JsonObject>(
    _args: NodeAddedCallbackArgs<ExtraContext>,
  ): MaybePromise<void> {}

  /** Lifecycle callback invoked when a node of this type is removed from the graph. */
  onNodeRemoved<ExtraContext extends JsonObject = JsonObject>(
    _args: NodeRemovedCallbackArgs<ExtraContext>,
  ): MaybePromise<void> {}

  /** Lifecycle callback invoked when a node of this type is updated in the graph. */
  onNodeUpdated<ExtraContext extends JsonObject = JsonObject>(
    _args: NodeUpdatedCallbackArgs<ExtraContext>,
  ): MaybePromise<void> {}
}

/**
 * Default node handler backed by a static {@link NodeSchema} and an optional runtime function.
 *
 * Used automatically by `createNodeRuntime` for node types that do not provide
 * a custom `WorkflowNodeHandler`. It validates input before execution and
 * validates output before returning so static schema definitions stay enforced
 * at runtime.
 */
export class BasicInputOutputNodeHandler<
  Context extends object,
> extends WorkflowNodeHandler<Context> {
  private readonly nodeSchema: NodeSchema;
  private readonly nodeFunction?: RuntimeNodeFunction<Context>;

  constructor(nodeSchema: NodeSchema, nodeFunction?: RuntimeNodeFunction<Context>) {
    super();
    this.nodeSchema = nodeSchema;
    this.nodeFunction = nodeFunction;
  }

  override getInputSchema(): z.ZodObject {
    return this.nodeSchema.input;
  }

  override getOutputSchema(): z.ZodObject {
    return this.nodeSchema.output;
  }

  override getEvents(): Record<string, NodeEventSchemaLike> | undefined {
    return toEventSchemaLike(this.nodeSchema.events);
  }

  override getCategory(): string {
    return this.nodeSchema.category;
  }

  override getDescription(): string {
    return this.nodeSchema.description;
  }

  override async execute(args: NodeExecutionArgs<Context>): Promise<NodeOutput> {
    if (this.nodeFunction === undefined) {
      throw new Error(
        `Node function is not defined for node type '${args.node.type ?? 'unknown'}'`,
      );
    }
    const parsedInput = parseSchemaOrThrow(this.nodeSchema.input, args.input, 'Invalid input');
    const output = await this.nodeFunction(
      parsedInput as NodeOutput,
      args.context,
      args.events,
      args.logger,
      args.node,
    );
    return parseSchemaOrThrow<NodeOutput>(this.nodeSchema.output, output, 'Invalid output');
  }
}
