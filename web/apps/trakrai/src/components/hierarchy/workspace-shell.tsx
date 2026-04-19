'use client';

import { Fragment, useMemo, useState } from 'react';

import Link from 'next/link';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@trakrai/design-system/components/breadcrumb';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import { Separator } from '@trakrai/design-system/components/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@trakrai/design-system/components/sidebar';

import { CloudCoreHeader } from '@/components/cloud-core-header';

type WorkspaceSidebarItem = Readonly<{
  badge?: number | string;
  description?: string | null;
  href: string;
  id: string;
  label: string;
  meta?: string | null;
}>;

type WorkspaceShellProps = Readonly<{
  actions?: React.ReactNode;
  breadcrumbs: ReadonlyArray<{
    href?: string;
    label: string;
  }>;
  children: React.ReactNode;
  currentSidebarItemId: string;
  description: string;
  eyebrow?: string;
  sidebarDescription: string;
  sidebarItems: WorkspaceSidebarItem[];
  sidebarTitle: string;
  stats: React.ReactNode;
  title: string;
}>;
const SidebarList = ({
  currentSidebarItemId,
  items,
  title,
}: Readonly<{
  currentSidebarItemId: string;
  items: WorkspaceSidebarItem[];
  title: string;
}>) => {
  const [filterValue, setFilterValue] = useState('');

  const filteredItems = useMemo(() => {
    const normalizedFilter = filterValue.trim().toLowerCase();
    if (normalizedFilter === '') {
      return items;
    }

    return items.filter((item) =>
      [item.label, item.description]
        .filter((value): value is string => value !== undefined && value !== null && value !== '')
        .some((value) => value.toLowerCase().includes(normalizedFilter)),
    );
  }, [filterValue, items]);

  return (
    <>
      <SidebarHeader className="gap-3 border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/factories">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <span className="text-sm font-semibold">T</span>
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium">TrakrAI</span>
                  <span>{title}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput
          aria-label={`Filter ${title.toLowerCase()}`}
          placeholder={`Search ${title.toLowerCase()}`}
          value={filterValue}
          onChange={(event) => {
            setFilterValue(event.target.value);
          }}
        />
      </SidebarHeader>

      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="min-h-0 flex-1 p-0">
          <div className="flex items-center justify-between px-4 pt-3">
            <SidebarGroupLabel className="h-auto px-0 py-0">
              {filterValue.trim() === '' ? title : 'Filtered results'}
            </SidebarGroupLabel>
            <div className="text-sidebar-foreground/50 text-[11px] tracking-[0.18em] uppercase">
              {filteredItems.length}
            </div>
          </div>

          <SidebarGroupContent className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-2">
                <SidebarMenu>
                  {filteredItems.map((item) => {
                    const isActive = item.id === currentSidebarItemId;

                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.href}>
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                        {item.badge !== undefined ? (
                          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>

                {filteredItems.length === 0 ? (
                  <div className="text-sidebar-foreground/60 px-3 py-8 text-sm">
                    No {title.toLowerCase()} match that filter.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
};

export const WorkspaceShell = ({
  actions,
  breadcrumbs,
  children,
  currentSidebarItemId,
  sidebarItems,
  sidebarTitle,
  stats,
}: WorkspaceShellProps) => (
  <SidebarProvider className="bg-background h-svh min-h-svh overflow-hidden">
    <Sidebar className="h-svh border-r" collapsible="offcanvas">
      <SidebarList
        currentSidebarItemId={currentSidebarItemId}
        items={sidebarItems}
        title={sidebarTitle}
      />
      <SidebarSeparator />
      <SidebarRail />
    </Sidebar>

    <SidebarInset className="min-h-svh overflow-hidden">
      <CloudCoreHeader
        leftContent={
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              orientation="vertical"
            />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                {breadcrumbs.map((item, index) => {
                  const isLastItem = index === breadcrumbs.length - 1;

                  return (
                    <Fragment key={item.href ?? item.label}>
                      <BreadcrumbItem className={isLastItem ? undefined : 'hidden md:inline-flex'}>
                        {isLastItem || item.href === undefined ? (
                          <BreadcrumbPage>{item.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={item.href}>{item.label}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {!isLastItem ? <BreadcrumbSeparator className="hidden md:block" /> : null}
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        }
      />

      <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 py-6 md:px-8">
          {actions !== undefined ? (
            <div className="flex shrink-0 items-center justify-end gap-3">{actions}</div>
          ) : null}
          <section className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">{stats}</section>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
);
