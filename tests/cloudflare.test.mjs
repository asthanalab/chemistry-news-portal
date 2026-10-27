import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makeCredential} from '../office-auth.mjs';
import {passwordProof} from '../public/office-password.js';
import {emptySubmission} from '../public/model.js';
const require=createRequire(import.meta.url);
const dependency=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=dependency('miniflare'),{build}=dependency('esbuild');
const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,format:'esm',write:false});
const password='Fictional test password',credential=makeCredential(password),proof=await passwordProof(password,credential);
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8xsAAAAASUVORK5CYII=','base64');
const record=(extra={})=>({...emptySubmission(),headline:'Fictional publication',summary:'Test only.',submitter:'Example Student',group:'Example Group',newsDate:'2026-10-23',permission:true,details:{paperTitle:'Example paper',authors:'Example Student',venue:'Example Journal',publicationStatus:'Accepted',officeComments:'Private office comment'},...extra});
async function setup(t,bindings={}){
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-23',durableObjects:{PORTAL:{className:'Newsroom',useSQLite:true}},bindings:{OFFICE_CREDENTIAL:JSON.stringify(credential),...bindings}}));
  t.after(()=>runtime.dispose());
  let ip=0;
  async function client(){
    const cookies=new Map(),address='192.0.2.'+(++ip);
    async function call(path,body,{type='application/json',headers={}}={}){
      const response=await runtime.dispatchFetch('https://portal.example/api/'+path,{method:body===undefined?'GET':'POST',headers:{'CF-Connecting-IP':address,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{Origin:'https://portal.example','Content-Type':type}),...headers},...(body===undefined?{}:{body:type==='application/json'?JSON.stringify(body):body})});
      for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
      const data=response.headers.get('Content-Type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
      return {status:response.status,data,headers:response.headers};
    }
    const init=await call('session');return {call,cookies,init};
  }
  return {client};
}

test('Cloudflare: isolated drafts, binary uploads, office-only records and image access',async t=>{
  const {client}=await setup(t),a=await client(),b=await client(),office=await client();
  assert.equal(a.init.status,200);assert.match(a.init.headers.get('Set-Cookie'),/Secure/);
  const source=record({ownerSub:b.init.data.user.sub});
  assert.equal((await a.call('uploads/'+source.id+'/figure',pixel,{type:'image/png'})).status,200);
  source.images=[{id:'figure',type:'image/png',name:'test.png',caption:'Test',credit:'Test',alt:'Test',rights:'cleared',size:1}];
  const saved=await a.call('submissions',{record:source});assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.record.images[0].size,pixel.length);
  assert.equal(saved.data.record.ownerSub,a.init.data.user.sub);
  assert.deepEqual((await b.call('submissions')).data.records,[]);
  assert.equal((await b.call('images/'+source.id+'/figure')).status,404);
  assert.equal((await b.call('uploads/'+source.id+'/figure',pixel,{type:'image/png'})).status,404);
  const sent=await a.call('submissions',{record:{...saved.data.record,status:'Submitted'}});
  assert.equal(sent.status,200);assert.deepEqual(Object.keys(sent.data.record).sort(),['id','reference','status']);
  assert.equal((await a.call('records/'+source.id)).status,404);
  assert.equal((await a.call('images/'+source.id+'/figure')).status,404);
  assert.equal((await office.call('office/unlock',{proof})).status,200);
  assert.equal((await office.call('submissions')).data.records.length,1);
  assert.deepEqual((await office.call('images/'+source.id+'/figure')).data,new Uint8Array(pixel));
  const loaded=(await office.call('records/'+source.id)).data.record;
  assert.equal(loaded.details.officeComments,'Private office comment');
  const reviewed=await office.call('submissions',{record:{...loaded,status:'In review',editorNotes:'Reviewed'}});
  assert.equal(reviewed.status,200);
  await office.call('office/lock',{});
  assert.equal((await office.call('records/'+source.id,undefined,{headers:{'X-Newsroom-Office':'1'}})).status,401);
});

