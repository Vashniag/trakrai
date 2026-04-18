import { HeaderPortalProvider } from '@trakrai/design-system/components/app-header';

import { EdgeCoreHeader } from '@/components/edge-core-header';

const CoreLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <HeaderPortalProvider>
    <EdgeCoreHeader />
    {children}
  </HeaderPortalProvider>
);

export default CoreLayout;
