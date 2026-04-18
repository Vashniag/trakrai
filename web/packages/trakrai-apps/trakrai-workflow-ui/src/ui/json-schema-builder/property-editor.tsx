'use client';

import { useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  createDefaultProperty,
  type PropertyDescriptor,
  type SchemaDefinition,
} from '@trakrai-workflow/core';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import {
  EnumEditor,
  LiteralEditor,
  SchemaDefinitionEditor,
  UnionEditor,
} from './schema-definition-editor';

const PropertyRow = ({
  property,
  onChange,
  onRemove,
  depth,
  index,
}: {
  property: PropertyDescriptor;
  onChange: (property: PropertyDescriptor) => void;
  onRemove: () => void;
  depth: number;
  index: number;
}) => {
  const [expanded, setExpanded] = useState(true);
  const hasNestedContent =
    property.schema.type === 'object' ||
    property.schema.type === 'array' ||
    property.schema.type === 'union' ||
    property.schema.type === 'enum' ||
    property.schema.type === 'literal';

  const updateSchema = (schema: SchemaDefinition) => {
    onChange({ ...property, schema });
  };

  return (
    <div className={cn(index > 0 ? 'border-t' : '', 'border-input')}>
      <div className="bg-muted/30 flex items-center">
        {hasNestedContent ? (
          <button
            className="text-muted-foreground hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center"
            type="button"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <div className="w-8 shrink-0" />
        )}

        <Input
          className="h-8 flex-1 border-y-0 border-r-0 font-mono text-xs"
          placeholder="property name"
          value={property.name}
          onChange={(e) => {
            onChange({ ...property, name: e.target.value });
          }}
        />

        <div className="shrink-0">
          <SchemaDefinitionEditor value={property.schema} onChange={updateSchema} />
        </div>

        <div className="border-input hover:bg-muted hover:text-foreground dark:hover:bg-input/50 flex h-8 shrink-0 items-center gap-1 border-r px-2">
          <Checkbox
            checked={property.required}
            className="h-3.5 w-3.5"
            onCheckedChange={(checked) => {
              onChange({ ...property, required: checked === true });
            }}
          />
          <Label className="text-muted-foreground cursor-pointer text-[10px]">Required</Label>
        </div>

        <div className="border-input hover:bg-muted hover:text-foreground dark:hover:bg-input/50 flex h-8 shrink-0 items-center gap-1 border-r px-2">
          <Checkbox
            checked={property.nullable}
            className="h-3.5 w-3.5"
            onCheckedChange={(checked) => {
              onChange({ ...property, nullable: checked === true });
            }}
          />
          <Label className="text-muted-foreground cursor-pointer text-[10px]">Nullable</Label>
        </div>

        <Button
          className="h-8 w-8 shrink-0 border-0 p-0"
          size="sm"
          type="button"
          variant="outline"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && hasNestedContent ? (
        <div className="pl-8">
          {property.schema.type === 'object' && (
            <PropertyListEditor
              depth={depth + 1}
              properties={property.schema.properties}
              onChange={(properties) => {
                updateSchema({ type: 'object', properties });
              }}
            />
          )}
          {property.schema.type === 'array' && (
            <div className="border-input ml-1 space-y-1.5 border-l pl-3">
              <span className="text-muted-foreground text-xs font-medium">Array items</span>
              <SchemaDefinitionEditor
                value={property.schema.items}
                onChange={(items) => {
                  updateSchema({ type: 'array', items });
                }}
              />
              {property.schema.items.type === 'object' && (
                <PropertyListEditor
                  depth={depth + 2}
                  properties={property.schema.items.properties}
                  onChange={(properties) => {
                    updateSchema({
                      type: 'array',
                      items: { type: 'object', properties },
                    });
                  }}
                />
              )}
            </div>
          )}
          {property.schema.type === 'enum' && (
            <EnumEditor
              values={property.schema.values}
              onChange={(values) => {
                updateSchema({ type: 'enum', values });
              }}
            />
          )}
          {property.schema.type === 'literal' && (
            <LiteralEditor
              value={property.schema.value}
              onChange={(v) => {
                updateSchema({ type: 'literal', value: v });
              }}
            />
          )}
          {property.schema.type === 'union' && (
            <UnionEditor
              variants={property.schema.variants}
              onChange={(variants) => {
                updateSchema({ type: 'union', variants });
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Recursive property-list editor for object-shaped schema definitions.
 *
 * Renders each property row with name, required/nullability flags, and a nested
 * schema editor. Nested object and array item definitions reuse this component,
 * so updates always flow upward as a complete `PropertyDescriptor[]` snapshot.
 */
export const PropertyListEditor = ({
  properties,
  onChange,
  depth = 0,
}: {
  properties: PropertyDescriptor[];
  onChange: (properties: PropertyDescriptor[]) => void;
  depth?: number;
}) => {
  const updateProperty = (index: number, updated: PropertyDescriptor) => {
    const next = [...properties];
    next[index] = updated;
    onChange(next);
  };

  const removeProperty = (index: number) => {
    onChange(properties.filter((_, i) => i !== index));
  };

  const addProperty = () => {
    const existingNames = new Set(properties.map((p) => p.name));
    let name = 'newProperty';
    let counter = 1;
    while (existingNames.has(name)) {
      name = `newProperty${counter}`;
      counter++;
    }
    onChange([...properties, createDefaultProperty(name)]);
  };

  return (
    <div className="border-input border">
      {properties.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">
          No properties defined. Click below to add one.
        </p>
      ) : (
        properties.map((prop, i) => (
          <PropertyRow
            // eslint-disable-next-line react/no-array-index-key
            key={`${i}`}
            depth={depth}
            index={i}
            property={prop}
            onChange={(updated) => {
              updateProperty(i, updated);
            }}
            onRemove={() => {
              removeProperty(i);
            }}
          />
        ))
      )}
      <Button
        className="h-8 w-full border-0 border-t-1 text-xs"
        size="sm"
        type="button"
        variant="outline"
        onClick={addProperty}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add property
      </Button>
    </div>
  );
};
