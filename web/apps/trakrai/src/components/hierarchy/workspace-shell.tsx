import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@trakrai/design-system/components/card';
import { cn } from '@trakrai/design-system/lib/utils';

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

const ACTIVE_CLASSES = 'border-primary/30 bg-primary/8 text-foreground';
const IDLE_CLASSES =
  'border-border/80 bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground';

const SidebarList = ({
  currentSidebarItemId,
  items,
  title,
  description,
}: Readonly<{
  currentSidebarItemId: string;
  description: string;
  items: WorkspaceSidebarItem[];
  title: string;
}>) => (
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">{title}</CardTitle>
      <div className="text-muted-foreground text-sm">{description}</div>
    </CardHeader>
    <CardContent className="space-y-2 py-4">
      {items.map((item) => {
        const isActive = item.id === currentSidebarItemId;

        return (
          <Link
            key={item.id}
            className={cn(
              'block border p-3 transition-colors',
              isActive ? ACTIVE_CLASSES : IDLE_CLASSES,
            )}
            href={item.href}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{item.label}</div>
                {item.description !== undefined &&
                item.description !== null &&
                item.description !== '' ? (
                  <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                    {item.description}
                  </div>
                ) : null}
                {item.meta !== undefined && item.meta !== null && item.meta !== '' ? (
                  <div className="text-muted-foreground mt-2 text-[11px] tracking-[0.14em] uppercase">
                    {item.meta}
                  </div>
                ) : null}
              </div>
              {item.badge !== undefined ? (
                <div className="border px-2 py-1 text-[10px] tracking-[0.18em] uppercase">
                  {item.badge}
                </div>
              ) : null}
            </div>
          </Link>
        );
      })}
    </CardContent>
  </Card>
);

export const WorkspaceShell = ({
  actions,
  children,
  currentSidebarItemId,
  description,
  eyebrow,
  sidebarDescription,
  sidebarItems,
  sidebarTitle,
  stats,
  title,
}: WorkspaceShellProps) => (
  <main className="bg-background min-h-[calc(100vh-3.5rem)] px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {eyebrow !== undefined ? (
            <div className="text-muted-foreground text-[11px] tracking-[0.22em] uppercase">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground max-w-4xl text-sm">{description}</p>
        </div>
        {actions}
      </section>

      <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <SidebarList
            currentSidebarItemId={currentSidebarItemId}
            description={sidebarDescription}
            items={sidebarItems}
            title={sidebarTitle}
          />
        </div>

        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{stats}</section>
          {children}
        </div>
      </div>
    </div>
  </main>
);
