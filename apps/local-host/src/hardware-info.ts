/**
 * 本机固件/硬件信息（关于页「本机固件信息」块）。
 *
 * 这不是给别处用的能力，就是给用户看的一段披露：Ruyin 要在本机构建沙箱执行
 * 分析与计算（保障数据不出域），需要知道跑在什么机器上 —— CPU/主板/BIOS/网卡
 * 这些就是那份「在本机做什么」的事实依据。**读了不传**：这里只在 `GET
 * /system/hardware` 上答给界面本机展示，不进遥测、不进计费、不跟任何请求一起
 * 发往云端（70-repo-organization.md §2.1：本地行为类指标不作计费依据）。
 *
 * **每个字段各自兜底。** `systeminformation` 在部分平台/沙箱下个别查询会拒绝
 * 或超时（例如容器里读不到 BIOS）—— 一个字段读不到，不该让整块信息都读不到：
 * 界面按字段各自显示「—」，不是整块报错。
 *
 * **不采集序列号。** 磁盘序列号、主板序列号是设备指纹级别的标识，这里要给的是
 * 「这是什么机器」，不是「这台机器唯一可追踪的号码」——机器唯一 ID 只给一个
 * （下方 `machineId`），够用于将来可能的设备维度授权绑定，不需要再叠加序列号。
 */

import si from "systeminformation";

export interface HardwareInfo {
  cpu?: {
    manufacturer?: string;
    brand?: string;
    cores?: number;
    physicalCores?: number;
    speedGHz?: number;
  };
  memoryTotalBytes?: number;
  baseboard?: {
    manufacturer?: string;
    model?: string;
  };
  bios?: {
    vendor?: string;
    version?: string;
    releaseDate?: string;
  };
  os?: {
    distro?: string;
    release?: string;
    build?: string;
    kernel?: string;
  };
  /** 型号与容量，不含序列号。 */
  disks?: Array<{
    name?: string;
    vendor?: string;
    sizeBytes?: number;
  }>;
  /** 物理网卡的 MAC 地址，过滤掉回环 / 虚拟网卡。 */
  macAddresses?: string[];
  /** 主板 UUID —— 这台机器的唯一 ID，供将来可能的设备维度授权绑定用。 */
  machineId?: string;
}

/**
 * 采集用的探针，缺省接 `systeminformation` 的真实实现。**测试注入假探针**——
 * 不依赖跑测试那台机器长什么样，也能把「某一路查询拒绝/超时」这种情况测到。
 */
export interface HardwareProbe {
  cpu: typeof si.cpu;
  mem: typeof si.mem;
  baseboard: typeof si.baseboard;
  bios: typeof si.bios;
  osInfo: typeof si.osInfo;
  diskLayout: typeof si.diskLayout;
  networkInterfaces: typeof si.networkInterfaces;
  uuid: typeof si.uuid;
}

export const realHardwareProbe: HardwareProbe = {
  cpu: si.cpu,
  mem: si.mem,
  baseboard: si.baseboard,
  bios: si.bios,
  osInfo: si.osInfo,
  diskLayout: si.diskLayout,
  networkInterfaces: si.networkInterfaces,
  uuid: si.uuid,
};

/** 一路查询失败时，讲清楚是「问过答不上」还是「压根没问」——两者都回 undefined。 */
async function tryProbe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export async function collectHardwareInfo(
  probe: HardwareProbe = realHardwareProbe,
): Promise<HardwareInfo> {
  const [cpu, mem, baseboard, bios, osInfo, diskLayout, nics, uuid] = await Promise.all([
    tryProbe(() => probe.cpu()),
    tryProbe(() => probe.mem()),
    tryProbe(() => probe.baseboard()),
    tryProbe(() => probe.bios()),
    tryProbe(() => probe.osInfo()),
    tryProbe(() => probe.diskLayout()),
    tryProbe(() => probe.networkInterfaces()),
    tryProbe(() => probe.uuid()),
  ]);

  const nicList = Array.isArray(nics) ? nics : nics ? [nics] : [];
  const macAddresses = [
    ...new Set(
      nicList
        .filter((n) => !n.internal && !n.virtual && n.mac)
        .map((n) => n.mac)
        .filter((mac): mac is string => Boolean(mac) && mac !== "00:00:00:00:00:00"),
    ),
  ];

  return {
    cpu: cpu
      ? {
          manufacturer: cpu.manufacturer || undefined,
          brand: cpu.brand || undefined,
          cores: cpu.cores || undefined,
          physicalCores: cpu.physicalCores || undefined,
          speedGHz: cpu.speed ? Number(cpu.speed) : undefined,
        }
      : undefined,
    memoryTotalBytes: mem?.total || undefined,
    baseboard: baseboard
      ? {
          manufacturer: baseboard.manufacturer || undefined,
          model: baseboard.model || undefined,
        }
      : undefined,
    bios: bios
      ? {
          vendor: bios.vendor || undefined,
          version: bios.version || undefined,
          releaseDate: bios.releaseDate || undefined,
        }
      : undefined,
    os: osInfo
      ? {
          distro: osInfo.distro || undefined,
          release: osInfo.release || undefined,
          build: osInfo.build || undefined,
          kernel: osInfo.kernel || undefined,
        }
      : undefined,
    disks: Array.isArray(diskLayout)
      ? diskLayout.map((d) => ({
          name: d.name || undefined,
          vendor: d.vendor || undefined,
          sizeBytes: d.size || undefined,
        }))
      : undefined,
    macAddresses: macAddresses.length > 0 ? macAddresses : undefined,
    machineId: uuid?.hardware || uuid?.os || undefined,
  };
}

/**
 * 固件信息在一次守护进程生命周期里不会变 —— 缓存住，不然每次开关于页都要
 * 再问一遍 BIOS（这一路查询在部分平台上不快）。只缓存**结果**，不缓存探针：
 * 生产装配从不传参，缓存对生产路径完全透明；测试要各自独立时用各自的探针
 * 调 `collectHardwareInfo`，不经过这层缓存。
 */
let cached: Promise<HardwareInfo> | null = null;

export function getHardwareInfo(probe: HardwareProbe = realHardwareProbe): Promise<HardwareInfo> {
  if (!cached) {
    cached = collectHardwareInfo(probe);
  }
  return cached;
}
