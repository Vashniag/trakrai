'use client';

import { createContext, useContext, type ReactNode } from 'react';

import {
  useLiveDeviceConnection,
  type LiveDeviceConnectionState,
  type LiveTransportConfig,
} from '../hooks/use-live-device-connection';

type LiveWorkspaceProviderProps = Readonly<
  LiveTransportConfig & {
    children: ReactNode;
  }
>;

const LiveWorkspaceContext = createContext<LiveDeviceConnectionState | null>(null);

export const LiveWorkspaceProvider = ({
  children,
  deviceId,
  httpBaseUrl,
  signalingUrl,
}: LiveWorkspaceProviderProps) => {
  const value = useLiveDeviceConnection({
    deviceId,
    httpBaseUrl,
    signalingUrl,
  });

  return <LiveWorkspaceContext.Provider value={value}>{children}</LiveWorkspaceContext.Provider>;
};

export const useLiveWorkspaceContext = (): LiveDeviceConnectionState => {
  const contextValue = useContext(LiveWorkspaceContext);

  if (contextValue === null) {
    throw new Error('useLiveWorkspaceContext must be used within LiveWorkspaceProvider');
  }

  return contextValue;
};
