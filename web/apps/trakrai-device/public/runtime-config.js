(function applyDeviceUiRuntimeConfig() {
  const { hostname, protocol } = window.location;
  const httpProtocol = protocol === 'https:' ? 'https:' : 'http:';
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  const host = hostname || '127.0.0.1';

  window.__TRAKRAI_DEVICE_UI_CONFIG__ = {
    deviceId: 'trakrai-device-local',
    transportMode: 'edge',
    cloudBridgeUrl: `${wsProtocol}//${host}:8090/ws`,
    edgeBridgeUrl: `${httpProtocol}//${host}:8080`,
    diagnosticsEnabled: true,
  };
})();
