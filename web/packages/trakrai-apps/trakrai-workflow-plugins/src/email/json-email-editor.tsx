'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { JSONUIProvider, Renderer, type ComponentRenderProps } from '@json-render/react-email';
import { Editor } from '@monaco-editor/react';
import { Button } from '@trakrai/design-system/components/button';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@trakrai/design-system/components/tabs';
import { cn } from '@trakrai/design-system/lib/utils';
import { RotateCcw } from 'lucide-react';

import { defaultJsonEmailDocument } from './defaults';
import { resolveJsonEmailDocument } from './document';

import type { JsonEmailTemplateDocument } from './types';
import type { Spec } from '@json-render/react-email/server';
import type { FluxerySpecialFieldRendererProps } from '@trakrai-workflow/ui';

type ParseState =
  | {
      status: 'ready';
      document: JsonEmailTemplateDocument;
    }
  | {
      status: 'error';
      error: string;
    };

const prettyJson = (value: unknown): string => {
  return JSON.stringify(value, null, 2);
};

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    throw new Error(`${label}: ${message}`, { cause: error });
  }
};

const JsonEditorPane = ({
  className,
  path,
  theme,
  value,
  onChange,
}: {
  className?: string;
  path: string;
  theme: 'light' | 'vs-dark';
  value: string;
  onChange: (value: string) => void;
}) => {
  return (
    <Editor
      className={className}
      defaultLanguage="json"
      options={{
        automaticLayout: true,
        fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
        fontSize: 13,
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        padding: { top: 12 },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
      }}
      path={path}
      theme={theme}
      value={value}
      onChange={(nextValue) => {
        onChange(nextValue ?? '');
      }}
    />
  );
};

const PREVIEW_ROOT = '__fluxery_email_preview_root__';

type PreviewRootProps = {
  dir?: string;
  lang?: string;
  style?: Record<string, unknown>;
};

const PreviewRoot = ({ element, children }: ComponentRenderProps<PreviewRootProps>) => {
  return (
    <div dir={element.props.dir} lang={element.props.lang} style={element.props.style}>
      {children}
    </div>
  );
};

const browserPreviewRegistry = {
  PreviewRoot,
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const getRecordString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
};

const getRecordStyle = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
};

const getBrowserPreviewSpec = (spec: Spec): Spec | null => {
  const root = spec.elements[spec.root];
  if (root === undefined || !Array.isArray(root.children)) {
    return null;
  }

  const bodyKey = root.children.find((childKey) => spec.elements[childKey]?.type === 'Body');
  if (bodyKey === undefined) {
    return null;
  }

  const body = spec.elements[bodyKey];
  if (body === undefined || !Array.isArray(body.children)) {
    return null;
  }

  const bodyStyle = getRecordStyle(body.props, 'style');

  return {
    ...spec,
    root: PREVIEW_ROOT,
    elements: {
      ...spec.elements,
      [PREVIEW_ROOT]: {
        type: 'PreviewRoot',
        props: {
          dir: getRecordString(root.props, 'dir'),
          lang: getRecordString(root.props, 'lang'),
          style: bodyStyle,
        },
        children: [...body.children],
      },
    },
  };
};

