'use client';

import { useCallback, useMemo } from 'react';

import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  definitionToJsonSchema,
  jsonSchemaToDefinition,
  type PropertyDescriptor,
} from '@trakrai-workflow/core';

import { PropertyListEditor } from './property-editor';

import type { JSONSchema } from 'zod/v4/core';

/**
 * Visual editor for building JSON schemas.
 *
 * Renders a property list editor where users can add, remove, and modify
 * schema properties. Supports nested objects, arrays, enums, literals, and union types.
 *
 * @param value - The current JSON schema value to edit.
 * @param onValueChange - Callback fired when the schema changes.
 * @param className - Additional CSS classes for the container.
 * @param maxHeight - Optional max height (CSS value) to enable scrolling.
 *
 * @example
 * ```tsx
 * <JsonSchemaBuilder
 *   value={currentSchema}
 *   onValueChange={setSchema}
 *   maxHeight="400px"
 * />
 * ```
 */
export const JsonSchemaBuilder = ({
  value,
  onValueChange,
  className,
  maxHeight,
}: {
  value?: JSONSchema._JSONSchema;
  onValueChange: (schema: JSONSchema.JSONSchema) => void;
  className?: string;
  maxHeight?: string;
}) => {
  const definition = useMemo(() => {
    if (value === undefined) {
      return { type: 'object' as const, properties: [] as PropertyDescriptor[] };
    }
    const def = jsonSchemaToDefinition(value);
    if (def.type !== 'object') {
      return { type: 'object' as const, properties: [] as PropertyDescriptor[] };
    }
    return def;
  }, [value]);

  const handlePropertiesChange = useCallback(
    (properties: PropertyDescriptor[]) => {
      const schema = definitionToJsonSchema({ type: 'object', properties });
      onValueChange(schema);
    },
    [onValueChange],
  );

  const content = (
    <PropertyListEditor
      depth={0}
      properties={definition.properties}
      onChange={handlePropertiesChange}
    />
  );

  if (maxHeight !== undefined) {
    return (
      <ScrollArea className={cn('w-full', className)} style={{ maxHeight }}>
        <div className="w-full p-1">{content}</div>
      </ScrollArea>
    );
  }

  return <div className={cn('w-full', className)}>{content}</div>;
};
