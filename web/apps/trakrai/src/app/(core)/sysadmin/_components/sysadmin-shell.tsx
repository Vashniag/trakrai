import Link from 'next/link';

import { Button } from '@trakrai/design-system/components/button';

import { WorkspaceShell } from '@/components/hierarchy/workspace-shell';

type SysadminTab = 'apps' | 'departments' | 'devices' | 'factories';

const tabs: ReadonlyArray<{
  description: string;
  href: string;
  id: SysadminTab;
  label: string;
}> = [
  {
    description: 'Factory directory and top-level counts.',
    href: '/sysadmin/factories',
    id: 'factories',
    label: 'Factories',
  },
  {
    description: 'Department management and device totals.',
    href: '/sysadmin/departments',
    id: 'departments',
    label: 'Departments',
  },
  {
    description: 'Device inventory and enabled app counts.',
    href: '/sysadmin/devices',
    id: 'devices',
    label: 'Devices',
  },
  {
    description: 'Device app catalog and installation reach.',
    href: '/sysadmin/apps',
    id: 'apps',
    label: 'Apps',
  },
] as const;

type SysadminShellProps = Readonly<{
  children: React.ReactNode;
  currentTab: SysadminTab;
  description: string;
  stats: React.ReactNode;
  title: string;
}>;

export const SysadminShell = ({
  children,
  currentTab,
  description,
  stats,
  title,
}: SysadminShellProps) => (
  <WorkspaceShell
    actions={
      <Button asChild size="sm" variant="outline">
        <Link href="/access-control">Advanced Permissions</Link>
      </Button>
    }
    currentSidebarItemId={currentTab}
    description={description}
    eyebrow="Sysadmin Panel"
    sidebarDescription="Dedicated management surface for high-volume hierarchy operations."
    sidebarItems={tabs.map((tab) => ({
      description: tab.description,
      href: tab.href,
      id: tab.id,
      label: tab.label,
    }))}
    sidebarTitle="Admin Tabs"
    stats={stats}
    title={title}
  >
    {children}
  </WorkspaceShell>
);
