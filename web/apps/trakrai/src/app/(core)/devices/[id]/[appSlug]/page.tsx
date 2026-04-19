'use client';

import { useParams } from 'next/navigation';

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
      <section className="border p-6">
        <h1 className="text-lg font-semibold tracking-tight">Device app not found</h1>
      </section>
    );
  }

  return (
    <section className="space-y-4 border p-6 text-sm">
      <h1 className="text-lg font-semibold tracking-tight">{component.navigationLabel}</h1>
      <div className="space-y-3">
        {component.description?.trim() !== '' ? <p>{component.description}</p> : null}
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
      </div>
    </section>
  );
};

export default DynamicDeviceAppRoutePage;
