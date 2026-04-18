import { Tabs, TabsContent, TabsList, TabsTrigger } from '@trakrai/design-system/components/tabs';

import { useFluxerySidebar, SidebarProvider } from './sidebar-context';

const SidebarCore = ({ children }: { children: React.ReactNode }) => {
  const { currentTab, registeredTabs, setTab } = useFluxerySidebar();

  if (registeredTabs.length === 0) {
    return <div className="flex h-full w-full flex-col gap-2 py-4">{children}</div>;
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 py-4">
      <div className="hidden">{children}</div>
      {registeredTabs.map((tab) => tab.autoSelectController ?? null)}
      <Tabs
        className="h-full w-full"
        value={currentTab}
        onValueChange={(e) => {
          setTab(e);
        }}
      >
        <div className="w-full px-4">
          <TabsList
            className="grid w-full"
            style={{ gridTemplateColumns: `repeat(${registeredTabs.length}, 1fr)` }}
          >
            {registeredTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {registeredTabs.map((tab) => (
          <TabsContent key={tab.id} className={tab.contentClassName} value={tab.id}>
            {tab.element}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

/**
 * Sidebar panel for the Fluxery editor.
 *
 * Renders a fixed-width sidebar with tabbed navigation. Accepts `FluxerySidebarTab`
 * elements or components created via `createFluxerySidebarTab` as children.
 * Tabs are automatically sorted by `order` and the first registered tab becomes the
 * fallback selection. Children are still rendered once in a hidden container so
 * declarative tabs can register themselves with the sidebar context before the tab
 * chrome is built.
 *
 * @example
 * ```tsx
 * <FluxerySidebar>
 *   <SidebarNodesTab />
 *   <SidebarInfoTab />
 * </FluxerySidebar>
 * ```
 */
export const FluxerySidebar = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="h-full w-80 shrink-0 overflow-hidden border-l">
      <SidebarProvider>
        <SidebarCore>{children}</SidebarCore>
      </SidebarProvider>
    </div>
  );
};
