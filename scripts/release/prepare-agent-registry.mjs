/** Build a new registry from verified signed bytes; never signs, uploads or changes trust. */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

function registryBase(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Registry base must be an absolute HTTPS URL'); }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw Error('Registry base requires HTTPS without credentials, query or fragment (numeric loopback HTTP is test-only)');
  }
  return url.href.replace(/\/+$/, '');
}

export async function prepareAgentRegistry({packages, outDir, baseUrl, trustFile, runtimeVersion, now = () => new Date().toISOString()}) {
  if (!Array.isArray(packages) || !packages.length || !packages.every(file => typeof file === 'string' && file.length) ||
      ![outDir, trustFile, runtimeVersion].every(value => typeof value === 'string' && value.length)) {
    throw Error('Signed package files, new output directory, public trust and runtime version are required');
  }
  const target = resolve(outDir), base = registryBase(baseUrl), generatedAt = now();
  if (!Number.isFinite(Date.parse(generatedAt))) throw Error('Invalid registry generation time');
  if (existsSync(target)) throw Error('Registry output already exists; refusing to overwrite');
  const [{preflightPackage}, {parsePackageTrust}] = await Promise.all([
    import('../../apps/local-host/dist/installer.js'), import('../../apps/local-host/dist/package-signature.js'),
  ]);
  let trust;
  try { trust = parsePackageTrust(readFileSync(trustFile, 'utf8')); }
  catch { throw Error('Invalid public package trust file'); }
  // Verify every input before creating a directory or copying any package.
  const seen = new Set();
  const verified = packages.map(file => {
    const info = statSync(file);
    if (!info.isFile() || info.size > 256 * 1024 * 1024) throw Error('Package file exceeds the download limit or is not a file');
    const bytes = readFileSync(file), checked = preflightPackage(bytes, {runtimeVersion, requireSignature:true, trust});
    const {id, name, version, publisher, runtime} = checked.contract.product;
    const key = `${id}@${version}`.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate product version in registry inputs');
    seen.add(key);
    const path = `${id}/${id}-${version}.ruyinpkg`;
    return {bytes, entry:{id, name, version, publisher, runtime:{minimum:runtime.minimum}, file:path,
      url:`${base}/${path}`, sha256:createHash('sha256').update(bytes).digest('hex'), size:bytes.length, signed:true}};
  }).sort((a,b) => a.entry.file < b.entry.file ? -1 : a.entry.file > b.entry.file ? 1 : 0);
  const index = {schema:'ruyin-registry/1', generatedAt, baseUrl:base, items:verified.map(item => item.entry)};
  const parent = dirname(target), stage = mkdtempSync(join(parent, '.ruyin-registry-'));
  try {
    for (const {bytes, entry} of verified) {
      mkdirSync(join(stage, entry.id), {recursive:true});
      writeFileSync(join(stage, entry.file), bytes, {flag:'wx'});
    }
    writeFileSync(join(stage, 'index.json'), JSON.stringify(index,null,2)+'\n', {flag:'wx'});
    writeFileSync(join(stage, 'SHA256SUMS'), verified.map(({entry})=>`${entry.sha256}  ${entry.file}`).join('\n')+'\n', {flag:'wx'});
    if (existsSync(target)) throw Error('Registry output appeared during preparation');
    renameSync(stage,target);
  } finally {
    // This exact temporary directory was created above beside the requested output.
    if (dirname(resolve(stage)) !== resolve(parent) || !basename(stage).startsWith('.ruyin-registry-')) throw Error('Invalid staging cleanup path');
    rmSync(stage,{recursive:true,force:true});
  }
  return index;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const {values} = parseArgs({options:{package:{type:'string',multiple:true},out:{type:'string'},
      'base-url':{type:'string'},trust:{type:'string'},'runtime-version':{type:'string'}}});
    const index = await prepareAgentRegistry({packages:values.package,outDir:values.out,baseUrl:values['base-url'],
      trustFile:values.trust,runtimeVersion:values['runtime-version']});
    console.log(JSON.stringify({schema:index.schema,packages:index.items.map(({id,version,sha256,size,signed})=>({id,version,sha256,size,signed}))},null,2));
  } catch(error) { console.error(`[prepare-agent-registry] ${error.message}`); process.exitCode = 1; }
}
