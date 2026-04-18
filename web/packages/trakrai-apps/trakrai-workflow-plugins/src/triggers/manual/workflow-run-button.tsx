'use client';

import { useMemo, useState, type ComponentProps } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@trakrai/design-system/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@trakrai/design-system/components/dialog';
import { safeParseSchema, type PluginClientConfig, type JsonObject } from '@trakrai-workflow/core';
import {
  JsonSchemaObjectForm,
  PluginTRPCProvider,
  useTRPCPluginAPIs,
  type FluxeryConfigRecord,
} from '@trakrai-workflow/ui';
import { ArrowLeft, Play } from 'lucide-react';

import type { ManualTriggerPlugin } from './manual-trigger-api';
import type { z } from 'zod';

type ManualTriggerDefinition = {
  nodeId: string;
  payloadSchema: z.core.JSONSchema._JSONSchema | null;
};

type WorkflowRunButtonProps<TriggerContext extends JsonObject> = {
  triggerContext: TriggerContext;
  pluginContext: PluginClientConfig;
  label?: string;
  onRunError?: (error: Error) => void;
  onRunSuccess?: (eventId: string) => void;
} & Omit<ComponentProps<typeof Button>, 'children' | 'onClick'>;

const MANUAL_TRIGGER_URL_PATH = '/trigger/manual';
const EMPTY_MANUAL_TRIGGERS: ManualTriggerDefinition[] = [];
const EMPTY_PAYLOAD: FluxeryConfigRecord = {};

const isEmptyPayload = (value: FluxeryConfigRecord): boolean => {
  return Object.keys(value).length === 0;
};

const getTriggerLabel = (trigger: ManualTriggerDefinition, index: number): string => {
  const { payloadSchema } = trigger;
  if (
    payloadSchema !== null &&
    typeof payloadSchema === 'object' &&
    !Array.isArray(payloadSchema) &&
    typeof payloadSchema.title === 'string' &&
    payloadSchema.title.length > 0
  ) {
    return payloadSchema.title;
  }

  return `Manual Trigger ${index + 1}`;
};

const getTriggerDescription = (trigger: ManualTriggerDefinition): string => {
  const { payloadSchema } = trigger;
  if (
    payloadSchema !== null &&
    typeof payloadSchema === 'object' &&
    !Array.isArray(payloadSchema) &&
    typeof payloadSchema.description === 'string' &&
    payloadSchema.description.length > 0
  ) {
    return payloadSchema.description;
  }

  return `Node ID: ${trigger.nodeId}`;
};

