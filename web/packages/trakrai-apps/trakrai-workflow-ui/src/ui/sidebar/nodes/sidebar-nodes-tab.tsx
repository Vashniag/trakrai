import { useEffect, useMemo, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@trakrai/design-system/components/accordion';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@trakrai/design-system/components/input-group';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import { TooltipProvider } from '@trakrai/design-system/components/tooltip';
import { createDisplayName } from '@trakrai-workflow/core/utils';
import { Search } from 'lucide-react';

import { DraggableNode } from './draggable-node';
import {
  categorizeSidebarNodes,
  filterCategorizedSidebarNodes,
  type CategorizedSidebarNodes,
} from './sidebar-nodes-tab-utils';

import { useFlow } from '../../flow-context';
import { nodes } from '../../nodes/node-renderer';
import { createFluxerySidebarTab } from '../sidebar-tab';

const DEBOUNCE_DELAY = 300;

const SidebarNodesTabView = ({
  Footer,
  categorizedNodes,
}: {
  Footer?: React.ReactNode;
  categorizedNodes: CategorizedSidebarNodes;
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accordionValue, setAccordionValue] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, DEBOUNCE_DELAY);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const { filteredNodes, totalResults } = useMemo(() => {
    return filterCategorizedSidebarNodes(categorizedNodes, debouncedSearch);
  }, [categorizedNodes, debouncedSearch]);
  const isSearching = debouncedSearch.trim().length > 0;
  const renderedAccordionValue = isSearching ? Object.keys(filteredNodes) : accordionValue;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-1 shrink-0 flex-col gap-4 px-4 pt-4">
        <InputGroup className="max-w-xs">
          <InputGroupInput
            placeholder="Search..."
            value={searchQuery}
            onChange={handleSearchChange}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          {debouncedSearch.trim() !== '' && (
            <InputGroupAddon align="inline-end">
              {totalResults} {totalResults === 1 ? 'result' : 'results'}
            </InputGroupAddon>
          )}
        </InputGroup>
        <ScrollArea className="h-full min-h-0 flex-1">
          <Accordion
            className="w-full"
            type="multiple"
            value={renderedAccordionValue}
            onValueChange={(nextValue) => {
              if (!isSearching) {
                setAccordionValue(nextValue);
              }
            }}
          >
            {Object.entries(filteredNodes).map(([category, categoryNodes]) => (
              <AccordionItem key={`${category}-${categoryNodes?.length}`} value={category}>
                <AccordionTrigger>
                  <h3 className="text-sm font-semibold">{createDisplayName(category)}</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {categoryNodes?.map((node) => (
                      <DraggableNode
                        key={node.type}
                        description={node.description}
                        displayName={node.displayName}
                        type={node.type}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
        {Footer}
      </div>
    </TooltipProvider>
  );
};

const SidebarNodesTabContent = ({ Footer }: { Footer: React.ReactNode }) => {
  const { nodeSchemas, nodeHandlers } = useFlow();

  const categorizedNodes = useMemo(() => {
    return categorizeSidebarNodes(nodes(nodeSchemas, nodeHandlers));
  }, [nodeHandlers, nodeSchemas]);

  return <SidebarNodesTabView Footer={Footer} categorizedNodes={categorizedNodes} />;
};

/**
 * Pre-built sidebar tab for browsing and searching available node types.
 *
 * Displays nodes grouped by category in an accordion layout with fuzzy search
 * and debounced filtering. Nodes are draggable onto the canvas.
 *
 * @example
 * ```tsx
 * <FluxerySidebar>
 *   <SidebarNodesTab />
 * </FluxerySidebar>
 * ```
 */
export const SidebarNodesTab = createFluxerySidebarTab({
  id: 'nodes',
  label: 'Nodes',
  contentClassName: 'min-h-0 h-full',
  render: ({ Footer }: { Footer: React.ReactNode }) => <SidebarNodesTabContent Footer={Footer} />,
});
