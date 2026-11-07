/**
 * إعدادات الاتصال المرن بالخادم الخلفي (يدعم الاستضافة الموحدة أو فصل الواجهة على Vercel عن الخادم)
 */

const rawBase = (import.meta as any).env?.VITE_API_BASE_URL || "";
export const API_BASE_URL = rawBase.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

export function wsUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE_URL) {
    const wsBase = API_BASE_URL.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    return `${wsBase}${cleanPath}`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${cleanPath}`;
}

export async function safeFetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), init);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