const WorkflowRunButtonInner = <TriggerContext extends JsonObject>({
  triggerContext,
  pluginContext,
  label = 'Run',
  onRunError,
  onRunSuccess,
  disabled,
  ...buttonProps
}: WorkflowRunButtonProps<TriggerContext>) => {
  const { client: trpc } = useTRPCPluginAPIs<ManualTriggerPlugin>('manual-trigger');
  const [open, setOpen] = useState(false);
  const [selectedTriggerNodeId, setSelectedTriggerNodeId] = useState<string | null>(null);
  const [payload, setPayload] = useState<FluxeryConfigRecord>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const listTriggersQueryOptions = trpc.listTriggers.queryOptions({ context: triggerContext });
  const { data: rawManualTriggers = EMPTY_MANUAL_TRIGGERS, isLoading } =
    useQuery(listTriggersQueryOptions);

  const manualTriggers = useMemo(
    () =>
      [...rawManualTriggers].sort((left, right) => {
        return left.nodeId.localeCompare(right.nodeId);
      }),
    [rawManualTriggers],
  );

  const selectedTrigger = useMemo(() => {
    const effectiveNodeId =
      selectedTriggerNodeId ??
      (manualTriggers.length === 1 ? (manualTriggers[0]?.nodeId ?? null) : null);
    return manualTriggers.find((trigger) => trigger.nodeId === effectiveNodeId) ?? null;
  }, [manualTriggers, selectedTriggerNodeId]);

  const resetDialogState = () => {
    setPayload((current) => {
      return isEmptyPayload(current) ? current : EMPTY_PAYLOAD;
    });
    setErrorMessage((current) => {
      return current === null ? current : null;
    });
  };

  const manualTriggerUrl = useMemo(() => {
    return new URL(
      `${pluginContext.endpoint}${MANUAL_TRIGGER_URL_PATH}`,
      pluginContext.baseUrl,
    ).toString();
  }, [pluginContext.baseUrl, pluginContext.endpoint]);

  const runWorkflow = async (nodeId?: string, runData?: Record<string, unknown>) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(manualTriggerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: triggerContext,
          nodeId,
          data: runData,
        }),
      });

      const responseJson = (await response.json()) as {
        error?: string;
        eventId?: string;
      };

      if (!response.ok || responseJson.eventId === undefined) {
        throw new Error(responseJson.error ?? 'Failed to run workflow');
      }

      setOpen(false);
      setSelectedTriggerNodeId(null);
      resetDialogState();
      onRunSuccess?.(responseJson.eventId);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error));
      setErrorMessage(nextError.message);
      onRunError?.(nextError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunClick = async () => {
    if (manualTriggers.length === 0) {
      await runWorkflow();
      return;
    }

    setSelectedTriggerNodeId(
      manualTriggers.length === 1 ? (manualTriggers[0]?.nodeId ?? null) : null,
    );
    resetDialogState();
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (selectedTrigger === null) {
      return;
    }

    const { payloadSchema } = selectedTrigger;
    let parsedPayload = payload as Record<string, unknown>;

    if (payloadSchema !== null) {
      const parsed = safeParseSchema(payloadSchema, payload);
      if (!parsed.success) {
        setErrorMessage(parsed.error);
        return;
      }

      parsedPayload = parsed.data as Record<string, unknown>;
    }

    await runWorkflow(selectedTrigger.nodeId, parsedPayload);
  };

  return (
    <>
      <Button
        {...buttonProps}
        disabled={(disabled ?? false) || isLoading || isSubmitting}
        onClick={() => {
          void handleRunClick();
        }}
      >
        <Play className="mr-2 size-4" />
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSelectedTriggerNodeId(null);
            resetDialogState();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedTrigger === null && manualTriggers.length > 1
                ? 'Select Manual Trigger'
                : 'Run Workflow'}
            </DialogTitle>
            <DialogDescription>
              {selectedTrigger === null && manualTriggers.length > 1
                ? 'Choose which manual trigger to run.'
                : 'Provide the payload for the selected manual trigger and start the workflow.'}
            </DialogDescription>
          </DialogHeader>
          {selectedTrigger === null && manualTriggers.length > 1 ? (
            <div className="space-y-3">
              {manualTriggers.map((trigger, index) => (
                <button
                  key={trigger.nodeId}
                  aria-label={`Select ${getTriggerLabel(trigger, index)}`}
                  className="hover:border-primary/40 hover:bg-muted/40 w-full rounded-md border p-3 text-left transition-colors"
                  type="button"
                  onClick={() => {
                    setSelectedTriggerNodeId(trigger.nodeId);
                    resetDialogState();
                  }}
                >
                  <div className="font-medium">{getTriggerLabel(trigger, index)}</div>
                  <div className="text-muted-foreground mt-1 text-xs">{trigger.nodeId}</div>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {getTriggerDescription(trigger)}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {manualTriggers.length > 1 && selectedTrigger !== null ? (
                <Button
                  className="w-fit"
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSelectedTriggerNodeId(null);
                    resetDialogState();
                  }}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Back To Trigger List
                </Button>
              ) : null}
              <JsonSchemaObjectForm
                schema={selectedTrigger?.payloadSchema}
                value={payload}
                onChange={setPayload}
              />
              {errorMessage === null ? null : (
                <p className="text-destructive text-sm">{errorMessage}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setSelectedTriggerNodeId(null);
                resetDialogState();
              }}
            >
              Cancel
            </Button>
            {selectedTrigger === null && manualTriggers.length > 1 ? null : (
              <Button
                disabled={isSubmitting || selectedTrigger === null}
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
              >
                {isSubmitting ? 'Running...' : 'Run Workflow'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/**
 * Client-side button for listing persisted manual trigger nodes and dispatching a run through the
 * `/trigger/manual` endpoint.
 *
 * The component wraps itself in `PluginTRPCProvider`, so callers only need to pass the plugin client
 * config and the trigger context expected by the host app's manual trigger integration.
 */
export const WorkflowRunButton = <TriggerContext extends JsonObject>(
  props: WorkflowRunButtonProps<TriggerContext>,
) => {
  const queryClient = useQueryClient();

  return (
    <PluginTRPCProvider pluginContext={props.pluginContext} queryClient={queryClient}>
      <WorkflowRunButtonInner {...props} />
    </PluginTRPCProvider>
  );
};
