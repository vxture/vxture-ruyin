/**
 * 壳自己那份目录（i18n.ts）。
 *
 * 壳只有十来句话，但它们出现在**界面之前或之外** —— 搬家那一屏、原生对话框、
 * 系统通知。所以这一层的边界要单独钉：语言怎么挑、挑不出来时落到哪。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { shellLocaleOf, shellT } from "./i18n.js";

void test("shellLocaleOf：存过的优先；没存过跟系统；都认不出落中文", () => {
  assert.equal(shellLocaleOf("en", "zh-CN"), "en");
  assert.equal(shellLocaleOf("zh-CN", "en-US"), "zh-CN");
  // 没设过：跟操作系统 —— 第一次启动、还没人选过时，按系统说的那门开口是对的。
  assert.equal(shellLocaleOf(undefined, "en-GB"), "en");
  assert.equal(shellLocaleOf(undefined, "zh-CN"), "zh-CN");
  // 文件被写坏、值不认识：按「没设过」处理，不为一句话的语言让启动失败。
  assert.equal(shellLocaleOf("klingon", "en-US"), "en");
  assert.equal(shellLocaleOf(42, "fr-FR"), "zh-CN");
});

void test("shellT：两门语言各取各的，{占位} 按值替换", () => {
  assert.equal(shellT("zh-CN", "migratingHead"), "正在搬移数据");
  assert.equal(shellT("en", "migratingHead"), "Moving your data");
  assert.equal(shellT("zh-CN", "waitingFor", { project: "投标 A" }), "投标 A 在等你");
  assert.equal(shellT("en", "waitingFor", { project: "Bid A" }), "Bid A is waiting for you");
});

test("background exit and recovery wording is present in both shell languages",()=>{
 for(const locale of ["zh-CN","en"] as const)for(const key of ["openWorkbench","exitApp","restartApp","keepRunning","backgroundTitle","backgroundBody","exitBusy","restartBusy","exitUnknown","restartUnknown","exitDetail"] as const){
  assert.ok(shellT(locale,key).length>0);assert.doesNotMatch(shellT(locale,key),/[{}]/);
 }
});
