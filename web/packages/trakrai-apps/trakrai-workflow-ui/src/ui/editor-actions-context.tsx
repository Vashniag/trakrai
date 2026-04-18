'use client';

import { createContext, useContext } from 'react';

import type { FluxeryEditingApi } from './flow-types';

type EditorActionsContextValue = {
  editing?: FluxeryEditingApi | null;
};

const EditorActionsContext = createContext<EditorActionsContextValue | null>(null);

/**
 * Supplies an editing controller override for descendants that trigger workflow mutations.
 *
 * This is primarily used by higher-level integrations to scope actions like layouting
 * or node insertion to a projected view of the workflow instead of the base editor state.
 */
export const FluxeryEditorActionsProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: EditorActionsContextValue;
}) => {
  return <EditorActionsContext.Provider value={value}>{children}</EditorActionsContext.Provider>;
};

/**
 * Reads an optional editing controller override from {@link FluxeryEditorActionsProvider}.
 *
 * Returns `null` when a parent explicitly disables editing, or `undefined` when no
 * override provider is present and callers should fall back to `useFlow().editing`.
 */
export const useFluxeryEditorActions = () => {
  return useContext(EditorActionsContext);
};
