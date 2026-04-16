import { WorkspaceShell } from '@/components/workspace-shell';
import { WorkspaceThemeProvider } from '@/components/workspace-theme-provider';
import { requireSession } from '@/lib/require-session';

const ConsoleLayout = async ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  await requireSession();

  return (
    <WorkspaceThemeProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceThemeProvider>
  );
};

export default ConsoleLayout;
