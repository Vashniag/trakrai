'use client';

import { useEffect, useState } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Separator } from '@trakrai/design-system/components/separator';
import { toast } from 'sonner';

import {
  DEFAULT_DEVICE_UI_RUNTIME_CONFIG,
  getActiveTransportEndpoint,
  readDeviceUiRuntimeConfig,
  type DeviceTransportMode,
  type DeviceUiRuntimeConfig,
} from '@/lib/runtime-config';

type SharedSurface = {
  id: string;
  label: string;
  detail: string;
  readiness: string;
};

const sharedSurfaces: SharedSurface[] = [
  {
    id: 'live-view',
    label: 'Live view',
    detail:
      'Shared viewport shell that can keep the same UI whether packets arrive through the cloud bridge or the on-device HTTP bridge.',
    readiness: 'Ready to wire',
  },
  {
    id: 'ptz-control',
    label: 'PTZ control',
    detail:
      'Client-side control surface that can publish the same command envelopes to either transport path.',
    readiness: 'Ready to wire',
  },
  {
    id: 'device-health',
    label: 'Device health',
    detail:
      'Status cards, diagnostics, and future service telemetry that should remain transport-agnostic.',
    readiness: 'Shared foundation',
  },
];

const deploymentChecks = [
  'Build once into static assets with Next export.',
  'Serve the generated out directory from the device runtime.',
  'Point public/runtime-config.js at either the cloud bridge or the local HTTP bridge.',
  'Keep shared UI surfaces stable while transport adapters evolve underneath them.',
];

const modeLabels: Record<DeviceTransportMode, string> = {
  cloud: 'Cloud relay',
  edge: 'Edge HTTP bridge',
};

const modeDescriptions: Record<DeviceTransportMode, string> = {
  cloud:
    'Use the device-resident MQTT bridge as the path to cloud-connected control and signaling.',
  edge: 'Use the on-device HTTP endpoint so the static app can talk to the local bridge directly.',
};

const getEndpointForMode = (
  mode: DeviceTransportMode,
  runtimeConfig: DeviceUiRuntimeConfig,
): string => (mode === 'cloud' ? runtimeConfig.cloudBridgeUrl : runtimeConfig.edgeBridgeUrl);

