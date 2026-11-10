/** Browser-side helpers for Web Push. Pure functions so they can be unit-tested. */

/** VAPID public keys are base64url; PushManager.subscribe wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState =
  | "loading"
  | "install_first" // iPhone/iPad in Safari: push only works once the app is on the Home Screen
  | "unsupported"
  | "blocked" // the person denied permission in the browser
  | "off"
  | "on";

export interface Env {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied";
  subscribed: boolean;
}

/** iPhones, iPads, and iPadOS pretending to be a Mac. */
export function isIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

/**
 * Which screen the notification card should show. iOS is gated: until the app is installed, we show the
 * install steps instead of a button that would silently fail, and never ask for permission.
 */
export function pushState(env: Env): PushState {
  if (isIos(env.userAgent, env.platform, env.maxTouchPoints) && !env.standalone) return "install_first";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (env.permission === "denied") return "blocked";
  if (env.permission === "granted" && env.subscribed) return "on";
  return "off";
}
