export function isDev() {
  return import.meta.env.DEV;
}

export function isProd() {
  return import.meta.env.PROD;
}

export function getBackendBaseUrl() {
  return (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

export function getBackendUrl(path: string) {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${getBackendBaseUrl()}${safePath}`;
}
