import { useEffect, useMemo } from 'react';

import { useFluxerySidebar, type FluxerySidebarRegisteredTab } from './sidebar-context';

const SIDEBAR_TAB_DEFINITION = Symbol('fluxery.sidebar-tab-definition');

/** Props for the declarative JSX-based sidebar tab. */
type FluxerySidebarTabProps = {
  /** Unique tab identifier. */
  id: string;
  /** Content rendered as the tab trigger label. */
  label: React.ReactNode;
  /** Sort order within the sidebar (lower values appear first). */
  order?: number;
  /** CSS class applied to the tab content container. */
  contentClassName?: string;
  /** Content rendered when this tab is active. */
  children: React.ReactNode;
};

/** Internal definition metadata attached to sidebar tab components via a symbol key. */
type FluxerySidebarTabDefinition<Props> = {
  /** Unique tab identifier. */
  id: string;
  /** Sort order within the sidebar. */
  order: number;
  /** CSS class applied to the tab content container. */
  contentClassName?: string;
  /** Renders the tab trigger label from the component's props. */
  renderLabel: (props: Props) => React.ReactNode;
  /** Optional hook for auto-selecting this tab based on external state changes. */
  useAutoSelect?: (props: Props) => void;
};

const SidebarTabAutoSelectController = <Props extends object>({
  props,
  useAutoSelect,
}: {
  props: Props;
  useAutoSelect: (props: Props) => void;
}) => {
  useAutoSelect(props);
  return null;
};

const SidebarTabRegistration = ({ tab }: { tab: FluxerySidebarRegisteredTab }) => {
  const { registerTab, unregisterTab } = useFluxerySidebar();

  useEffect(() => {
    registerTab(tab);
    return () => {
      unregisterTab(tab.id);
    };
  }, [registerTab, tab, unregisterTab]);

  return null;
};

/**
 * A sidebar tab component type with embedded tab definition metadata.
 *
 * Created via {@link createFluxerySidebarTab}. When rendered inside a `FluxerySidebar`,
 * the tab definition (id, label, order) is extracted automatically.
 *
 * @typeParam Props - The props accepted by the tab's render function.
 */
export type FluxerySidebarTabComponent<Props> = React.ComponentType<Props> & {
  [SIDEBAR_TAB_DEFINITION]: FluxerySidebarTabDefinition<Props>;
};

/**
 * Declarative JSX-based sidebar tab for simple use cases.
 *
 * Use this when you don't need a factory and want to define a tab inline.
 *
 * @example
 * ```tsx
 * <FluxerySidebar>
 *   <FluxerySidebarTab id="custom" label="Custom" order={2}>
 *     <MyCustomContent />
 *   </FluxerySidebarTab>
 * </FluxerySidebar>
 * ```
 */
export const FluxerySidebarTab = (props: FluxerySidebarTabProps) => {
  const tab = useMemo<FluxerySidebarRegisteredTab>(
    () => ({
      id: props.id,
      order: props.order ?? 0,
      label: props.label,
      contentClassName: props.contentClassName,
      element: props.children,
    }),
    [props.children, props.contentClassName, props.id, props.label, props.order],
  );

  return <SidebarTabRegistration tab={tab} />;
};

FluxerySidebarTab.displayName = 'FluxerySidebarTab';

/** React element type for a declarative `FluxerySidebarTab`. */
export type FluxerySidebarTabElement = React.ReactElement<FluxerySidebarTabProps>;

/**
 * Factory function for creating reusable sidebar tab components.
 *
 * Returns a React component with embedded tab metadata (id, label, order).
 * The component can be rendered directly inside `FluxerySidebar`.
 *
 * @typeParam Props - The props accepted by the tab's render function.
 * @param options.id - Unique tab identifier.
 * @param options.label - Tab label (string or render function receiving props).
 * @param options.order - Sort order within the sidebar. Defaults to `0`.
 * @param options.contentClassName - CSS class applied to the tab content container.
 * @param options.render - Render function that returns the tab content.
 * @param options.useAutoSelect - Optional hook that controls auto-selection behavior.
 * @returns A `FluxerySidebarTabComponent` that can be placed inside `FluxerySidebar`.
 *
 * @example
 * ```tsx
 * const MyTab = createFluxerySidebarTab({
 *   id: 'my-tab',
 *   label: 'My Tab',
 *   order: 1,
 *   render: () => <div>Tab Content</div>,
 * });
 * ```
 */
export const createFluxerySidebarTab = <Props extends object>({
  id,
  label,
  order = 0,
  contentClassName,
  render,
  useAutoSelect,
}: {
  id: string;
  label: React.ReactNode | ((props: Props) => React.ReactNode);
  order?: number;
  contentClassName?: string;
  render: (props: Props) => React.ReactNode;
  useAutoSelect?: (props: Props) => void;
}): FluxerySidebarTabComponent<Props> => {
  const SidebarTabComponent: FluxerySidebarTabComponent<Props> = (props: Props) => {
    const tab = useMemo<FluxerySidebarRegisteredTab>(
      () => ({
        id,
        order,
        label: typeof label === 'function' ? label(props) : label,
        contentClassName,
        element: render(props),
        autoSelectController:
          useAutoSelect === undefined ? undefined : (
            <SidebarTabAutoSelectController
              key={`${id}-auto-select`}
              props={props}
              useAutoSelect={useAutoSelect}
            />
          ),
      }),
      [props],
    );

    return <SidebarTabRegistration tab={tab} />;
  };
  const definition: FluxerySidebarTabDefinition<Props> = {
    id,
    order,
    contentClassName,
    renderLabel: (props: Props) => (typeof label === 'function' ? label(props) : label),
    useAutoSelect,
  };

  SidebarTabComponent.displayName = `FluxerySidebarTab(${id})`;
  SidebarTabComponent[SIDEBAR_TAB_DEFINITION] = definition;

  return SidebarTabComponent;
};

/**
 * Returns `true` when a child is the declarative JSX form created with {@link FluxerySidebarTab}.
 *
 * Fluxery uses this to normalize sidebar children into a shared registration shape.
 */
export const isFluxerySidebarTabElement = (
  child: React.ReactNode,
): child is FluxerySidebarTabElement =>
  typeof child === 'object' &&
  child !== null &&
  'type' in child &&
  child.type === FluxerySidebarTab;

/**
 * Returns `true` when a child is a component created by {@link createFluxerySidebarTab}.
 *
 * The check looks for the private symbol metadata attached by the factory, which keeps
 * reusable tabs distinguishable from arbitrary React components rendered in the sidebar.
 */
export const isFluxerySidebarTabComponentElement = <Props extends object>(
  child: React.ReactNode,
): child is React.ReactElement<Props, FluxerySidebarTabComponent<Props>> =>
  typeof child === 'object' &&
  child !== null &&
  'type' in child &&
  typeof child.type === 'function' &&
  SIDEBAR_TAB_DEFINITION in child.type;

/**
 * Reads the normalized tab definition metadata from a factory-created sidebar tab element.
 *
 * This lets the sidebar register labels, sort order, and optional auto-select behavior
 * without having to render the tab body eagerly.
 */
export const getFluxerySidebarTabDefinition = <Props extends object>(
  child: React.ReactElement<Props, FluxerySidebarTabComponent<Props>>,
) => child.type[SIDEBAR_TAB_DEFINITION];
