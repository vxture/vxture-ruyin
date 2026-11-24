/** Desktop authorization controls shared by login and account settings. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Icon,
} from "@vxture/design-system";
import { type Api, type DesktopDevice, type DesktopDeviceList, type DesktopDevicesView } from "./api";
import { useLocale, useT } from "./i18n";

const platformNames: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function DesktopDevicePicker({ view, mode, onRelease, onRefresh, secondaryActions }: {
  view: DesktopDeviceList;
  mode: "login" | "manage";
  onRelease: (id: string) => Promise<void>;
  onRefresh: () => Promise<unknown>;
  secondaryActions?: ReactNode;
}) {
  const t = useT(), locale = useLocale();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmation, setConfirmation] = useState<DesktopDevice>();
  const releaseLock = useRef(false);
  const selectedDevice = view.devices.find(d => d.id === selected && !d.current);
  const Heading = mode === "login" ? "h1" : "h2";
  const activity = (value: string) => new Date(value).toLocaleString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const release = async () => {
    if (!confirmation || releaseLock.current) return;
    releaseLock.current = true; setBusy(true); setError(false);
    try { await onRelease(confirmation.id); setSelected(""); setConfirmation(undefined); }
    catch { setError(true); setConfirmation(undefined); }
    finally { releaseLock.current = false; setBusy(false); }
  };
  return <section className={`desktop-devices desktop-devices--${mode}`} aria-label={t("devices.title")}>
    <header className="desktop-device-header">
      <div className="desktop-device-heading">
        <Heading>{t(mode === "login" ? "devices.limitTitle" : "devices.title")}</Heading>
        <div className="desktop-device-header-actions">
        <span className="desktop-device-count">{t("devices.count", { count: view.devices.length, limit: view.limit })}</span>
        <Button variant="ghost" size="sm" disabled={busy} aria-label={t("devices.refresh")} onClick={() => { setError(false); void onRefresh().catch(() => setError(true)); }}>
          <Icon name="refresh" size="xs" aria-hidden />
        </Button>
        </div>
      </div>
      <p className="desktop-device-description">{t(mode === "login" ? "devices.limitHint" : "devices.summary", { count: view.devices.length, limit: view.limit })}</p>
    </header>
    <div className="desktop-device-body">
    <fieldset disabled={busy} className="desktop-device-list">
      <legend className="sr-only">{t("devices.choose")}</legend>
      {view.devices.map(d => <label key={d.id} className={`desktop-device-row${selected === d.id ? " is-selected" : ""}`}>
        <span className="desktop-device-icon" aria-hidden="true"><Icon name="desktop" size="lg" /></span>
        <span className="desktop-device-info">
          <span className="desktop-device-name">{d.name}</span>
          <span className="desktop-device-meta">{platformNames[d.platform] ?? d.platform}{d.current && <> · {t("devices.current")}</>} · <time dateTime={d.lastActiveAt}>{t("devices.lastActive", { time: activity(d.lastActiveAt) })}</time></span>
        </span>
        <input type="radio" name={`desktop-device-${mode}`} value={d.id} checked={selected === d.id} disabled={d.current}
          onChange={() => { setSelected(d.id); setError(false); }} />
      </label>)}
      {!view.devices.length && <p className="text-body-sm text-muted-foreground">{t("devices.empty")}</p>}
    </fieldset>
    <p className="desktop-device-note"><Icon name="shield-check" size="sm" aria-hidden /><span>{t("devices.dataKept")}</span></p>
    {error && <p role="alert" className="text-body-sm text-destructive">{t("devices.releaseError")}</p>}
    </div>
    <footer className="desktop-device-footer">
      <div className="desktop-device-secondary">{secondaryActions}</div>
      <Button disabled={busy || !selectedDevice} onClick={() => setConfirmation(selectedDevice)}>{t(busy ? "devices.releasing" : mode === "login" ? "devices.releaseContinue" : "devices.release")}</Button>
    </footer>
    <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open && !releaseLock.current) setConfirmation(undefined); }}>
      <AlertDialogContent className="desktop-device-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("devices.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("devices.confirmDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmation && <>
          <div className="desktop-device-confirm-computer">
            <span className="desktop-device-icon" aria-hidden="true"><Icon name="desktop" size="lg" /></span>
            <div className="desktop-device-info">
              <strong className="desktop-device-name">{confirmation.name}</strong>
              <span className="desktop-device-meta">{platformNames[confirmation.platform] ?? confirmation.platform} · {activity(confirmation.lastActiveAt)}</span>
            </div>
          </div>
        </>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("devices.keepDevice")}</AlertDialogCancel>
          <Button disabled={busy} onClick={() => void release()}>{t(busy ? "devices.releasing" : mode === "login" ? "devices.confirmContinue" : "devices.confirmRelease")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

export function DesktopDevicesSection({ api }: { api: Api }) {
  const t = useT();
  const [view, setView] = useState<DesktopDevicesView>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const refresh = async () => {
    const version = ++request.current;
    setLoading(true); setError(false);
    try { const next = await api.desktopDevices(); if (version === request.current) setView(next); }
    catch { if (version === request.current) { setView(undefined); setError(true); } }
    finally { if (version === request.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [api]);
  return <div className="desktop-devices-settings">
    {view?.supported && !loading ? <DesktopDevicePicker view={view} mode="manage" onRefresh={refresh}
      onRelease={async id => { await api.releaseDesktopDevice(id); await refresh(); }} /> :
      <section className="desktop-devices desktop-device-placeholder" aria-label={t("devices.title")}>
        <h2 className="text-heading-sm">{t("devices.title")}</h2>
        <p role="status" className="text-body-sm text-muted-foreground">{t(loading || !view && !error ? "devices.loading" : error ? "devices.loadError" : "devices.unsupported")}</p>
        <Button variant="outline" disabled={loading} onClick={() => void refresh()}>{t("devices.refresh")}</Button>
      </section>}
  </div>;
}
