export function isDev() {
  return import.meta.env.DEV;
}

export function isProd() {
  return import.meta.env.PROD;
}

export function getApiBaseUrl() {
  return ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api').replace(/\/$/, '');
}

export function getApiUrl(path: string) {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${safePath}`;
}
