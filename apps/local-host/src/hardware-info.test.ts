/**
 * 本机固件信息采集（hardware-info.ts）。
 *
 * 核心是两条纪律，各自要有测试钉住：
 *  1. 一路查询拒绝，不连累别的字段（每个字段独立兜底）；
 *  2. 不采集序列号，只给型号/厂商/容量这类不可用于设备指纹追踪的字段，
 *     以及过滤掉的虚拟/回环网卡不进 MAC 列表。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { collectHardwareInfo, getHardwareInfo, type HardwareProbe } from "./hardware-info.js";

/** 探针的字段按需覆盖，其余用「拒绝」占位 —— 逼每条测试只声明它关心的那几路。 */
function fakeProbe(overrides: Partial<HardwareProbe>): HardwareProbe {
  const reject = () => Promise.reject(new Error("probe not stubbed"));
  return {
    cpu: reject,
    mem: reject,
    baseboard: reject,
    bios: reject,
    osInfo: reject,
    diskLayout: reject,
    networkInterfaces: reject,
    uuid: reject,
    ...overrides,
  } as HardwareProbe;
}

void test("collectHardwareInfo: 全部查询正常时，逐个字段照实映射", async () => {
  const probe = fakeProbe({
    cpu: async () =>
      ({
        manufacturer: "GenuineIntel",
        brand: "Intel(R) Core(TM) i7",
        cores: 16,
        physicalCores: 8,
        speed: 3.2,
      }) as Awaited<ReturnType<HardwareProbe["cpu"]>>,
    mem: async () => ({ total: 34359738368 }) as Awaited<ReturnType<HardwareProbe["mem"]>>,
    baseboard: async () =>
      ({ manufacturer: "ASUS", model: "ROG STRIX" }) as Awaited<
        ReturnType<HardwareProbe["baseboard"]>
      >,
    bios: async () =>
      ({ vendor: "American Megatrends", version: "2.10", releaseDate: "2025-03-01" }) as Awaited<
        ReturnType<HardwareProbe["bios"]>
      >,
    osInfo: async () =>
      ({ distro: "Windows 11 Pro", release: "23H2", build: "22631", kernel: "10.0.22631" }) as Awaited<
        ReturnType<HardwareProbe["osInfo"]>
      >,
    diskLayout: async () =>
      [{ name: "Samsung SSD 980", vendor: "Samsung", size: 1000204886016, serialNum: "S6XXXXX" }] as Awaited<
        ReturnType<HardwareProbe["diskLayout"]>
      >,
    networkInterfaces: async () =>
      [
        { iface: "Ethernet", mac: "AA:BB:CC:DD:EE:01", internal: false, virtual: false },
        { iface: "Loopback", mac: "00:00:00:00:00:00", internal: true, virtual: false },
        { iface: "VMware NAT", mac: "AA:BB:CC:DD:EE:02", internal: false, virtual: true },
      ] as Awaited<ReturnType<HardwareProbe["networkInterfaces"]>>,
    uuid: async () =>
      ({ hardware: "4C4C4544-0033-3210-8031-B9C04F503332", os: "" }) as Awaited<
        ReturnType<HardwareProbe["uuid"]>
      >,
  });

  const info = await collectHardwareInfo(probe);

  assert.deepEqual(info.cpu, {
    manufacturer: "GenuineIntel",
    brand: "Intel(R) Core(TM) i7",
    cores: 16,
    physicalCores: 8,
    speedGHz: 3.2,
  });
  assert.equal(info.memoryTotalBytes, 34359738368);
  assert.deepEqual(info.baseboard, { manufacturer: "ASUS", model: "ROG STRIX" });
  assert.deepEqual(info.bios, {
    vendor: "American Megatrends",
    version: "2.10",
    releaseDate: "2025-03-01",
  });
  assert.deepEqual(info.os, {
    distro: "Windows 11 Pro",
    release: "23H2",
    build: "22631",
    kernel: "10.0.22631",
  });
  // 序列号不进结果 —— 只有型号/厂商/容量。
  assert.deepEqual(info.disks, [
    { name: "Samsung SSD 980", vendor: "Samsung", sizeBytes: 1000204886016 },
  ]);
  assert.equal((info.disks?.[0] as unknown as { serialNum?: string }).serialNum, undefined);
  // 回环（internal）与虚拟网卡都被过滤掉，只剩物理网卡那一条。
  assert.deepEqual(info.macAddresses, ["AA:BB:CC:DD:EE:01"]);
  assert.equal(info.machineId, "4C4C4544-0033-3210-8031-B9C04F503332");
});

void test("collectHardwareInfo: 某一路查询拒绝，不连累别的字段", async () => {
  const probe = fakeProbe({
    cpu: async () => ({ manufacturer: "GenuineIntel" }) as Awaited<ReturnType<HardwareProbe["cpu"]>>,
    // bios 这一路在容器/沙箱里常读不到 —— 模拟拒绝。
    bios: () => Promise.reject(new Error("dmidecode: permission denied")),
  });

  const info = await collectHardwareInfo(probe);

  assert.equal(info.cpu?.manufacturer, "GenuineIntel");
  assert.equal(info.bios, undefined);
  assert.equal(info.baseboard, undefined);
});

void test("collectHardwareInfo: 机器 ID 缺硬件 UUID 时落到 os UUID", () => {
  const probe = fakeProbe({
    uuid: async () =>
      ({ hardware: "", os: "6BA7B810-9DAD-11D1-80B4-00C04FD430C8" }) as Awaited<
        ReturnType<HardwareProbe["uuid"]>
      >,
  });
  return collectHardwareInfo(probe).then((info) => {
    assert.equal(info.machineId, "6BA7B810-9DAD-11D1-80B4-00C04FD430C8");
  });
});

void test("collectHardwareInfo: 网卡全被过滤掉时 macAddresses 是 undefined，不是空数组", async () => {
  const probe = fakeProbe({
    networkInterfaces: async () =>
      [{ iface: "Loopback", mac: "00:00:00:00:00:00", internal: true, virtual: false }] as Awaited<
        ReturnType<HardwareProbe["networkInterfaces"]>
      >,
  });
  const info = await collectHardwareInfo(probe);
  assert.equal(info.macAddresses, undefined);
});

void test("collectHardwareInfo: 一路都拒绝时，返回全字段缺失的对象而不是抛错", async () => {
  const info = await collectHardwareInfo(fakeProbe({}));
  assert.deepEqual(info, {
    cpu: undefined,
    memoryTotalBytes: undefined,
    baseboard: undefined,
    bios: undefined,
    os: undefined,
    disks: undefined,
    macAddresses: undefined,
    machineId: undefined,
  });
});

void test("getHardwareInfo: 结果按进程生命周期缓存，第二次不再问探针", async () => {
  let calls = 0;
  const probe = fakeProbe({
    cpu: async () => {
      calls += 1;
      return { manufacturer: "cached-probe" } as Awaited<ReturnType<HardwareProbe["cpu"]>>;
    },
  });

  const first = await getHardwareInfo(probe);
  const second = await getHardwareInfo(fakeProbe({ cpu: async () => ({ manufacturer: "other" }) as Awaited<ReturnType<HardwareProbe["cpu"]>> }));

  assert.equal(calls, 1);
  assert.equal(first.cpu?.manufacturer, "cached-probe");
  assert.deepEqual(second, first);
});
