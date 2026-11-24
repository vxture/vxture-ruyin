/** Agents carry browser/business resources; native capabilities belong to the host. */
const EXECUTABLE_SUFFIX = /\.(?:exe|dll|pyd|node|com|scr|msi|msix|msixbundle|appx|appxbundle|sys|cpl|ocx|so(?:\.[0-9.]+)?|dylib|bat|cmd|ps1|psm1|vbs|vbe|wsf|wsh|sh|py|pyc|pyo|jar|class|lnk|url)$/i;
const NATIVE_MAGIC = new Set([0x7f454c46,0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca]);

export function assertAgentPayload(entries: ReadonlyMap<string,Buffer>): void {
  for (const [name,bytes] of entries) {
    if (name.includes(':') || name.split('/').some(part => /[. ]$/.test(part))) {
      throw new Error('Agent payload has an ambiguous Windows path: ' + name);
    }
    const nativeMagic = bytes.length >= 4 && NATIVE_MAGIC.has(bytes.readUInt32BE(0));
    let pe = false;
    if (bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
      const offset = bytes.readUInt32LE(60);
      pe = offset <= bytes.length - 4 && bytes.readUInt32LE(offset) === 0x00004550;
    }
    if (EXECUTABLE_SUFFIX.test(name) || nativeMagic || pe) {
      throw new Error('Agent packages cannot include native executables or host scripts: ' + name);
    }
  }
}
