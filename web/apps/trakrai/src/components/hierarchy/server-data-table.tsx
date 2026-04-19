'use client';

import { DataTable } from '@trakrai/design-system/components/data-table';
import { DataTableToolbar } from '@trakrai/design-system/components/data-table/data-table-toolbar';
import { useDataTable } from '@trakrai/design-system/hooks/use-data-table';

import type { ColumnDef } from '@tanstack/react-table';

const DEFAULT_PAGE_SIZE = 20;

type ServerDataTableProps<TData extends { id: string }> = Readonly<{
  columns: ColumnDef<TData>[];
  data: TData[];
  emptyState?: React.ReactNode;
  pageCount: number;
  toolbarChildren?: React.ReactNode;
  viewOptions?: boolean;
}>;

export const ServerDataTable = <TData extends { id: string }>({
  columns,
  data,
  emptyState,
  pageCount,
  toolbarChildren,
  viewOptions = false,
}: ServerDataTableProps<TData>) => {
  const { table } = useDataTable({
    columns,
    data,
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: DEFAULT_PAGE_SIZE,
      },
    },
    pageCount,
    shallow: false,
  });

  return (
    <DataTable className="min-h-0 flex-1" getItemValue={(item) => item.id} table={table}>
      <DataTableToolbar table={table} viewOptions={viewOptions}>
        {toolbarChildren}
      </DataTableToolbar>
      {emptyState}
    </DataTable>
  );
};
