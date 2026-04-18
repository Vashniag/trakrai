/** Metadata describing a single node type for display in the sidebar. */
export type SidebarNodeDescriptor = {
  /** The registered node type key. */
  type: string;
  /** Human-readable display name. */
  displayName: string;
  /** Category used for grouping in the sidebar accordion. */
  category: string;
  /** Short description shown in the tooltip. */
  description: string;
};

/** Nodes grouped by category name. */
export type CategorizedSidebarNodes = Partial<Record<string, SidebarNodeDescriptor[]>>;

/**
 * Tests whether `text` contains `search` as a fuzzy subsequence match.
 *
 * First checks for a direct substring match, then falls back to character-by-character
 * subsequence matching.
 *
 * @param text - The text to search within.
 * @param search - The search query.
 * @returns `true` if all characters of `search` appear in order within `text`.
 */
export const fuzzyMatch = (text: string, search: string): boolean => {
  const searchLower = search.toLowerCase();
  const textLower = text.toLowerCase();
  if (textLower.includes(searchLower)) {
    return true;
  }
  let searchIndex = 0;
  for (let i = 0; i < textLower.length && searchIndex < searchLower.length; i++) {
    if (textLower[i] === searchLower[searchIndex]) {
      searchIndex++;
    }
  }
  return searchIndex === searchLower.length;
};

/**
 * Groups an array of node descriptors by their `category` field.
 *
 * @param nodes - Flat array of node descriptors.
 * @returns An object mapping category names to arrays of node descriptors.
 */
export const categorizeSidebarNodes = (nodes: SidebarNodeDescriptor[]): CategorizedSidebarNodes => {
  const categorizedNodes: CategorizedSidebarNodes = {};
  for (const node of nodes) {
    const categoryNodes = categorizedNodes[node.category] ?? [];
    categoryNodes.push(node);
    categorizedNodes[node.category] = categoryNodes;
  }
  return categorizedNodes;
};

/**
 * Filters categorized nodes by a fuzzy search query.
 *
 * Matches against display name, type, description, and category. Returns the
 * filtered categories and the total number of matching results.
 *
 * @param categorizedNodes - Nodes grouped by category.
 * @param search - The search query string. Returns all nodes unchanged if blank.
 * @returns An object with `filteredNodes` and `totalResults` count.
 */
export const filterCategorizedSidebarNodes = (
  categorizedNodes: CategorizedSidebarNodes,
  search: string,
) => {
  if (search.trim() === '') {
    return { filteredNodes: categorizedNodes, totalResults: 0 };
  }

  const filtered: CategorizedSidebarNodes = {};
  let count = 0;

  for (const [category, nodes] of Object.entries(categorizedNodes)) {
    const matchedNodes = nodes?.filter((node) => {
      return (
        fuzzyMatch(node.displayName, search) ||
        fuzzyMatch(node.type, search) ||
        fuzzyMatch(node.description, search) ||
        fuzzyMatch(category, search)
      );
    });

    if (matchedNodes != null && matchedNodes.length > 0) {
      filtered[category] = matchedNodes;
      count += matchedNodes.length;
    }
  }

  return { filteredNodes: filtered, totalResults: count };
};
