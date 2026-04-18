'use client';

import { useMemo } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { Label } from '@trakrai/design-system/components/label';
import {
  getNodeConfiguration,
  TriggerHandle,
  type Edge,
  type Node,
  type NodeConfigurationField,
} from '@trakrai-workflow/core';
import { createDisplayName } from '@trakrai-workflow/core/utils';
import { X } from 'lucide-react';

import {
  ArrayField,
  getDefaultValue,
  RegularField,
  SpecialFieldInput,
  type FieldValue,
  isFieldObject,
} from './form-fields';

import type { FluxeryConfigRecord, FluxerySpecialFields } from '../../flow-types';
import type { z } from 'zod';

import { useFlow } from '../../flow-context';

/**
 * Renders the full configuration panel for a selected node.
 *
 * Displays handler-defined configuration fields, edge-connected inputs (with
 * disconnect buttons), configured inputs (editable), and unconfigured inputs
 * (with a button to add them). Handles array and special field types.
 *
 * @param nodeData - The currently selected node.
 * @param allInputs - All input entries (name + schema) for the node.
 * @param nodeEdges - Edges connected to/from the selected node.
 * @param configurationFields - Handler-defined configuration field definitions.
 * @param isReadOnly - Whether the editor is in read-only mode.
 * @param onDeleteEdge - Callback to remove an edge by ID.
 * @param onReplaceNode - Callback to replace a node with an updated version.
 * @param specialFields - Optional registry of special field configurations.
 */
