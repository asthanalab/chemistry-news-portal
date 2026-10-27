import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makeCredential} from '../office-auth.mjs';
import {passwordProof} from '../public/office-password.js';
import {emptySubmission} from '../public/model.js';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const require=createRequire(import.meta.url);
const dependency=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions,Response:RuntimeResponse}=dependency('miniflare'),{build}=dependency('esbuild');
const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,format:'esm',write:false});
const password='Fictional test password',credential=makeCredential(password),proof=await passwordProof(password,credential);
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8xsAAAAASUVORK5CYII=','base64');
const record=(extra={})=>({...emptySubmission(),headline:'Fictional publication',summary:'Test only.',submitter:'Example Student',group:'Example Group',newsDate:'2026-10-23',permission:true,details:{paperTitle:'Example paper',authors:'Example Student',venue:'Example Journal',publicationStatus:'Accepted',officeComments:'Private office comment'},...extra});
async function setup(t,bindings={},runtimeOptions={}){
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-23',durableObjects:{PORTAL:{className:'Newsroom',useSQLite:true}},bindings:{OFFICE_CREDENTIAL:JSON.stringify(credential),...bindings},...runtimeOptions}));
  t.after(()=>runtime.dispose());
  let ip=0;
  async function client(){
    const cookies=new Map(),address='192.0.2.'+(++ip);
    async function call(path,body,{type='application/json',headers={}}={}){
      const response=await runtime.dispatchFetch('https://portal.example/api/'+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{'CF-Connecting-IP':address,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{Origin:'https://portal.example','Content-Type':type}),...headers},...(body===undefined?{}:{body:type==='application/json'?JSON.stringify(body):body})});
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


test('Security: forged cookies, role headers, reset links and setup never expose office records',async t=>{
  const {client}=await setup(t),office=await client(),attacker=await client();
  await office.call('office/unlock',{proof});
  const source=record({status:'Submitted'});
  await office.call('uploads/'+source.id+'/figure',pixel,{type:'image/png'});
  source.images=[{id:'figure',type:'image/png',name:'private.png',caption:'Private',credit:'Test',alt:'Private',rights:'cleared'}];
  await office.call('submissions',{record:source});
  const cookies=['', '0'.repeat(48), credential.verifier, 'editor'];
  for(const forged of cookies){
    attacker.cookies.set('newsroom_office',forged);
    const headers={'X-Newsroom-Office':'1','X-Role':'editor',Authorization:'Bearer '+forged};
    for(const path of ['submissions','records/'+source.id,'images/'+source.id+'/figure','office/settings']){
      const result=await attacker.call(path,undefined,{headers});assert.equal(result.status,401,path);
      assert.equal(JSON.stringify(result.data).includes('Private office comment'),false);
    }
    assert.equal((await attacker.call('office/session')).data.unlocked,false);
  }
  for(const action of ['setup','reset-complete','reset-challenge','change-begin','change-complete','email-pair','email-connect']){
    const result=await attacker.call('office/'+action,{resetToken:'a'.repeat(96),changeToken:'a'.repeat(96),proof,currentProof:proof,role:'editor'});
    assert.ok(result.status>=400,action);
  }
  assert.equal((await attacker.call('password-mail/pair',{code:'f'.repeat(48)})).status,404);
  assert.equal((await attacker.call('import',{records:[]})).status,403);
  assert.equal((await attacker.call('records/'+source.id+'/delete',{version:1})).status,403);
  assert.equal((await office.call('records/'+source.id)).status,200);
  const challenge=await attacker.call('office/challenge');
  assert.equal(challenge.data.verifier,undefined);assert.equal(challenge.headers.get('Cache-Control'),'no-store');
  assert.equal((await attacker.call('session')).data.user.sessionKey,undefined);
});

test('Security: current-password change requires live office session and revokes every old session',async t=>{
  const {client}=await setup(t),one=await client(),two=await client(),other=await client();
  const first=await one.call('office/unlock',{proof});await two.call('office/unlock',{proof});
  for(const flag of ['HttpOnly','SameSite=Strict','Secure','Path=/api'])assert.ok(first.headers.get('Set-Cookie').includes(flag));
  assert.notEqual(one.cookies.get('newsroom_office'),two.cookies.get('newsroom_office'));
  assert.equal((await one.call('office/change-begin',{currentProof:'0'.repeat(64)})).status,403);
  const begin=(await one.call('office/change-begin',{currentProof:proof})).data;
  const newProof=await passwordProof('Synthetic longer replacement passphrase',begin);
  assert.equal((await two.call('office/change-complete',{changeToken:begin.changeToken,proof:newProof})).status,401);
  const changes=await Promise.all([one.call('office/change-complete',{changeToken:begin.changeToken,proof:newProof}),one.call('office/change-complete',{changeToken:begin.changeToken,proof:newProof})]);
  assert.deepEqual(changes.map(x=>x.status).sort(),[200,403]);
  assert.equal((await two.call('office/session')).data.unlocked,false);
  assert.equal((await two.call('office/settings')).status,401);
  assert.equal((await other.call('office/unlock',{proof})).status,401);
  assert.equal((await other.call('office/unlock',{proof:newProof})).status,200);
  assert.equal((await other.call('office/challenge')).data.salt,begin.salt);
  const oldCookie=other.cookies.get('newsroom_office');await other.call('office/lock',{});other.cookies.set('newsroom_office',oldCookie);
  assert.equal((await other.call('office/session')).data.unlocked,false);
  assert.equal((await other.call('office/settings')).status,401);
});

test('Security: cross-origin password operations fail without changing authentication',async t=>{
  const {client}=await setup(t),office=await client();await office.call('office/unlock',{proof});
  for(const headers of [{Origin:'https://attacker.example'},{Origin:'null'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}]){
    for(const action of ['unlock','lock','change-begin','change-complete','reset-request','reset-complete','email-pair'])assert.equal((await office.call('office/'+action,{proof,currentProof:proof},{headers})).status,403,action);
  }
  assert.equal((await office.call('office/session')).data.unlocked,true);
  const challenge=(await office.call('office/change-begin',{currentProof:proof})).data;
  await office.call('office/lock',{});
  assert.equal((await office.call('office/change-complete',{changeToken:challenge.changeToken,proof})).status,401);
});

test('Security: Google callback exception still requires its browser-bound flow; no setup or email shortcut exists',async t=>{
 const {client}=await setup(t,{GOOGLE_OAUTH:JSON.stringify({clientId:'123-test.apps.googleusercontent.com',clientSecret:'synthetic-long-client-secret'}),PORTAL_ORIGIN:'https://portal.example',PORTAL_RECOVERY_GOOGLE_EMAIL:'administrator@gmail.com'}),a=await client();
 const started=await a.call('office/google-start',{});assert.equal(started.status,200);
 const url=new URL(started.data.url);assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),'openid email');
 assert.match(started.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.equal((await a.call('office/google-start',{}, {headers:{Origin:'https://attacker.example'}})).status,403);
 const callback=await a.call('office/google-callback?code=forged&state='+ '0'.repeat(48),undefined,{headers:{'Sec-Fetch-Site':'cross-site'}});
 assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),'https://portal.example/#office-recovery-error');
 assert.equal((await a.call('office/session')).data.unlocked,false);
 assert.equal((await a.call('office/settings')).status,401);
 assert.equal((await a.call('office/reset-request',{})).status,403);
 assert.equal((await a.call('office/email-pair',{})).status,404);
});

