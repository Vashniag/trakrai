import { HeaderPortalProvider } from '@trakrai/design-system/components/app-header';

const CoreLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => <HeaderPortalProvider>{children}</HeaderPortalProvider>;

export default CoreLayout;
