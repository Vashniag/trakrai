import { WorkspaceShell } from '@/components/hierarchy/workspace-shell';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type AccessControlTab = 'apps' | 'departments' | 'devices' | 'factories' | 'users';

type AccessControlNavigation = RouterOutput['accessControl']['getNavigation'];

const tabs: ReadonlyArray<{
  description: string;
  href: string;
  id: AccessControlTab;
  label: string;
}> = [
  {
    description: 'Better Auth account lifecycle and system-role controls.',
    href: '/access-control/users',
    id: 'users',
    label: 'Users',
  },
  {
    description: 'Device viewer assignments and installation counts.',
    href: '/access-control/devices',
    id: 'devices',
    label: 'Devices',
  },
  {
    description: 'Department subtree access and delegated admins.',
    href: '/access-control/departments',
    id: 'departments',
    label: 'Departments',
  },
  {
    description: 'Factory-level inherited admin and viewer assignments.',
    href: '/access-control/factories',
    id: 'factories',
    label: 'Factories',
  },
  {
    description: 'Device app catalog and rollout status.',
    href: '/access-control/apps',
    id: 'apps',
    label: 'Apps',
  },
] as const;

type AccessControlShellProps = Readonly<{
  children: React.ReactNode;
  currentTab: AccessControlTab;
  description: string;
  navigation: AccessControlNavigation;
  stats: React.ReactNode;
  title: string;
}>;

export const AccessControlShell = ({
  children,
  currentTab,
  navigation,
  stats,
  title,
}: AccessControlShellProps) => (
  <WorkspaceShell
    breadcrumbs={[
      { href: '/access-control/users', label: 'Admin' },
      { label: tabs.find((tab) => tab.id === currentTab)?.label ?? title },
    ]}
    currentSidebarItemId={currentTab}
    description=""
    eyebrow={undefined}
    sidebarDescription=""
    sidebarItems={tabs
      .filter((tab) => {
        switch (tab.id) {
          case 'users':
            return navigation.showUsers;
          case 'factories':
            return navigation.showFactories;
          case 'departments':
            return navigation.showDepartments;
          case 'devices':
            return navigation.showDevices;
          case 'apps':
            return navigation.showApps;
        }
      })
      .map((tab) => ({
        description: tab.description,
        href: tab.href,
        id: tab.id,
        label: tab.label,
      }))}
    sidebarTitle="Admin"
    stats={stats}
    title={title}
  >
    {children}
  </WorkspaceShell>
);
