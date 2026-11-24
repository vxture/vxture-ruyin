/** Desktop device views. Policy and admission remain platform-owned. */
export interface DesktopDevice {
  id: string;
  name: string;
  platform: string;
  lastActiveAt: string;
  current: boolean;
}

export interface DesktopDeviceList {
  limit: number;
  devices: DesktopDevice[];
}

export type DesktopDevicesView = { supported: false } | ({ supported: true } & DesktopDeviceList);
export type DesktopLoginState =
  | ({ state: "device_limit" } & DesktopDeviceList)
  | { state: "failed" | "timed_out" };

export class DesktopDevicesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "DesktopDevicesError";
  }
}

export function validDesktopDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Whitelist the response: credentials and arbitrary upstream fields never reach UI. */
export function desktopDeviceList(raw: unknown): DesktopDeviceList {
  const fail = (): never => { throw new DesktopDevicesError(502, "DESKTOP_DEVICES_INVALID", "Invalid desktop device response"); };
  if (!raw || typeof raw !== "object") return fail();
  const { limit, devices } = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || !Array.isArray(devices) || devices.length > 1000) return fail();
  const seen = new Set<string>();
  const list = devices.map((value: unknown): DesktopDevice => {
    if (!value || typeof value !== "object") return fail();
    const d = value as Record<string, unknown>;
    if (!validDesktopDeviceId(d["id"]) || seen.has(d["id"]) ||
        typeof d["name"] !== "string" || !d["name"].trim() || d["name"].length > 120 ||
        typeof d["platform"] !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(d["platform"]) ||
        typeof d["lastActiveAt"] !== "string" || !Number.isFinite(Date.parse(d["lastActiveAt"])) ||
        d["current"] !== undefined && typeof d["current"] !== "boolean") return fail();
    seen.add(d["id"]);
    return { id: d["id"], name: d["name"], platform: d["platform"],
      lastActiveAt: new Date(d["lastActiveAt"]).toISOString(), current: d["current"] === true };
  });
  if (list.filter(d => d.current).length > 1) return fail();
  return { limit: limit as number, devices: list };
}
