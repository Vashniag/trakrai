import { describe, expect, it } from 'vitest';

import {
  categorizeSidebarNodes,
  filterCategorizedSidebarNodes,
  fuzzyMatch,
} from '../../../ui/sidebar/nodes/sidebar-nodes-tab-utils';

const STRINGS_CATEGORY = 'strings';
const HTTP_REQUEST_NAME = 'HTTP Request';

const sidebarNodes = [
  {
    type: 'httpRequest',
    displayName: HTTP_REQUEST_NAME,
    category: 'networking',
    description: 'Send an HTTP request',
  },
  {
    type: 'splitString',
    displayName: 'Split String',
    category: STRINGS_CATEGORY,
    description: 'Split a string by delimiter',
  },
  {
    type: 'concatString',
    displayName: 'Concat String',
    category: STRINGS_CATEGORY,
    description: 'Join string values',
  },
];

describe('sidebar-nodes-tab-utils', () => {
  it('supports direct and fuzzy matching', () => {
    expect(fuzzyMatch(HTTP_REQUEST_NAME, 'request')).toBe(true);
    expect(fuzzyMatch(HTTP_REQUEST_NAME, 'htr')).toBe(true);
    expect(fuzzyMatch(HTTP_REQUEST_NAME, 'xyz')).toBe(false);
  });

  it('categorizes sidebar nodes by category', () => {
    const categorized = categorizeSidebarNodes(sidebarNodes);

    expect(categorized.networking).toHaveLength(1);
    expect(categorized[STRINGS_CATEGORY]).toHaveLength(2);
  });

  it('returns all categories when search query is empty', () => {
    const categorized = categorizeSidebarNodes(sidebarNodes);

    const result = filterCategorizedSidebarNodes(categorized, '');

    expect(result.totalResults).toBe(0);
    expect(Object.keys(result.filteredNodes)).toEqual(
      expect.arrayContaining(['networking', STRINGS_CATEGORY]),
    );
  });

  it('filters categories and counts matches for non-empty search query', () => {
    const categorized = categorizeSidebarNodes(sidebarNodes);

    const result = filterCategorizedSidebarNodes(categorized, 'split');

    expect(result.totalResults).toBe(1);
    expect(result.filteredNodes[STRINGS_CATEGORY]?.map((node) => node.type)).toEqual([
      'splitString',
    ]);
    expect(result.filteredNodes.networking).toBeUndefined();
  });
});
