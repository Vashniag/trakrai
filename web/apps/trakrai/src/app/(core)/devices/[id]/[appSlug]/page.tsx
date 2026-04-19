'use client';

import { useParams } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import { useDeviceRouteContext } from '@/components/device-route-shell';

const DynamicDeviceAppRoutePage = () => {
  const params = useParams<{ appSlug: string }>();
  const routeContext = useDeviceRouteContext();
  const appSlug = params.appSlug.trim();

  const component = routeContext.components.find(
    (componentRow) => componentRow.routePath === appSlug,
  );

  if (component === undefined) {
    return (
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle>Device app not found</CardTitle>
          <CardDescription>This route does not match any registered device app.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle>{component.navigationLabel}</CardTitle>
        <CardDescription>
          Device app registered dynamically. Cloud renderer not mapped yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 py-6 text-sm">
        <p>{component.description ?? 'No description provided.'}</p>
        <div>
          <span className="text-muted-foreground">Renderer key:</span>{' '}
          {component.rendererKey ?? 'None'}
        </div>
        <div>
          <span className="text-muted-foreground">Service:</span> {component.serviceName}
        </div>
        <div>
          <span className="text-muted-foreground">Access:</span> {component.accessLevel}
        </div>
      </CardContent>
    </Card>
  );
};

export default DynamicDeviceAppRoutePage;
