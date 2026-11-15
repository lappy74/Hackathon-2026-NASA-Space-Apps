const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = configuredApiUrl
  ? configuredApiUrl.replace(/\/$/, "")
  : "";

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
