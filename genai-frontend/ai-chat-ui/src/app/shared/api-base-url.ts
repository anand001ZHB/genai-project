import { environment } from '../../environments/environment';

export function resolveApiBaseUrl(): string {
  const configuredBase = ((environment as any).apiBaseUrl || (environment as any).apiUrl || '').replace(/\/+$/, '');

  if (typeof window === 'undefined') {
    return configuredBase || '';
  }

  const { protocol, hostname } = window.location;

  if (hostname.endsWith('.app.github.dev')) {
    const derivedHost = hostname.replace(/-\d+\.app\.github\.dev$/, '-3000.app.github.dev');
    const derivedBaseUrl = `${protocol}//${derivedHost}`;

    if (!configuredBase) {
      return derivedBaseUrl;
    }

    try {
      const configuredHost = new URL(configuredBase).hostname;
      return configuredHost.endsWith('.app.github.dev') ? derivedBaseUrl : configuredBase;
    } catch {
      return configuredBase;
    }
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return configuredBase || `${protocol}//${hostname}:3000`;
  }

  return configuredBase || '';
}
