import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Normalized tab registration payload stored by the sidebar context.
 *
 * Declarative tabs and factory-created tabs are both converted into this shape
 * before the sidebar renders its tab chrome.
 */
export type FluxerySidebarRegisteredTab = {
  autoSelectController?: ReactNode;
  contentClassName?: string;
  element: ReactNode;
  id: string;
  label: ReactNode;
  order: number;
};

/** State exposed by the sidebar context. */
type SidebarContextType = {
  /** The ID of the currently active tab. */
  currentTab: string;
  /** Switches the active tab to the given ID. */
  setTab: (tabId: string) => void;
  /** List of all registered tab IDs in the sidebar. */
  availableTabs: string[];
  /** All registered tabs sorted by order. */
  registeredTabs: FluxerySidebarRegisteredTab[];
  /** Registers or updates a sidebar tab. */
  registerTab: (tab: FluxerySidebarRegisteredTab) => void;
  /** Unregisters a sidebar tab by id. */
  unregisterTab: (tabId: string) => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

/**
 * Hook to access sidebar state.
 *
 * Returns the currently active tab ID, a function to change tabs, and the list
 * of available tab IDs.
 *
 * @throws {Error} If called outside of a `FluxerySidebar`.
 *
 * @example
 * ```tsx
 * const { currentTab, setTab, availableTabs } = useFluxerySidebar();
 * ```
 */
export const useFluxerySidebar = () => {
  const context = useContext(SidebarContext);
  if (context === null) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

/**
 * Internal provider that tracks registered tabs and resolves the active tab id.
 *
 * When tabs self-register, `availableTabs` is derived from registration order after
 * sorting by `order`. If nothing has registered yet, the provider falls back to the
 * optional `availableTabs` prop so consumers can reason about tab availability early.
 */
export const SidebarProvider = ({
  children,
  defaultTab,
  availableTabs: providedAvailableTabs,
}: {
  children: ReactNode;
  defaultTab?: string;
  availableTabs?: string[];
}) => {
  const [currentTab, setCurrentTab] = useState<string>(defaultTab ?? '');
  const [registeredTabsById, setRegisteredTabsById] = useState<
    Record<string, FluxerySidebarRegisteredTab>
  >({});
  const registeredTabs = useMemo(
    () => Object.values(registeredTabsById).sort((a, b) => a.order - b.order),
    [registeredTabsById],
  );
  const availableTabs = useMemo(
    () =>
      registeredTabs.length > 0
        ? registeredTabs.map((tab) => tab.id)
        : (providedAvailableTabs ?? []),
    [providedAvailableTabs, registeredTabs],
  );

  const registerTab = useCallback((tab: FluxerySidebarRegisteredTab) => {
    setRegisteredTabsById((currentTabs) => {
      const currentTabState = currentTabs[tab.id];
      const isSameTab =
        currentTabState?.order === tab.order &&
        currentTabState.contentClassName === tab.contentClassName &&
        Object.is(currentTabState.label, tab.label) &&
        Object.is(currentTabState.element, tab.element) &&
        Object.is(currentTabState.autoSelectController, tab.autoSelectController);
      if (isSameTab) {
        return currentTabs;
      }

      return {
        ...currentTabs,
        [tab.id]: tab,
      };
    });
  }, []);

  const unregisterTab = useCallback((tabId: string) => {
    setRegisteredTabsById((currentTabs) => {
      if (!(tabId in currentTabs)) {
        return currentTabs;
      }

      const nextTabs = { ...currentTabs };
      delete nextTabs[tabId];
      return nextTabs;
    });
  }, []);
  const resolvedCurrentTab = useMemo(() => {
    if (availableTabs.includes(currentTab)) {
      return currentTab;
    }
    return availableTabs[0] ?? '';
  }, [availableTabs, currentTab]);

  return (
    <SidebarContext.Provider
      value={{
        currentTab: resolvedCurrentTab,
        setTab: setCurrentTab,
        availableTabs,
        registeredTabs,
        registerTab,
        unregisterTab,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

/**
 * Hook that automatically switches to a sidebar tab when the selection key changes.
 *
 * Useful for tabs like "Info" that should activate when a node is selected.
 * The tab switch only fires when `autoSelectKey` changes to a truthy value. It does
 * not repeatedly force selection while the key stays stable, which lets users switch
 * away manually until the underlying selection state changes again.
 *
 * @param tabId - The ID of the tab to auto-select.
 * @param autoSelectKey - A key that triggers selection when it changes. Pass `null`, `undefined`, or `false` to disable.
 *
 * @example
 * ```tsx
 * useSidebarTabAutoSelect('info', selectedNode);
 * ```
 */
export const useSidebarTabAutoSelect = (
  tabId: string,
  autoSelectKey: string | number | boolean | null | undefined,
) => {
  const { currentTab, setTab, availableTabs } = useFluxerySidebar();
  const previousAutoSelectKeyRef = useRef<typeof autoSelectKey>(undefined);

  useEffect(() => {
    const isEnabled =
      autoSelectKey !== false && autoSelectKey !== null && autoSelectKey !== undefined;
    const didSelectionChange = !Object.is(previousAutoSelectKeyRef.current, autoSelectKey);

    if (isEnabled && didSelectionChange && availableTabs.includes(tabId) && currentTab !== tabId) {
      setTab(tabId);
    }

    previousAutoSelectKeyRef.current = autoSelectKey;
  }, [autoSelectKey, availableTabs, currentTab, setTab, tabId]);
};
