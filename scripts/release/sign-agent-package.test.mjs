import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {signAgentPackage} from './sign-agent-package.mjs';

test('signer uses host preflight, preserves input and refuses untrusted keys, tampering and executable payloads',async t=>{
  if (!existsSync(new URL('../../apps/local-host/dist/installer.js',import.meta.url))) {
    assert.notEqual(process.env.RUYIN_REQUIRE_BUILT_TESTS,'1','Build before required signing integration');
    return t.skip('Requires built runtime; mandatory in CI build job');
  }
  const [{packProduct},{writeZip},{readPackage},{preflightPackage},{parsePackageTrust}]=await Promise.all([
    import('../../packages/cli/dist/pack.js'),import('../../packages/cli/dist/zip.js'),
    import('../../apps/local-host/dist/pkg.js'),import('../../apps/local-host/dist/installer.js'),
    import('../../apps/local-host/dist/package-signature.js')]);
  const root=mkdtempSync(join(tmpdir(),'ruyin-signer-'));
  try {
    const author=generateKeyPairSync('ed25519'),registry=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
    const publicPem=key=>key.export({type:'spki',format:'pem'});
    const privatePem=key=>key.export({type:'pkcs8',format:'pem'});
    const trustText=JSON.stringify({version:1,registryKey:publicPem(registry.publicKey),publisherKeys:{vxture:publicPem(author.publicKey)}});
    const args={input:join(root,'input.ruyinpkg'),output:join(root,'signed.ruyinpkg'),publisherKey:join(root,'author.pem'),
      registryKey:join(root,'registry.pem'),trustFile:join(root,'trust.json'),runtimeVersion:'0.2.1-beta.1'};
    writeFileSync(args.publisherKey,privatePem(author.privateKey));writeFileSync(args.registryKey,privatePem(registry.privateKey));
    writeFileSync(args.trustFile,trustText);
    const original=packProduct(resolve('products/bidproposal')).buffer;writeFileSync(args.input,original);
    await assert.rejects(signAgentPackage({...args,output:args.input}),/new file/);
    const result=await signAgentPackage(args),signed=readFileSync(args.output);
    assert.equal(result.signed,true);assert.equal(result.sha256,createHash('sha256').update(signed).digest('hex'));
    assert.equal(preflightPackage(signed,{runtimeVersion:args.runtimeVersion,requireSignature:true,trust:parsePackageTrust(trustText)}).signed,true);
    assert.deepEqual(readFileSync(args.input),original);
    for(const [name,data] of readPackage(original))assert.deepEqual(readPackage(signed).get(name),data);
    await assert.rejects(signAgentPackage(args),/new file/);assert.deepEqual(readFileSync(args.output),signed);
    const next={...args,output:join(root,'never.ruyinpkg')};
    await assert.rejects(signAgentPackage({...next,input:args.output}),/already signed/);
    writeFileSync(args.publisherKey,privatePem(other.privateKey));
    await assert.rejects(signAgentPackage(next),/Publisher key does not match/);
    writeFileSync(args.publisherKey,privatePem(author.privateKey));writeFileSync(args.registryKey,privatePem(other.privateKey));
    await assert.rejects(signAgentPackage(next),/Registry key does not match/);
    writeFileSync(args.registryKey,'PRIVATE SENTINEL DO NOT LOG');
    await assert.rejects(signAgentPackage(next),error=>!/SENTINEL/.test(error.message)&&/readable Ed25519/.test(error.message));
    writeFileSync(args.registryKey,privatePem(registry.privateKey));
    const entries=readPackage(original);entries.set('ruyin.product.yaml',Buffer.from('tampered'));
    writeFileSync(args.input,writeZip([...entries].map(([name,data])=>({name,data}))));
    await assert.rejects(signAgentPackage(next),{code:'INTEGRITY_FAILED'});
    const native=readPackage(original);native.set('payload.exe',Buffer.from('MZ'));
    native.set('CHECKSUMS',Buffer.from([...native].filter(([name])=>name!=='CHECKSUMS')
      .map(([name,data])=>`${createHash('sha256').update(data).digest('hex')}  ${name}`).join('\n')+'\n'));
    writeFileSync(args.input,writeZip([...native].map(([name,data])=>({name,data}))));
    await assert.rejects(signAgentPackage(next),{code:'INVALID_AGENT_PAYLOAD'});
    assert.equal(existsSync(next.output),false);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});
  }
});
