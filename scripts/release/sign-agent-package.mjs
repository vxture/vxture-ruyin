/** Build-only signing: caller-owned keys, existing host verification, no trust provisioning. */
import {createHash, createPrivateKey, createPublicKey, sign} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

function privateKey(file, label) {
  try {
    const key = createPrivateKey(readFileSync(file));
    if (key.asymmetricKeyType !== 'ed25519') throw Error();
    return key;
  } catch { throw Error(`${label} must be a readable Ed25519 private key file`); }
}
function matches(key, publicKey) {
  return publicKey && createPublicKey(key).export({type:'spki',format:'der'})
    .equals(publicKey.export({type:'spki',format:'der'}));
}

export async function signAgentPackage({input, output, publisherKey, registryKey, trustFile, runtimeVersion}) {
  if (![input, output, publisherKey, registryKey, trustFile, runtimeVersion].every(v => typeof v === 'string' && v.length)) {
    throw Error('Input, new output, both private key files, public trust file and runtime version are required');
  }
  if (resolve(input) === resolve(output) || existsSync(output)) throw Error('Output must be a new file; refusing to overwrite');
  const [{preflightPackage}, {readPackage, CHECKSUMS_ENTRY, SIGNATURE_ENTRY},
    {parsePackageTrust, countersignaturePayload}, {writeZip}] = await Promise.all([
    import('../../apps/local-host/dist/installer.js'), import('../../apps/local-host/dist/pkg.js'),
    import('../../apps/local-host/dist/package-signature.js'), import('../../packages/cli/dist/zip.js'),
  ]);
  const bytes = readFileSync(input), contents = readPackage(bytes);
  if (contents.has(SIGNATURE_ENTRY)) throw Error('Input is already signed; rebuild from source instead of replacing its signature');
  const inspected = preflightPackage(bytes, {runtimeVersion, requireSignature:false});
  const publisher = inspected.contract.product.publisher;
  let trust;
  try { trust = parsePackageTrust(readFileSync(trustFile, 'utf8')); }
  catch { throw Error('Invalid public package trust file'); }
  const author = privateKey(publisherKey, 'Publisher key'), registry = privateKey(registryKey, 'Registry key');
  if (!matches(author, trust.publisherKeys.get(publisher))) throw Error('Publisher key does not match manifest publisher and public trust');
  if (!matches(registry, trust.registryKey)) throw Error('Registry key does not match public trust');
  const checksums = contents.get(CHECKSUMS_ENTRY);
  const publisherSignature = sign(null, checksums, author).toString('base64');
  const registrySignature = sign(null, countersignaturePayload(publisher, checksums, publisherSignature), registry).toString('base64');
  contents.set(SIGNATURE_ENTRY, Buffer.from(JSON.stringify({version:1, publisher, publisherSignature, registrySignature})+'\n'));
  const signed = writeZip([...contents].map(([name,data]) => ({name,data})));
  const verified = preflightPackage(signed, {runtimeVersion, requireSignature:true, trust});
  // Exclusive creation also closes the race after the initial existence check.
  writeFileSync(output, signed, {flag:'wx'});
  return {productId:verified.productId, version:verified.version, publisher, signed:verified.signed,
    sha256:createHash('sha256').update(signed).digest('hex'), size:signed.length};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const {values} = parseArgs({options:Object.fromEntries(
      ['input','output','publisher-key','registry-key','trust','runtime-version'].map(name => [name,{type:'string'}]))});
    console.log(JSON.stringify(await signAgentPackage({input:values.input, output:values.output,
      publisherKey:values['publisher-key'], registryKey:values['registry-key'], trustFile:values.trust,
      runtimeVersion:values['runtime-version']}), null, 2));
  } catch (error) { console.error(`[sign-agent-package] ${error.message}`); process.exitCode = 1; }
}
