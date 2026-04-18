'use client';

import { useMemo, useRef, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@trakrai/design-system/components/dialog';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trakrai/design-system/components/select';
import { Textarea } from '@trakrai/design-system/components/textarea';
import { cn } from '@trakrai/design-system/lib/utils';
import { createDisplayName } from '@trakrai-workflow/core/utils';
import { Plus, Trash2, X } from 'lucide-react';

import type {
  FluxeryConfigRecord,
  FluxeryConfigValue,
  FluxerySpecialFieldContext,
  FluxerySpecialFields,
} from '../../flow-types';
import type { z } from 'zod';

type JSONSchema = z.core.JSONSchema.JSONSchema;

/** Alias for {@link FluxeryConfigValue}. Represents a value in a form field. */
export type FieldValue = FluxeryConfigValue;

const getStringValue = (value: FluxeryConfigValue | undefined): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
};

/**
 * Type guard that checks if a value is a non-null, non-array object.
 *
 * @param value - The value to check.
 * @returns `true` if the value is a plain object (i.e. a `FluxeryConfigRecord`).
 */
export const isFieldObject = (value: unknown): value is FluxeryConfigRecord =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);

/**
 * Returns a sensible default value for a given JSON schema type.
 *
 * @param type - The JSON schema type string (e.g. `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`).
 * @returns The default value: `''` for strings, `0` for numbers, `false` for booleans, `[]` for arrays, `{}` for objects.
 */
export const getDefaultValue = (type: string | undefined): FieldValue => {
  switch (type) {
    case undefined:
      return '';
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'number':
    case 'integer':
      return 0;
    case 'object':
      return {};
    default:
      return '';
  }
};

const stringifyObjectValue = (value: FluxeryConfigValue | undefined) =>
  JSON.stringify(isFieldObject(value) ? value : {}, null, 2);