test('Cloudflare: origin, image, privilege, version, credential and login-rate enforcement',async t=>{
  const {client}=await setup(t),a=await client();
  assert.equal((await a.call('submissions',{record:record()}, {headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await a.call('submissions',{record:record({status:'Approved'})})).status,403);
  assert.equal((await a.call('submissions',{record:record({status:'Submitted',permission:false})})).status,400);
  assert.equal((await a.call('uploads/test/figure',Buffer.from('<html>not an image</html>'),{type:'image/png'})).status,400);
  assert.equal((await a.call('office/setup',{proof})).status,404);
  const saved=(await a.call('submissions',{record:record()})).data.record;
  const results=await Promise.all([a.call('submissions',{record:saved}),a.call('submissions',{record:saved})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  a.cookies.set('newsroom_contributor',a.cookies.get('newsroom_contributor').replace(/.$/,'x'));
  assert.equal((await a.call('submissions')).status,401);
  for(let i=0;i<5;i++)assert.equal((await a.call('office/unlock',{proof:credential.verifier})).status,401);
  assert.equal((await a.call('office/unlock',{proof})).status,429);
});

test('Cloudflare: imports are atomic and capacity rejects writes without replacing records',async t=>{
  const {client}=await setup(t,{MAX_STORAGE_BYTES:'5000'}),office=await client();
  await office.call('office/unlock',{proof});
  const first=record({status:'Submitted'}),bad=record({headline:'x'.repeat(181)});
  assert.equal((await office.call('import',{records:[first,bad]})).status,400);
  assert.equal((await office.call('submissions')).data.records.length,0);
  const result=await office.call('import',{records:[first]});assert.equal(result.status,200);assert.equal(result.data.imported,1);
  assert.equal((await office.call('import',{records:[{...first,headline:'Do not overwrite'}]})).data.imported,0);
  assert.equal((await office.call('submissions',{record:record({summary:'x'.repeat(6000)})})).status,507);
  assert.equal((await office.call('records/'+first.id)).data.record.headline,first.headline);
});

test('Cloudflare: missing office configuration fails closed',async t=>{
  const {client}=await setup(t,{OFFICE_CREDENTIAL:''}),a=await client();
  assert.equal(a.init.status,503);assert.equal((await a.call('office/challenge')).status,503);
});

test('Cloudflare: larger images cross storage chunks and removals release their bytes',async t=>{
  const {client}=await setup(t),a=await client(),source=record();
  const large=new Uint8Array(3*1024*1024+7);large.set(pixel);
  assert.equal((await a.call('uploads/'+source.id+'/large',large,{type:'image/png'})).status,200);
  source.images=[{id:'large',type:'image/png',name:'large.png',caption:'Test',credit:'Test',alt:'Test',rights:'cleared'}];
  const saved=(await a.call('submissions',{record:source})).data.record;
  assert.deepEqual((await a.call('images/'+source.id+'/large')).data,large);
  assert.equal((await a.call('submissions',{record:{...saved,images:[]}})).status,200);
  assert.equal((await a.call('images/'+source.id+'/large')).status,404);
  assert.equal((await a.call('uploads/'+source.id+'/large',pixel,{type:'image/png'})).status,200);
});

test('Cloudflare: per-item delete is office-only, version checked, and removes image access',async t=>{
  const {client}=await setup(t),a=await client(),office=await client(),source=record();
  await a.call('uploads/'+source.id+'/figure',pixel,{type:'image/png'});
  source.images=[{id:'figure',type:'image/png',name:'figure.png',caption:'Test',credit:'Test',alt:'Test',rights:'cleared'}];
  const saved=(await a.call('submissions',{record:source})).data.record;
  assert.equal((await a.call('records/'+source.id+'/delete',{version:saved.version})).status,403);
  await office.call('office/unlock',{proof});
  assert.equal((await office.call('records/'+source.id+'/delete',{version:0})).status,409);
  assert.equal((await office.call('records/'+source.id+'/delete',{version:saved.version},{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await office.call('records/'+source.id+'/delete',{version:saved.version})).status,200);
  assert.equal((await office.call('records/'+source.id)).status,404);
  assert.equal((await office.call('images/'+source.id+'/figure')).status,404);
  assert.equal((await office.call('submissions',{record:saved})).status,409);
});

test('Cloudflare: every image upload enforces 10 MiB and admin machine endpoints fail closed',async t=>{
  const {client}=await setup(t),a=await client();
  const oversized=new Uint8Array(10*1048576+1);oversized.set(pixel);
  assert.equal((await a.call('uploads/test/large',oversized,{type:'image/png'})).status,413);
  assert.equal((await a.call('office/settings')).status,401);
  assert.equal((await a.call('office/pair',{})).status,401);
  assert.equal((await a.call('automation',{at:Date.now(),nonce:'a'.repeat(48),payload:'{}',signature:'f'.repeat(64)})).status,403);
  assert.equal((await a.call('office/reset-request',{})).status,403);
  await a.call('office/unlock',{proof});
  assert.equal((await a.call('office/pair')).status,405);
  const code=(await a.call('office/pair',{})).data.code;
  assert.match(code,/^[a-f0-9]{48}$/);
  assert.equal((await a.call('automation/pair',{code,sender:'test@example.com',folderId:'fake-folder-123',folderName:'UND Chemistry News Backups'})).status,200);
  assert.equal((await a.call('automation/pair',{code,sender:'test@example.com',folderId:'fake-folder-123',folderName:'UND Chemistry News Backups'})).status,403);
});
