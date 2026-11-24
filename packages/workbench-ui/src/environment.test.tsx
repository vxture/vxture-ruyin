/**
 * @package @vxture/ruyin-workbench-ui
 * @layer Presentation
 * @category Tests
 * @author AI-Generated
 * @date 2026-11-25
 */
import { test, expect, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider, useSetLocale } from "./locale-provider.js";
import { useLocale, useT } from "./i18n.js";
import { useProductSurface } from "./product-surface-info.js";
import { Api } from "./api.js";

test("shared presentation language changes without replacing the product runtime", async () => {
  localStorage.clear();
  function Content() {
    const locale = useLocale(), setLocale = useSetLocale(), t = useT();
    return <><p>{locale}</p><strong>{t("flow.settings")}</strong>
      <button onClick={() => setLocale("en")}>English</button></>;
  }
  render(<LocaleProvider><Content /></LocaleProvider>);
  expect(document.documentElement.lang).toBe("zh-CN");
  await userEvent.click(screen.getByRole("button", { name: "English" }));
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByText("Project settings")).toBeTruthy();
  expect(localStorage.getItem("ruyin-language")).toBe("en");
  localStorage.clear();
});

test("surface reads are project scoped and late replies cannot replace a new project", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  const read = vi.fn().mockImplementation((id: string) => id === "old"
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ available: false, reason: "archived" }));
  const api = { productSurface: read } as unknown as Api;
  const { result, rerender } = renderHook(({ id }) => useProductSurface(api, id), {
    initialProps: { id: undefined as string | undefined },
  });
  expect(result.current.surface).toBeUndefined();
  rerender({ id: "old" });
  await waitFor(() => expect(read).toHaveBeenCalledWith("old"));
  rerender({ id: "new" });
  expect(result.current.surface).toBeUndefined();
  await waitFor(() => expect(result.current.surface?.reason).toBe("archived"));
  await act(async () => { resolveOld({ available: true, entry: "old" }); });
  expect(result.current.surface?.reason).toBe("archived");
  read.mockRejectedValueOnce(new Error("Unavailable"));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.surface).toBeNull());
  rerender({ id: undefined });
  expect(result.current.surface).toBeUndefined();
});

test("native theme handoff uses the injected environment transport", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"theme":"dark"}'));
  await new Api("native", request).setChromeTheme("dark");
  expect(request).toHaveBeenCalledWith("/ui/theme", expect.objectContaining({
    method: "POST", body: '{"theme":"dark"}',
  }));
});