test('Security: native Workers fetch completes signed Google recovery and never follows token redirects',async t=>{
  const clientId='123-runtime.apps.googleusercontent.com',email='administrator@gmail.com';
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'runtime-test',use:'sig',alg:'RS256'};
  let nonce,redirect=false,tokenRequests=0,keyRequests=0;
  const {client}=await setup(t,{GOOGLE_OAUTH:JSON.stringify({clientId,clientSecret:'synthetic-long-client-secret'}),PORTAL_ORIGIN:'https://portal.example',PORTAL_RECOVERY_GOOGLE_EMAIL:email},{outboundService:async request=>{
    if(request.url==='https://oauth2.googleapis.com/token'){
      tokenRequests++;
      assert.equal(request.method,'POST');
      const body=new URLSearchParams(await request.text());
      assert.equal(body.get('client_id'),clientId);
      assert.equal(body.get('redirect_uri'),'https://portal.example/api/office/google-callback');
      assert.match(body.get('code_verifier'),/^[a-f0-9]{96}$/);
      if(redirect)return new RuntimeResponse(null,{status:307,headers:{Location:'https://unexpected.example/token'}});
      const token=await new SignJWT({email,email_verified:true,nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://accounts.google.com').setAudience(clientId).setSubject('123456789012345678901').setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return RuntimeResponse.json({id_token:token,access_token:'not-stored'});
    }
    if(request.url==='https://www.googleapis.com/oauth2/v3/certs'){
      keyRequests++;return RuntimeResponse.json({keys:[jwk]});
    }
    assert.fail('Unexpected outbound request: '+request.url);
  }});
  const office=await client(),a=await client();
  await office.call('office/unlock',{proof});
  async function callback(){
    const started=await a.call('office/google-start',{}),url=new URL(started.data.url);
    nonce=url.searchParams.get('nonce');
    return a.call('office/google-callback?code=synthetic-code&state='+url.searchParams.get('state'),undefined,{headers:{'Sec-Fetch-Site':'cross-site'}});
  }
  const verified=await callback();
  assert.equal(verified.status,303);
  const location=verified.headers.get('Location');
  assert.match(location,/^https:\/\/portal\.example\/#office-reset\/[a-f0-9]{96}$/);
  assert.equal(tokenRequests,1);assert.equal(keyRequests,1);
  assert.equal((await a.call('office/session')).data.unlocked,false);
  const resetToken=location.split('/').at(-1);
  const challenge=(await a.call('office/reset-challenge',{resetToken})).data;
  const replacement=await passwordProof('Synthetic recovered office passphrase',challenge);
  assert.equal((await a.call('office/reset-complete',{resetToken,proof:replacement})).status,200);
  assert.equal((await office.call('office/settings')).status,401);
  assert.equal((await a.call('office/reset-complete',{resetToken,proof:replacement})).status,403);
  assert.equal((await a.call('office/unlock',{proof})).status,401);
  assert.equal((await a.call('office/unlock',{proof:replacement})).status,200);
  await a.call('office/lock',{});
  redirect=true;
  const rejected=await callback();
  assert.equal(rejected.headers.get('Location'),'https://portal.example/#office-recovery-error');
  assert.equal(tokenRequests,2);assert.equal(keyRequests,1);
  assert.equal((await a.call('office/session')).data.unlocked,false);
});
