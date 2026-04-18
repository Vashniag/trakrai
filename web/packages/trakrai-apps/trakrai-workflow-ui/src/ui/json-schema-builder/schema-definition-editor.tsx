'use client';

import { useCallback } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { Input } from '@trakrai/design-system/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trakrai/design-system/components/select';
import {
  createDefaultDefinition,
  SCHEMA_TYPE_OPTIONS,
  type SchemaDefinition,
  type SchemaType,
} from '@trakrai-workflow/core';
import { Plus, Trash2 } from 'lucide-react';

const SchemaTypeSelector = ({
  value,
  onChange,
}: {
  value: SchemaType;
  onChange: (type: SchemaType) => void;
}) => (
  <Select
    value={value}
    onValueChange={(v) => {
      onChange(v as SchemaType);
    }}
  >
    <SelectTrigger className="h-8 w-[120px] border-y-0 text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {SCHEMA_TYPE_OPTIONS.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          {opt.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/**
 * Editor for enum schema variants backed by a list of string values.
 *
 * Keeps at least one value in the list so the surrounding schema definition
 * remains representable while the user is editing.
 */
export const EnumEditor = ({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) => {
  const updateValue = (index: number, newVal: string) => {
    const next = [...values];
    next[index] = newVal;
    onChange(next);
  };

  const removeValue = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const addValue = () => {
    onChange([...values, `value${values.length + 1}`]);
  };

  return (
    <div className="space-y-1.5">
      {values.map((val, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="h-7 flex-1 text-xs"
            value={val}
            onChange={(e) => {
              updateValue(i, e.target.value);
            }}
          />
          <Button
            className="h-7 w-7 p-0"
            disabled={values.length <= 1}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              removeValue(i);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button className="h-7 text-xs" size="sm" type="button" variant="outline" onClick={addValue}>
        <Plus className="mr-1 h-3 w-3" />
        Add value
      </Button>
    </div>
  );
};

/**
 * Editor for literal schema definitions.
 *
 * Switching the literal type resets the stored value to a sensible default for
 * that type so the enclosing schema never carries an invalid mixed-type literal.
 */
export const LiteralEditor = ({
  value,
  onChange,
}: {
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) => {
  const literalType = typeof value as 'string' | 'number' | 'boolean';

  return (
    <div className="space-y-1.5">
      <Select
        value={literalType}
        onValueChange={(t) => {
          if (t === 'number') onChange(0);
          else if (t === 'boolean') onChange(false);
          else onChange('');
        }}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="string">String</SelectItem>
          <SelectItem value="number">Number</SelectItem>
          <SelectItem value="boolean">Boolean</SelectItem>
        </SelectContent>
      </Select>
      {literalType === 'boolean' ? (
        <Select
          value={String(value)}
          onValueChange={(v) => {
            onChange(v === 'true');
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="h-7 text-xs"
          type={literalType === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={(e) => {
            if (literalType === 'number') {
              const n = parseFloat(e.target.value);
              onChange(Number.isNaN(n) ? 0 : n);
            } else {
              onChange(e.target.value);
            }
          }}
        />
      )}
    </div>
  );
};

/**
 * Editor for union schema definitions.
 *
 * Each variant is edited through a nested {@link SchemaDefinitionEditor}. Like the
 * enum editor, this keeps at least one variant present to avoid empty union shapes.
 */
export const UnionEditor = ({
  variants,
  onChange,
}: {
  variants: SchemaDefinition[];
  onChange: (variants: SchemaDefinition[]) => void;
}) => {
  const updateVariant = (index: number, updated: SchemaDefinition) => {
    const next = [...variants];
    next[index] = updated;
    onChange(next);
  };

  const removeVariant = (index: number) => {
    onChange(variants.filter((_, i) => i !== index));
  };

  const addVariant = () => {
    onChange([...variants, { type: 'string' }]);
  };

  return (
    <div className="space-y-2">
      {variants.map((variant, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="border-input flex items-start gap-1.5 rounded border p-2">
          <div className="flex-1">
            <SchemaDefinitionEditor
              value={variant}
              onChange={(updated) => {
                updateVariant(i, updated);
              }}
            />
          </div>
          <Button
            className="h-7 w-7 shrink-0 p-0"
            disabled={variants.length <= 1}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              removeVariant(i);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        className="h-7 text-xs"
        size="sm"
        type="button"
        variant="outline"
        onClick={addVariant}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add variant
      </Button>
    </div>
  );
};

/**
 * Minimal schema-definition type switcher used throughout the JSON schema builder.
 *
 * Selecting a new schema type replaces the current value with a fresh default
 * definition from `createDefaultDefinition`, which prevents stale fields from a
 * previous type leaking into the new definition shape.
 */
export const SchemaDefinitionEditor = ({
  value,
  onChange,
}: {
  value: SchemaDefinition;
  onChange: (value: SchemaDefinition) => void;
}) => {
  const handleTypeChange = useCallback(
    (newType: SchemaType) => {
      onChange(createDefaultDefinition(newType));
    },
    [onChange],
  );

  return <SchemaTypeSelector value={value.type} onChange={handleTypeChange} />;
};
