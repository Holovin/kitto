export function getBackendApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return '/api';
  }

  return configuredBaseUrl.replace(/\/$/, '');
}
