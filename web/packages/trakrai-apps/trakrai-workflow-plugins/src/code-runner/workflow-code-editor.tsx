'use client';

import { useCallback, useEffect, useRef } from 'react';

import { Editor } from '@monaco-editor/react';
import { cn } from '@trakrai/design-system/lib/utils';
import { jsonSchemaToTypeString } from '@trakrai-workflow/core';

import type { editor as monacoEditor } from 'monaco-editor';
import type { JSONSchema } from 'zod/v4/core';

type MonacoTypeScriptApi = {
  languages: {
    typescript: {
      ScriptTarget: {
        ESNext: number;
      };
      ModuleKind: {
        ESNext: number;
      };
      ModuleResolutionKind: {
        NodeJs: number;
      };
      typescriptDefaults: {
        addExtraLib: (content: string, filePath?: string) => { dispose: () => void };
        setCompilerOptions: (options: Record<string, unknown>) => void;
        setDiagnosticsOptions: (options: { diagnosticCodesToIgnore: number[] }) => void;
      };
    };
  };
};

interface WorkflowCodeEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  inputSchema?: JSONSchema._JSONSchema;
  outputSchema?: JSONSchema._JSONSchema;
  theme?: 'vs-dark' | 'light';
  height?: string | number;
  width?: string | number;
  className?: string;
}

const generateTypeDeclaration = (
  inputSchema?: JSONSchema._JSONSchema,
  outputSchema?: JSONSchema._JSONSchema,
): string => {
  const inputType =
    inputSchema != null ? jsonSchemaToTypeString(inputSchema) : 'Record<string, unknown>';
  const outputType = outputSchema != null ? jsonSchemaToTypeString(outputSchema) : 'unknown';

  return `
type __InputType = ${inputType};
type __OutputType = ${outputType};
declare const input: __InputType;
`;
};

export const WorkflowCodeEditor = ({
  value = '',
  onChange,
  inputSchema,
  outputSchema,
  theme = 'vs-dark',
  height = '400px',
  width = '100%',
  className,
}: WorkflowCodeEditorProps) => {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoTypeScriptApi | null>(null);
  const typesLibDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const TS_DIAG_RETURN_OUTSIDE_FUNCTION = 1108;
  const TS_DIAG_CANNOT_FIND_MODULE = 2307;
  const TS_DIAG_EXPECTED_SEMICOLON = 1005;

  const syncTypeDeclarations = useCallback(
    (monaco: MonacoTypeScriptApi) => {
      typesLibDisposableRef.current?.dispose();
      typesLibDisposableRef.current = monaco.languages.typescript.typescriptDefaults.addExtraLib(
        generateTypeDeclaration(inputSchema, outputSchema),
        'ts:workflow-types.d.ts',
      );
    },
    [inputSchema, outputSchema],
  );

  const handleBeforeMount = useCallback(
    (monaco: unknown) => {
      const monacoApi = monaco as MonacoTypeScriptApi;
      monacoRef.current = monacoApi;
      syncTypeDeclarations(monacoApi);

      monacoApi.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monacoApi.languages.typescript.ScriptTarget.ESNext,
        module: monacoApi.languages.typescript.ModuleKind.ESNext,
        lib: ['esnext'],
        strict: true,
        noEmit: true,
        allowJs: true,
        moduleResolution: monacoApi.languages.typescript.ModuleResolutionKind.NodeJs,
      });
      monacoApi.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        diagnosticCodesToIgnore: [
          TS_DIAG_RETURN_OUTSIDE_FUNCTION,
          TS_DIAG_CANNOT_FIND_MODULE,
          TS_DIAG_EXPECTED_SEMICOLON,
        ],
      });
    },
    [syncTypeDeclarations],
  );

  const handleEditorDidMount = useCallback((editor: monacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.focus();
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco == null) return;
    syncTypeDeclarations(monaco);
  }, [syncTypeDeclarations]);

  useEffect(
    () => () => {
      typesLibDisposableRef.current?.dispose();
      typesLibDisposableRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (editor == null) return;

    const model = editor.getModel();
    if (model == null) return;
    if (model.getValue() === value) return;

    model.setValue(value);
  }, [value]);

  return (
    <div className={cn('border-input w-full overflow-visible rounded-md border', className)}>
      <Editor
        beforeMount={handleBeforeMount}
        defaultValue={value}
        height={height}
        language="typescript"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          renderLineHighlight: 'gutter',
          folding: false,
          glyphMargin: false,
          contextmenu: true,
        }}
        path="file:///workflow.ts"
        theme={theme}
        width={width}
        onChange={(nextValue) => {
          onChange?.(nextValue ?? '');
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};
