// @vitest-environment jsdom
import { createContext, useContext } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultJsonEmailDocument } from '../../email';
import { JsonEmailEditor } from '../../email/json-email-editor';

const UPDATED_TITLE = 'Updated title';

const PreviewStateContext = createContext<Record<string, unknown>>({});

vi.mock('@monaco-editor/react', () => ({
  Editor: ({
    onChange,
    path,
    value,
  }: {
    onChange?: (value: string) => void;
    path?: string;
    value?: string;
  }) => (
    <textarea
      data-testid={path}
      value={value}
      onChange={(event) => {
        onChange?.(event.target.value);
      }}
    />
  ),
}));

vi.mock('@json-render/react-email', () => ({
  JSONUIProvider: ({
    children,
    initialState,
  }: {
    children: React.ReactNode;
    initialState?: Record<string, unknown>;
  }) => (
    <PreviewStateContext.Provider value={initialState ?? {}}>
      {children}
    </PreviewStateContext.Provider>
  ),
  Renderer: ({
    spec,
  }: {
    spec: {
      elements: Record<string, { props?: { text?: string | { $state?: string } } }>;
      root: string;
    } | null;
  }) => {
    const state = useContext(PreviewStateContext);
    let resolvedText = '';
    if (typeof state.title === 'string') {
      resolvedText = state.title;
    } else if (spec !== null) {
      resolvedText =
        Object.values(spec.elements)
          .map((element) => element.props?.text)
          .find((textValue) => typeof textValue === 'string') ?? '';
    }

    return <div data-testid="browser-email-preview">{resolvedText}</div>;
  },
}));

describe('JsonEmailEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders a preview in the browser and persists valid changes', async () => {
    const onChange = vi.fn();

    render(
      <JsonEmailEditor
        context={{
          field: {
            key: 'emailTemplate',
            label: 'Email Template',
            fieldConfig: { defaultValue: defaultJsonEmailDocument },
          },
          theme: 'light',
        }}
        value={defaultJsonEmailDocument}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('browser-email-preview')).toHaveTextContent(
        String(defaultJsonEmailDocument.demoData.title),
      );
    });

    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('json-email-demo-data.json'), {
      target: {
        value: JSON.stringify(
          {
            ...defaultJsonEmailDocument.demoData,
            title: UPDATED_TITLE,
          },
          null,
          2,
        ),
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('browser-email-preview')).toHaveTextContent(UPDATED_TITLE);
    });

    const latestValue = onChange.mock.calls.at(-1)?.[0] as
      | {
          demoData?: {
            title?: string;
          };
        }
      | undefined;
    expect(latestValue?.demoData?.title).toBe(UPDATED_TITLE);
  });
});
