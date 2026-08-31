/**
 * PWA 安装促进 - 行业标准「合并单条标题栏」在浏览器封装侧的落点：安装为
 * 桌面应用后 Window Controls Overlay 生效，Edge/Chrome 收起自带标题栏，
 * 应用 header 成为唯一一条（与 Electron 壳同构）。本 hook 捕获
 * beforeinstallprompt，让应用内一键完成安装，免去浏览器菜单三连点。
 */

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstallPrompt(): {
  canInstall: boolean;
  install: () => Promise<void>;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return {
    canInstall: deferred !== null,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      setDeferred(null);
    },
  };
}
