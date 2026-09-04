/**
 * Caption-overlay colours: the pure half of the shell-side theme sync
 * (main.ts holds the Electron half - it imports "electron" at module scope
 * and cannot be loaded by node:test, same split as pdf-protocol).
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { CAPTION_HEIGHT, captionOverlay, themeFromReply } from "./caption-overlay.js";

test("captionOverlay: light and dark differ in both colours and share the title-bar height", () => {
  const dark = captionOverlay("dark");
  const light = captionOverlay("light");
  assert.notEqual(dark.color, light.color);
  assert.notEqual(dark.symbolColor, light.symbolColor);
  // 高度必须与界面的标题栏一致，否则窗口按钮会错位 —— lint:shared-shapes 也盯着它。
  assert.equal(dark.height, CAPTION_HEIGHT);
  assert.equal(light.height, CAPTION_HEIGHT);
  assert.equal(CAPTION_HEIGHT, 40);
});

test("themeFromReply: only the literal 'light' flips the chrome - anything unreadable stays dark", () => {
  assert.equal(themeFromReply({ theme: "light" }), "light");
  assert.equal(themeFromReply({ theme: "dark" }), "dark");
  // 读不出来的答复不是重画的理由：应用是深色开场的。
  for (const body of [null, undefined, {}, { theme: 1 }, { theme: "LIGHT" }, "light", []]) {
    assert.equal(themeFromReply(body), "dark", `expected dark for ${JSON.stringify(body)}`);
  }
});