export const DeviceAppShell = () => {
  const [runtimeConfig, setRuntimeConfig] = useState(DEFAULT_DEVICE_UI_RUNTIME_CONFIG);
  const [selectedMode, setSelectedMode] = useState<DeviceTransportMode>(
    DEFAULT_DEVICE_UI_RUNTIME_CONFIG.transportMode,
  );
  const [endpointDraft, setEndpointDraft] = useState(
    getActiveTransportEndpoint(DEFAULT_DEVICE_UI_RUNTIME_CONFIG),
  );
  const [hasLoadedRuntimeConfig, setHasLoadedRuntimeConfig] = useState(false);

  useEffect(() => {
    const nextConfig = readDeviceUiRuntimeConfig();

    setRuntimeConfig(nextConfig);
    setSelectedMode(nextConfig.transportMode);
    setEndpointDraft(getActiveTransportEndpoint(nextConfig));
    setHasLoadedRuntimeConfig(true);
  }, []);

  useEffect(() => {
    setEndpointDraft(getEndpointForMode(selectedMode, runtimeConfig));
  }, [runtimeConfig, selectedMode]);

  const activeEndpoint = endpointDraft.trim();
  const previewEnvelope = JSON.stringify(
    {
      requestId: 'preview-live-start',
      deviceId: runtimeConfig.deviceId,
      service: 'live-view',
      action: 'start-session',
      transport: selectedMode,
      target: activeEndpoint,
      payload: {
        cameraName: 'front-gate',
        executeSideEffects: false,
      },
    },
    null,
    2,
  );

  const handlePreviewTransport = () => {
    toast.message(`${modeLabels[selectedMode]} selected`, {
      description:
        activeEndpoint === ''
          ? 'Set the bridge endpoint in runtime-config.js before wiring packets.'
          : `Packets will be routed through ${activeEndpoint}.`,
    });
  };

  const handleCopyPreviewPacket = async () => {
    try {
      await navigator.clipboard.writeText(previewEnvelope);
      toast.success('Preview envelope copied to clipboard.');
    } catch {
      toast.error('Clipboard access is unavailable in this browser.');
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden border-black/10 bg-white/80 shadow-[0_20px_70px_-45px_rgba(15,23,42,0.55)] backdrop-blur">
          <CardHeader className="border-b border-black/10 bg-[linear-gradient(120deg,rgba(251,191,36,0.16),rgba(15,118,110,0.08))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-[11px] tracking-[0.22em] uppercase">
                  <span className="border border-black/10 bg-white/70 px-2 py-1">
                    Static export
                  </span>
                  <span className="border border-black/10 bg-white/70 px-2 py-1">Client only</span>
                  <span className="border border-black/10 bg-white/70 px-2 py-1">
                    Runtime configurable
                  </span>
                </div>
                <div>
                  <CardTitle className="text-3xl tracking-[-0.04em] text-slate-950">
                    TrakrAI device app shell
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">
                    A dedicated Next.js target for on-device hosting, built to keep shared UI
                    surfaces stable while the connectivity layer can flip between cloud and edge
                    routing.
                  </CardDescription>
                </div>
              </div>
              <div className="min-w-[220px] border border-black/10 bg-white/70 p-4">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  Effective route
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-950">
                  {modeLabels[selectedMode]}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600">{activeEndpoint}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 py-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-black/10 bg-slate-950 p-4 text-white">
                  <div className="text-[11px] tracking-[0.18em] text-white/55 uppercase">
                    Device ID
                  </div>
                  <div className="mt-2 text-sm font-medium">{runtimeConfig.deviceId}</div>
                </div>
                <div className="border border-black/10 bg-white p-4">
                  <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    Runtime source
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-900">
                    {hasLoadedRuntimeConfig ? 'public/runtime-config.js' : 'Build defaults'}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  Deployment contract
                </div>
                <div className="space-y-2">
                  {deploymentChecks.map((step) => (
                    <div
                      key={step}
                      className="border border-black/10 bg-white/65 px-3 py-3 text-sm text-slate-700"
                    >
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 border border-black/10 bg-white/60 p-4">
              <div className="space-y-2">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  Transport mode
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['edge', 'cloud'] as DeviceTransportMode[]).map((mode) => {
                    const isActive = selectedMode === mode;

                    return (
                      <button
                        key={mode}
                        className={`border px-4 py-4 text-left transition ${
                          isActive
                            ? 'border-slate-950 bg-slate-950 text-white'
                            : 'border-black/10 bg-white text-slate-800 hover:border-slate-400'
                        }`}
                        type="button"
                        onClick={() => {
                          setSelectedMode(mode);
                        }}
                      >
                        <div className="text-sm font-semibold">{modeLabels[mode]}</div>
                        <div
                          className={`mt-2 text-xs leading-5 ${
                            isActive ? 'text-white/75' : 'text-slate-600'
                          }`}
                        >
                          {modeDescriptions[mode]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  Active endpoint
                </div>
                <Input
                  readOnly
                  value={activeEndpoint}
                  onChange={() => {
                    return;
                  }}
                />
                <div className="text-xs leading-5 text-slate-600">
                  Update the matching value in <code>public/runtime-config.js</code> on the device
                  to repoint the static app without rebuilding.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handlePreviewTransport}>
                  Preview routing
                </Button>
                <Button type="button" variant="outline" onClick={handleCopyPreviewPacket}>
                  Copy sample packet
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  Packet preview
                </div>
                <pre className="overflow-x-auto border border-black/10 bg-slate-950 p-4 text-xs leading-6 text-emerald-200">
                  {previewEnvelope}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 bg-slate-950 text-white shadow-[0_18px_60px_-42px_rgba(15,23,42,0.8)]">
          <CardHeader className="border-b border-white/10">
            <CardTitle className="text-xl tracking-[-0.03em]">Shared surface map</CardTitle>
            <CardDescription className="text-white/65">
              These are the first UI layers that can stay transport-agnostic while the bridge
              underneath them changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 py-6">
            {sharedSurfaces.map((surface) => (
              <div key={surface.id} className="border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{surface.label}</div>
                    <div className="mt-2 text-sm leading-6 text-white/70">{surface.detail}</div>
                  </div>
                  <span className="border border-white/15 px-2 py-1 text-[10px] tracking-[0.18em] text-amber-200 uppercase">
                    {surface.readiness}
                  </span>
                </div>
              </div>
            ))}
            <div className="border border-dashed border-white/15 px-4 py-3 text-sm leading-6 text-white/60">
              The app stays fully static. Runtime behavior is driven by the bridge endpoint and
              transport mode loaded from the device-local config script.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
};
