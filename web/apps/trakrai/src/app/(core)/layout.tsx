import { HeaderPortalProvider } from '@trakrai/design-system/components/app-header';

import { CloudCoreHeader } from '@/components/cloud-core-header';

const CoreLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <HeaderPortalProvider>
    <CloudCoreHeader />
    {children}
  </HeaderPortalProvider>
);

export default CoreLayout;
