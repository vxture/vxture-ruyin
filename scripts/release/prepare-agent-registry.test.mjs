import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {signAgentPackage} from './sign-agent-package.mjs';
import {prepareAgentRegistry} from './prepare-agent-registry.mjs';

test('verified signed registry preserves bytes through real download and installation; invalid inputs create no output',async t=>{
  if (!existsSync(new URL('../../apps/local-host/dist/installer.js',import.meta.url))) {
    assert.notEqual(process.env.RUYIN_REQUIRE_BUILT_TESTS,'1','Build before required registry integration');
    return t.skip('Requires built runtime; mandatory in CI build job');
  }
  const [{packProduct},{installPackage},{parsePackageTrust},{fetchRegistryIndex,downloadPackage},{readPackage},{writeZip}]=await Promise.all([
    import('../../packages/cli/dist/pack.js'),import('../../apps/local-host/dist/installer.js'),
    import('../../apps/local-host/dist/package-signature.js'),import('../../apps/local-host/dist/registry-client.js'),
    import('../../apps/local-host/dist/pkg.js'),import('../../packages/cli/dist/zip.js')]);
  const root=mkdtempSync(join(tmpdir(),'ruyin-registry-test-'));
  let server;
  try {
    const publisher=generateKeyPairSync('ed25519'),registry=generateKeyPairSync('ed25519');
    const pub=key=>key.export({type:'spki',format:'pem'}),priv=key=>key.export({type:'pkcs8',format:'pem'});
    const trustText=JSON.stringify({version:1,registryKey:pub(registry.publicKey),publisherKeys:{vxture:pub(publisher.publicKey)}});
    const trustFile=join(root,'trust.json'),publisherKey=join(root,'publisher.pem'),registryKey=join(root,'registry.pem');
    writeFileSync(trustFile,trustText);writeFileSync(publisherKey,priv(publisher.privateKey));writeFileSync(registryKey,priv(registry.privateKey));
    const unsigned=join(root,'unsigned.ruyinpkg'),signed=join(root,'signed.ruyinpkg');
    writeFileSync(unsigned,packProduct(resolve('products/bidproposal')).buffer);
    await signAgentPackage({input:unsigned,output:signed,publisherKey,registryKey,trustFile,runtimeVersion:'0.2.1-beta.1'});
    const bytes=readFileSync(signed),outDir=join(root,'published');
    server=createServer((req,res)=>{
      const relative=req.url==='/products/index.json'?'index.json':req.url==='/products/bidproposal/bidproposal-1.0.0.ruyinpkg'?'bidproposal/bidproposal-1.0.0.ruyinpkg':null;
      if(!relative){res.writeHead(404).end();return;}
      res.end(readFileSync(join(outDir,relative)));
    });
    await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
    const baseUrl=`http://127.0.0.1:${server.address().port}/products`;
    const args={packages:[signed],outDir,baseUrl,trustFile,runtimeVersion:'0.2.1-beta.1',now:()=> '2026-11-22T00:00:00.000Z'};
    const index=await prepareAgentRegistry(args);
    assert.deepEqual(readdirSync(outDir).sort(),['SHA256SUMS','bidproposal','index.json']);
    assert.equal(index.items[0].signed,true);
    assert.equal(index.items[0].sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(readFileSync(join(outDir,'SHA256SUMS'),'utf8'),`${index.items[0].sha256}  ${index.items[0].file}\n`);
    assert.deepEqual(readFileSync(join(outDir,index.items[0].file)),bytes);
    assert.deepEqual(readFileSync(signed),bytes);
    const fetched=await fetchRegistryIndex({base:baseUrl});assert.equal(fetched.status,'ok');
    const downloaded=await downloadPackage(fetched.items[0],{base:baseUrl});assert.deepEqual(downloaded,bytes);
    const installed=installPackage(downloaded,{storeDir:join(root,'installed'),runtimeVersion:args.runtimeVersion,requireSignature:true,trust:parsePackageTrust(trustText)});
    assert.equal(installed.signed,true);assert.equal(installed.productId,'bidproposal');
    // No private/public key material accompanies the distribution directory.
    assert.equal(existsSync(join(outDir,'trust.json')),false);
    await assert.rejects(prepareAgentRegistry(args),/already exists/);
    assert.deepEqual(JSON.parse(readFileSync(join(outDir,'index.json'),'utf8')),index);
    const second=join(root,'second');assert.deepEqual(await prepareAgentRegistry({...args,outDir:second}),index);
    const refused=join(root,'refused');
    for(const value of ['http://example.com/products','https://user:password@example.com/products','https://example.com/products?q=1','https://example.com/products#hash']){
      await assert.rejects(prepareAgentRegistry({...args,outDir:refused,baseUrl:value}),/HTTPS without credentials/);
    }
    await assert.rejects(prepareAgentRegistry({...args,outDir:refused,packages:[signed,signed]}),/Duplicate product version/);
    await assert.rejects(prepareAgentRegistry({...args,outDir:refused,packages:[unsigned]}),{code:'SIGNATURE_UNVERIFIED'});
    const badTrust=JSON.parse(trustText);badTrust.publisherKeys={};writeFileSync(trustFile,JSON.stringify(badTrust));
    await assert.rejects(prepareAgentRegistry({...args,outDir:refused}),{code:'SIGNATURE_UNVERIFIED'});
    writeFileSync(trustFile,trustText);
    const tampered=readPackage(bytes);tampered.set('ruyin.product.yaml',Buffer.from('modified manifest'));
    writeFileSync(signed,writeZip([...tampered].map(([name,data])=>({name,data}))));
    await assert.rejects(prepareAgentRegistry({...args,outDir:refused}));
    assert.equal(existsSync(refused),false);assert.equal(readdirSync(root).some(name=>name.startsWith('.ruyin-registry-')),false);
    const existing=join(root,'existing');mkdirSync(existing);writeFileSync(join(existing,'keep'),'retained');
    await assert.rejects(prepareAgentRegistry({...args,outDir:existing}),/already exists/);
    assert.equal(readFileSync(join(existing,'keep'),'utf8'),'retained');
  } finally {
    if(server)await new Promise(yes=>server.close(yes));
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});
  }
});
