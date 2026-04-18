'use client';

import { Label } from '@trakrai/design-system/components/label';
import { jsonSchemaToTypeString } from '@trakrai-workflow/core';

import type { EventOption } from './types';
import type { FluxerySpecialFieldRendererProps, FluxerySpecialFields } from '@trakrai-workflow/ui';

const EventTriggerSelectorField = ({
  value,
  onChange,
  context,
}: FluxerySpecialFieldRendererProps) => {
  const fieldConfig = context?.field?.fieldConfig;
  const options = (fieldConfig?.eventOptions ?? []) as EventOption[];
  const stringValue = typeof value === 'string' ? value : '';
  const selectedOption =
    options.find((option) => option.value === stringValue) ?? options[0] ?? undefined;

  return (
    <>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events have been configured yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="space-y-2">
            {options.map((option) => {
              const isSelected = option.value === selectedOption?.value;
              return (
                <button
                  key={option.value}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/40 hover:bg-muted/40'
                  }`}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                  }}
                >
                  <div className="font-medium">{option.label ?? option.value}</div>
                  <div className="text-muted-foreground mt-1 text-xs">{option.value}</div>
                  {option.description === undefined ? null : (
                    <p className="text-muted-foreground mt-2 text-sm">{option.description}</p>
                  )}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Payload Type</Label>
            <pre className="bg-muted overflow-x-auto rounded-md border p-3 text-xs leading-5">
              {`type EventPayload = ${jsonSchemaToTypeString(
                selectedOption?.dataSchema ?? {
                  type: 'object',
                  properties: {},
                  additionalProperties: false,
                },
              )};`}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Special field registration for selecting one of the app-defined event trigger definitions and
 * previewing its payload shape.
 */
export const eventTriggerSpecialField = {
  eventTriggerSelector: {
    type: 'editor',
    component: EventTriggerSelectorField,
    display: 'dialog',
    dialogTitle: 'Event Trigger Selector',
    dialogDescription:
      'Select the app event this trigger listens to and inspect the emitted payload shape.',
  },
} satisfies FluxerySpecialFields;