const normalizePreviewText = (value: string): string => {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const BrowserEmailPreview = ({
  demoData,
  onTextContentChange,
  spec,
}: {
  demoData: Record<string, unknown>;
  onTextContentChange: (value: string) => void;
  spec: Spec;
}) => {
  const previewSpec = useMemo(() => getBrowserPreviewSpec(spec), [spec]);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = previewRef.current;
    if (node === null) {
      onTextContentChange('');
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      onTextContentChange(normalizePreviewText(node.innerText));
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [demoData, onTextContentChange, previewSpec]);

  if (previewSpec === null) {
    return (
      <div className="text-destructive flex h-full items-center justify-center px-6 text-center text-sm">
        Preview requires an `Html` root with a `Body` child.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-600">
      <div className="flex flex-1 justify-center overflow-auto p-5">
        <div className="w-full max-w-[640px] rounded-md bg-white shadow-sm">
          <div ref={previewRef} className="min-h-[320px]">
            <JSONUIProvider initialState={demoData}>
              <Renderer includeStandard registry={browserPreviewRegistry} spec={previewSpec} />
            </JSONUIProvider>
          </div>
        </div>
      </div>
    </div>
  );
};

const JsonEmailEditorBody = ({
  documentValue,
  monacoTheme,
  onChange,
}: {
  documentValue: JsonEmailTemplateDocument;
  monacoTheme: 'light' | 'vs-dark';
  onChange: (value: unknown) => void;
}) => {
  const previewTextFallback =
    'Preview text is derived from the browser-rendered template. Final text output is generated during node execution.';
  const lastCommittedRef = useRef<string>(JSON.stringify(documentValue));
  const [specDraft, setSpecDraft] = useState(() => prettyJson(documentValue.spec));
  const [demoDataDraft, setDemoDataDraft] = useState(() => prettyJson(documentValue.demoData));
  const [previewText, setPreviewText] = useState('');

  const parseState = useMemo<ParseState>(() => {
    try {
      return {
        status: 'ready',
        document: {
          spec: parseJson(specDraft, 'Template JSON') as JsonEmailTemplateDocument['spec'],
          demoData: parseJson(demoDataDraft, 'Demo data JSON') as Record<string, unknown>,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }, [demoDataDraft, specDraft]);

  useEffect(() => {
    if (parseState.status === 'error') {
      return;
    }

    const serialized = JSON.stringify(parseState.document);
    if (serialized !== lastCommittedRef.current) {
      lastCommittedRef.current = serialized;
      onChange(parseState.document);
    }
  }, [onChange, parseState]);

  const parsedDocument = parseState.status === 'ready' ? parseState.document : null;
  const activeError = parseState.status === 'error' ? parseState.error : null;

  let previewContent: React.ReactNode = null;
  if (activeError !== null) {
    previewContent = (
      <div className="text-destructive flex h-full items-center justify-center px-6 text-center text-sm">
        {activeError}
      </div>
    );
  } else if (parsedDocument !== null) {
    previewContent = (
      <BrowserEmailPreview
        demoData={parsedDocument.demoData}
        spec={parsedDocument.spec}
        onTextContentChange={setPreviewText}
      />
    );
  }

  const textContent = activeError ?? (previewText === '' ? previewTextFallback : previewText);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          The editor preview uses saved demo data. Workflow executions render the same template with
          actual node inputs.
        </p>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={() => {
            setSpecDraft(prettyJson(defaultJsonEmailDocument.spec));
            setDemoDataDraft(prettyJson(defaultJsonEmailDocument.demoData));
          }}
        >
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="bg-background grid h-full min-h-0 overflow-hidden rounded-lg border xl:grid-rows-[minmax(0,1fr)_220px]">
          <section className="min-h-0 border-b">
            <div className="flex h-10 items-center border-b px-3">
              <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                Template JSON
              </span>
            </div>
            <JsonEditorPane
              className="h-[320px] xl:h-full"
              path="json-email-template.json"
              theme={monacoTheme}
              value={specDraft}
              onChange={setSpecDraft}
            />
          </section>

          <section className="min-h-0">
            <div className="flex h-10 items-center border-b px-3">
              <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                Demo Data
              </span>
            </div>
            <JsonEditorPane
              className="h-[220px]"
              path="json-email-demo-data.json"
              theme={monacoTheme}
              value={demoDataDraft}
              onChange={setDemoDataDraft}
            />
          </section>
        </div>

        <div className="bg-background h-full min-h-0 overflow-hidden rounded-lg border">
          <Tabs className="flex h-full flex-col" defaultValue="preview">
            <div className="flex h-10 items-center border-b px-3">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="text">Text</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent className="mt-0 min-h-0 flex-1" value="preview">
              {previewContent}
            </TabsContent>

            <TabsContent className="mt-0 min-h-0 flex-1" value="text">
              <ScrollArea className="h-[320px] xl:h-full">
                <pre
                  className={cn(
                    'text-muted-foreground px-4 py-3 text-sm leading-6 whitespace-pre-wrap',
                    activeError !== null ? 'text-destructive' : '',
                  )}
                >
                  {textContent}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export const JsonEmailEditor = ({ value, onChange, context }: FluxerySpecialFieldRendererProps) => {
  const defaultValue = resolveJsonEmailDocument(context?.field?.fieldConfig?.defaultValue);
  const documentValue = useMemo(
    () => resolveJsonEmailDocument(value ?? defaultValue),
    [defaultValue, value],
  );
  const monacoTheme: 'light' | 'vs-dark' = context?.theme === 'dark' ? 'vs-dark' : 'light';

  return (
    <JsonEmailEditorBody
      key={JSON.stringify(documentValue)}
      documentValue={documentValue}
      monacoTheme={monacoTheme}
      onChange={onChange}
    />
  );
};