export const ConfigurationSection = ({
  nodeData,
  allInputs,
  nodeEdges,
  configurationFields,
  isReadOnly,
  onDeleteEdge,
  onReplaceNode,
  specialFields,
}: {
  nodeData: Node;
  allInputs: [string, z.core.JSONSchema._JSONSchema][];
  nodeEdges: Edge[];
  configurationFields: NodeConfigurationField[];
  isReadOnly: boolean;
  onDeleteEdge: (edgeId: string) => void;
  onReplaceNode: (nodeId: string, node: Node) => void;
  specialFields?: FluxerySpecialFields;
}) => {
  const { theme } = useFlow();
  const nodeConfiguration = useMemo<FluxeryConfigRecord>(() => {
    const configuration = getNodeConfiguration(nodeData);
    return isFieldObject(configuration) ? configuration : {};
  }, [nodeData]);
  const incomingEdgesByInput = useMemo(() => {
    const edgesByInput = new Map<string, Edge[]>();
    for (const edge of nodeEdges) {
      if (
        edge.target !== nodeData.id ||
        edge.targetHandle === undefined ||
        edge.targetHandle === null ||
        edge.targetHandle === '' ||
        edge.targetHandle === TriggerHandle
      ) {
        continue;
      }
      const existing = edgesByInput.get(edge.targetHandle) ?? [];
      existing.push(edge);
      edgesByInput.set(edge.targetHandle, existing);
    }
    return edgesByInput;
  }, [nodeData.id, nodeEdges]);

  const updateConfiguration = (updater: (config: FluxeryConfigRecord) => FluxeryConfigRecord) => {
    if (isReadOnly) {
      return;
    }
    const updatedNode: Node = {
      ...nodeData,
      data: {
        ...nodeData.data,
        configuration: updater(nodeConfiguration),
      },
    };
    onReplaceNode(nodeData.id, updatedNode);
  };

  const updateFieldValue = (fieldName: string, value: FieldValue | undefined) => {
    updateConfiguration((prev) => ({ ...prev, [fieldName]: value }));
  };

  const removeField = (fieldName: string) => {
    updateConfiguration((prev) => {
      const { [fieldName]: _, ...newData } = prev;
      return newData;
    });
  };

  const addField = (fieldName: string, fieldSchema: z.core.JSONSchema._JSONSchema) => {
    if (typeof fieldSchema !== 'object' || Array.isArray(fieldSchema)) {
      return;
    }

    const defaultValue = getDefaultValue(fieldSchema.type);

    updateConfiguration((prev) => ({ ...prev, [fieldName]: defaultValue }));
  };

  const updateArrayItem = (fieldName: string, index: number, value: FieldValue | undefined) => {
    updateConfiguration((prev) => {
      const currentArray = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
      const newArray = [...currentArray];
      newArray[index] = value ?? '';
      return { ...prev, [fieldName]: newArray };
    });
  };

  const addArrayItem = (fieldName: string, itemType: string | undefined) => {
    updateConfiguration((prev) => {
      const currentArray = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
      const defaultValue = getDefaultValue(itemType);
      return { ...prev, [fieldName]: [...currentArray, defaultValue] };
    });
  };

  const deleteArrayItem = (fieldName: string, index: number) => {
    updateConfiguration((prev) => {
      const currentArray = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
      const newArray = currentArray.filter((_, i) => i !== index);
      return { ...prev, [fieldName]: newArray };
    });
  };
  const removeConnectedInput = (propName: string, edges: Edge[]) => {
    if (isReadOnly) {
      return;
    }
    if (propName in nodeConfiguration) {
      removeField(propName);
    }
    edges.forEach((edge) => {
      onDeleteEdge(edge.id);
    });
  };

  const renderField = (propName: string, propSchema: z.core.JSONSchema.JSONSchema) => {
    const value = nodeConfiguration[propName];

    if (propSchema.type === 'array') {
      const arrayValue = Array.isArray(value) ? value : [];
      const itemsSchema = propSchema.items;
      if (
        itemsSchema === undefined ||
        Array.isArray(itemsSchema) ||
        typeof itemsSchema !== 'object'
      ) {
        return null;
      }
      return (
        <ArrayField
          key={propName}
          context={{
            configuration: nodeConfiguration,
            node: nodeData,
            schema: propSchema,
            theme,
          }}
          description={propSchema.description}
          disabled={isReadOnly}
          propName={propName}
          schema={itemsSchema}
          specialFields={specialFields}
          value={arrayValue}
          onFieldRemove={() => {
            removeField(propName);
          }}
          onItemAdd={() => {
            addArrayItem(propName, itemsSchema.type);
          }}
          onItemChange={(index, newValue) => {
            updateArrayItem(propName, index, newValue);
          }}
          onItemDelete={(index) => {
            deleteArrayItem(propName, index);
          }}
        />
      );
    }

    return (
      <RegularField
        key={propName}
        context={{
          configuration: nodeConfiguration,
          node: nodeData,
          schema: propSchema,
          theme,
        }}
        disabled={isReadOnly}
        propName={propName}
        schema={propSchema}
        specialFields={specialFields}
        value={value}
        onChange={(newValue) => {
          updateFieldValue(propName, newValue);
        }}
        onFieldRemove={() => {
          removeField(propName);
        }}
      />
    );
  };

  const renderHandlerField = (field: NodeConfigurationField) => {
    const value = nodeConfiguration[field.key];
    const specialFieldKey = field.field;
    const specialFieldConfig = specialFields?.[specialFieldKey ?? ''];
    return (
      <div key={`handler-${field.key}`} className="space-y-2 border p-3">
        <Label className="text-xs font-semibold">{field.label}</Label>
        {field.description === undefined ? null : (
          <p className="text-muted-foreground text-xs">{field.description}</p>
        )}
        {specialFieldKey === undefined ||
        specialFieldKey === '' ||
        specialFieldConfig === undefined ? (
          <p className="text-muted-foreground text-xs">
            Special field `{specialFieldKey}` is not configured.
          </p>
        ) : (
          <SpecialFieldInput
            context={{
              field,
              configuration: nodeConfiguration,
              node: nodeData,
              theme,
            }}
            disabled={isReadOnly}
            label={field.label}
            specialField={specialFieldKey}
            specialFields={specialFields}
            value={value}
            onChange={(nextValue) => {
              updateFieldValue(field.key, nextValue as FieldValue | undefined);
            }}
          />
        )}
      </div>
    );
  };

  const renderConnectedInput = (propName: string, connectedEdges: Edge[]) => {
    const readableTitle = createDisplayName(propName);
    const connectedSources = Array.from(
      new Set(
        connectedEdges.map((edge) => {
          if (
            edge.sourceHandle === undefined ||
            edge.sourceHandle === null ||
            edge.sourceHandle === ''
          ) {
            return edge.source;
          }
          return `${edge.source}.${edge.sourceHandle}`;
        }),
      ),
    );

    return (
      <div key={propName} className="space-y-2 border p-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{readableTitle}</span>
            <span className="text-muted-foreground text-xs">
              Connected from: {connectedSources.join(', ')}
            </span>
          </div>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              removeConnectedInput(propName, connectedEdges);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderUnconfiguredInput = (propName: string, propSchema: z.core.JSONSchema.JSONSchema) => {
    const readableTitle = createDisplayName(propName);
    const description =
      typeof propSchema.description === 'string' ? String(propSchema.description) : undefined;
    return (
      <Button
        key={propName}
        className="h-auto w-full justify-start border-dashed px-3 py-3 text-left"
        disabled={isReadOnly}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => {
          addField(propName, propSchema);
        }}
      >
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium">{readableTitle}</span>
          <span className="text-muted-foreground text-xs">Unconfigured. Click to configure.</span>
          {description === undefined ? null : (
            <span className="text-muted-foreground text-xs">{description}</span>
          )}
        </div>
      </Button>
    );
  };

  const renderedHandlerFields = configurationFields.map(renderHandlerField);
  const renderedInputs = allInputs.map(([propName, propSchema]) => {
    if (typeof propSchema !== 'object' || Array.isArray(propSchema)) {
      return null;
    }
    const connectedEdges = incomingEdgesByInput.get(propName) ?? [];
    if (connectedEdges.length > 0) {
      return renderConnectedInput(propName, connectedEdges);
    }
    if (propName in nodeConfiguration) {
      return renderField(propName, propSchema);
    }
    return renderUnconfiguredInput(propName, propSchema);
  });

  const renderedItems = [...renderedHandlerFields, ...renderedInputs];
  const hasRenderableItems = renderedItems.some((item) => item !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Configuration</h3>
      </div>
      {!hasRenderableItems ? (
        <div className="border border-dashed p-4 text-center">
          <p className="text-muted-foreground text-sm">No configuration available for this node.</p>
        </div>
      ) : (
        <div className="space-y-2">{renderedItems}</div>
      )}
    </div>
  );
};