const FormFieldContainer = ({
  title,
  description,
  disabled = false,
  onRemove,
  actions,
  children,
}: {
  title: string;
  description?: string;
  disabled?: boolean;
  onRemove?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="space-y-2 border p-3">
    <div className="flex items-center justify-between gap-2">
      <Label>{title}</Label>
      <div className="flex items-center gap-2">
        {actions}
        {onRemove === undefined ? null : (
          <Button disabled={disabled} size="sm" type="button" variant="ghost" onClick={onRemove}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
    {children}
    {description === undefined ? null : (
      <p className="text-muted-foreground text-xs">{description}</p>
    )}
  </div>
);

const StringInput = ({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: FluxeryConfigValue | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) => (
  <Input
    disabled={disabled}
    placeholder={placeholder ?? 'Enter value'}
    type="text"
    value={typeof value === 'string' ? value : ''}
    onChange={(event) => {
      onChange(event.target.value);
    }}
  />
);

const NumberInput = ({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: FluxeryConfigValue | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) => (
  <Input
    disabled={disabled}
    placeholder={placeholder ?? 'Enter number'}
    type="number"
    value={typeof value === 'number' ? value : ''}
    onChange={(event) => {
      const parsed = Number.parseFloat(event.target.value);
      onChange(Number.isNaN(parsed) ? 0 : parsed);
    }}
  />
);

const BooleanInput = ({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: FluxeryConfigValue | undefined;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) => (
  <div className="flex items-center space-x-2">
    <Checkbox
      checked={value === true}
      disabled={disabled}
      onCheckedChange={(checked) => {
        onChange(checked === true);
      }}
    />
    <Label>{label ?? 'Boolean value'}</Label>
  </div>
);

const ObjectInput = ({
  value,
  onChange,
  disabled = false,
}: {
  value: FluxeryConfigValue | undefined;
  onChange: (value: FluxeryConfigRecord) => void;
  disabled?: boolean;
}) => {
  const [draft, setDraft] = useState(() => stringifyObjectValue(value));

  return (
    <Textarea
      className="font-mono text-sm"
      disabled={disabled}
      placeholder={'{\n  "key": "value"\n}'}
      rows={4}
      value={draft}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        try {
          const parsed = JSON.parse(nextDraft) as unknown;
          if (isFieldObject(parsed)) {
            onChange(parsed);
          }
        } catch {
          // Keep the draft visible while the user is mid-edit.
        }
      }}
    />
  );
};

const SelectField = ({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  options: Record<string, string>;
  value: FluxeryConfigValue | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) => {
  const selectedValue = typeof value === 'string' && value !== '' ? value : undefined;

  return (
    <Select disabled={disabled} value={selectedValue} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? 'Select an option...'} />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([key, label]) => (
          <SelectItem key={key} value={label}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

type SpecialFieldProps = {
  schema?: JSONSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  specialField: string;
  specialFields?: FluxerySpecialFields;
  context?: FluxerySpecialFieldContext;
  label?: string;
  disabled?: boolean;
};

const SpecialEditorField = ({
  config,
  disabled = false,
  ...props
}: SpecialFieldProps & {
  config: Extract<FluxerySpecialFields[string], { type: 'editor' }>;
}) => {
  const [open, setOpen] = useState(false);
  const EditorComponent = config.component;
  if (config.display !== 'dialog') {
    return (
      <EditorComponent context={props.context} value={props.value} onChange={props.onChange} />
    );
  }

  const title = config.dialogTitle ?? `Edit ${props.label ?? 'Value'}`;
  const description = config.dialogDescription ?? props.schema?.description;
  let dialogSizeClassName = 'max-h-[85vh] max-w-4xl sm:max-w-4xl';
  if (config.dialogSize === 'fullscreen') {
    dialogSizeClassName =
      'h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)]';
  } else if (config.dialogSize === 'large') {
    dialogSizeClassName = 'h-[90vh] max-h-[90vh] w-[96vw] max-w-[96vw] sm:max-w-[96vw]';
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full justify-start"
          disabled={disabled}
          size="sm"
          type="button"
          variant="outline"
        >
          {`Edit ${props.label ?? 'Value'}`}
        </Button>
      </DialogTrigger>
      <DialogContent className={cn('flex flex-col gap-3 overflow-hidden', dialogSizeClassName)}>
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <EditorComponent context={props.context} value={props.value} onChange={props.onChange} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Renders a special field input based on the special field configuration.
 *
 * Supports two modes: `'options'` renders a select dropdown, and `'editor'`
 * renders a custom editor component (inline or in a dialog). Unknown field keys
 * intentionally render nothing so schema authors can opt into special fields
 * without breaking consumers that have not registered the corresponding renderer.
 *
 * @param specialFields - Registry of special field configurations.
 * @param specialField - The key identifying which special field config to use.
 * @param context - Contextual data (node, schema, configuration) passed to the renderer.
 * @param disabled - Whether the field is disabled. Defaults to `false`.
 */
export const SpecialFieldInput = ({
  specialFields,
  specialField,
  context,
  disabled = false,
  ...props
}: SpecialFieldProps) => {
  if (specialFields === undefined) {
    return null;
  }

  const specialFieldConfig = specialFields[specialField];
  if (specialFieldConfig === undefined) {
    return null;
  }

  if (specialFieldConfig.type === 'options') {
    const options =
      typeof specialFieldConfig.options === 'function'
        ? specialFieldConfig.options(context)
        : specialFieldConfig.options;
    return (
      <SelectField
        disabled={disabled}
        options={options}
        value={typeof props.value === 'string' ? props.value : undefined}
        onChange={(nextValue) => {
          props.onChange(nextValue);
        }}
      />
    );
  }

  return (
    <SpecialEditorField
      {...props}
      config={specialFieldConfig}
      context={context}
      disabled={disabled}
      specialField={specialField}
    />
  );
};

const InputField = ({
  schema,
  value,
  onChange,
  placeholder,
  label,
  specialFields,
  context,
  disabled = false,
}: {
  schema: JSONSchema;
  value: FluxeryConfigValue | undefined;
  onChange: (value: FluxeryConfigValue | undefined) => void;
  placeholder?: string;
  label?: string;
  specialFields?: FluxerySpecialFields;
  context?: FluxerySpecialFieldContext;
  disabled?: boolean;
}) => {
  if (
    'specialField' in schema &&
    typeof schema.specialField === 'string' &&
    schema.specialField !== ''
  ) {
    return (
      <SpecialFieldInput
        context={context}
        disabled={disabled}
        label={label}
        schema={schema}
        specialField={schema.specialField}
        specialFields={specialFields}
        value={value}
        onChange={(nextValue) => {
          onChange(nextValue as FluxeryConfigValue | undefined);
        }}
      />
    );
  }

  if (schema.type === 'string') {
    return (
      <StringInput
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <NumberInput
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (schema.type === 'boolean') {
    return (
      <BooleanInput disabled={disabled} label={placeholder} value={value} onChange={onChange} />
    );
  }

  if (schema.type === 'object') {
    return (
      <ObjectInput
        key={stringifyObjectValue(value)}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <Input
      disabled={disabled}
      placeholder={placeholder ?? 'Enter value'}
      type="text"
      value={getStringValue(value)}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
};

/**
 * Renders an array field with add/remove item controls.
 *
 * Each array item is rendered using `InputField` derived from the item schema.
 * Provides callbacks for item-level changes, additions, and deletions. New items
 * are expected to be seeded by the caller so the field stays agnostic to schema-
 * specific defaults beyond the item editor it renders.
 *
 * @param propName - The property name used to derive the display title.
 * @param value - The current array of values.
 * @param schema - The JSON schema for individual array items.
 * @param description - Optional description text displayed below the title.
 * @param onItemChange - Callback when an item at a given index changes.
 * @param onItemAdd - Callback to add a new item.
 * @param onItemDelete - Callback to remove an item at a given index.
 * @param onFieldRemove - Optional callback to remove the entire array field.
 * @param disabled - Whether the field is disabled. Defaults to `false`.
 */
export const ArrayField = ({
  propName,
  value,
  schema,
  description,
  onItemChange,
  onItemAdd,
  onItemDelete,
  onFieldRemove,
  specialFields,
  context,
  disabled = false,
}: {
  propName: string;
  value: FluxeryConfigValue[];
  schema: JSONSchema;
  description?: string;
  onItemChange: (index: number, value: FluxeryConfigValue | undefined) => void;
  onItemAdd: () => void;
  onItemDelete: (index: number) => void;
  onFieldRemove?: () => void;
  specialFields?: FluxerySpecialFields;
  context?: FluxerySpecialFieldContext;
  disabled?: boolean;
}) => {
  const readableTitle = useMemo(
    () =>
      typeof schema.title === 'string' && schema.title.length > 0
        ? schema.title
        : createDisplayName(propName),
    [propName, schema.title],
  );
  const itemKeysRef = useRef<string[]>([]);
  if (itemKeysRef.current.length > value.length) {
    itemKeysRef.current = itemKeysRef.current.slice(0, value.length);
  }
  while (itemKeysRef.current.length < value.length) {
    itemKeysRef.current.push(crypto.randomUUID());
  }

  return (
    <FormFieldContainer
      actions={
        <Button disabled={disabled} size="sm" type="button" variant="outline" onClick={onItemAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add Item
        </Button>
      }
      description={description}
      disabled={disabled}
      title={readableTitle}
      onRemove={onFieldRemove}
    >
      <div className="space-y-2">
        {value.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No items. Click &quot;Add Item&quot; to add.
          </p>
        ) : (
          value.map((item, index) => (
            <div key={itemKeysRef.current[index]} className="flex items-start gap-2">
              <div className="flex-1">
                <InputField
                  context={context}
                  disabled={disabled}
                  label={`Item ${index + 1}`}
                  placeholder={`Item ${index + 1}`}
                  schema={schema}
                  specialFields={specialFields}
                  value={item}
                  onChange={(newValue) => {
                    onItemChange(index, newValue);
                  }}
                />
              </div>
              <Button
                disabled={disabled}
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => {
                  onItemDelete(index);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </FormFieldContainer>
  );
};

/**
 * Renders a single form field with a label, input, and optional remove button.
 *
 * Automatically selects the appropriate input type based on the JSON schema
 * (string, number, boolean, object, or special field). Schemas without a concrete
 * `type` are skipped entirely because this form renderer does not attempt to
 * interpret unions or polymorphic JSON Schema branches.
 *
 * @param propName - The property name used to derive the display title.
 * @param value - The current field value.
 * @param onChange - Callback when the field value changes.
 * @param onFieldRemove - Optional callback to remove this field from configuration.
 * @param schema - The JSON schema describing the field's type and constraints.
 * @param specialFields - Optional registry of special field configurations.
 * @param context - Optional contextual data passed to special field renderers.
 * @param disabled - Whether the field is disabled. Defaults to `false`.
 */
export const RegularField = ({
  propName,
  value,
  onChange,
  onFieldRemove,
  schema,
  specialFields,
  context,
  disabled = false,
}: {
  propName: string;
  value: FluxeryConfigValue | undefined;
  onChange: (value: FluxeryConfigValue | undefined) => void;
  onFieldRemove?: () => void;
  schema: JSONSchema;
  specialFields?: FluxerySpecialFields;
  context?: FluxerySpecialFieldContext;
  disabled?: boolean;
}) => {
  const readableTitle = useMemo(
    () =>
      typeof schema.title === 'string' && schema.title.length > 0
        ? schema.title
        : createDisplayName(propName),
    [propName, schema.title],
  );
  if (schema.type === undefined) {
    return null;
  }

  return (
    <FormFieldContainer
      description={schema.description}
      disabled={disabled}
      title={readableTitle}
      onRemove={onFieldRemove}
    >
      <InputField
        context={context}
        disabled={disabled}
        label={readableTitle}
        placeholder={`Enter ${readableTitle}`}
        schema={schema}
        specialFields={specialFields}
        value={value}
        onChange={onChange}
      />
    </FormFieldContainer>
  );
};

/**
 * Renders a complete form for a JSON schema object.
 *
 * Iterates over the schema's properties and renders each as the appropriate
 * field type (regular, array, or special). Handles add/remove/update for
 * all field types including nested arrays. The renderer is intentionally narrow:
 * it supports top-level object schemas and array item schemas that resolve to
 * object-like JSON Schema nodes, and falls back to explanatory empty states for
 * unsupported or missing payload definitions.
 *
 * @param schema - The JSON schema object definition. Must have `type: 'object'`.
 * @param value - The current configuration record.
 * @param onChange - Callback when any field value changes, receiving the updated
 * record. Field removal is represented by setting a property to `undefined`.
 * @param specialFields - Optional registry of special field configurations.
 *
 * @example
 * ```tsx
 * <JsonSchemaObjectForm
 *   schema={nodeSchema.input}
 *   value={configuration}
 *   onChange={setConfiguration}
 * />
 * ```
 */
export const JsonSchemaObjectForm = ({
  schema,
  value,
  onChange,
  specialFields,
}: {
  schema: z.core.JSONSchema._JSONSchema | null | undefined;
  value: FluxeryConfigRecord;
  onChange: (value: FluxeryConfigRecord) => void;
  specialFields?: FluxerySpecialFields;
}) => {
  if (
    schema === null ||
    schema === undefined ||
    typeof schema !== 'object' ||
    Array.isArray(schema)
  ) {
    return (
      <p className="text-muted-foreground text-sm">
        This trigger does not define any payload fields.
      </p>
    );
  }

  if (schema.type !== 'object') {
    return (
      <p className="text-muted-foreground text-sm">
        Payload schemas must be objects to render form fields.
      </p>
    );
  }

  const properties = schema.properties ?? {};
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This trigger does not define any payload fields.
      </p>
    );
  }

  const updateFieldValue = (fieldName: string, nextValue: FieldValue | undefined) => {
    onChange({ ...value, [fieldName]: nextValue });
  };

  const updateArrayItem = (fieldName: string, index: number, nextValue: FieldValue | undefined) => {
    const currentArray = Array.isArray(value[fieldName]) ? value[fieldName] : [];
    const nextArray = [...currentArray];
    nextArray[index] = nextValue ?? '';
    onChange({ ...value, [fieldName]: nextArray });
  };

  const addArrayItem = (fieldName: string, itemType: string | undefined) => {
    const currentArray = Array.isArray(value[fieldName]) ? value[fieldName] : [];
    onChange({
      ...value,
      [fieldName]: [...currentArray, getDefaultValue(itemType)],
    });
  };

  const deleteArrayItem = (fieldName: string, index: number) => {
    const currentArray = Array.isArray(value[fieldName]) ? value[fieldName] : [];
    onChange({
      ...value,
      [fieldName]: currentArray.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  return (
    <div className="space-y-3">
      {entries.map(([propName, propSchema]) => {
        if (typeof propSchema !== 'object' || Array.isArray(propSchema)) {
          return null;
        }

        if (propSchema.type === 'array') {
          const itemsSchema = propSchema.items;
          if (
            itemsSchema === undefined ||
            typeof itemsSchema !== 'object' ||
            Array.isArray(itemsSchema)
          ) {
            return null;
          }

          return (
            <ArrayField
              key={propName}
              description={propSchema.description}
              propName={propName}
              schema={itemsSchema}
              specialFields={specialFields}
              value={Array.isArray(value[propName]) ? value[propName] : []}
              onItemAdd={() => {
                addArrayItem(propName, itemsSchema.type);
              }}
              onItemChange={(index, nextValue) => {
                updateArrayItem(propName, index, nextValue);
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
            propName={propName}
            schema={propSchema}
            specialFields={specialFields}
            value={value[propName]}
            onChange={(nextValue) => {
              updateFieldValue(propName, nextValue);
            }}
          />
        );
      })}
    </div>
  );
};
