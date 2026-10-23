import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOfficeAuth,makeCredential,writeCredential,sessionLifetime} from '../office-auth.mjs';
import {createPortalStore} from '../portal-store.mjs';
import {emptySubmission} from '../public/model.js';
import {passwordProof} from '../public/office-password.js';

const password='Test-only office password',credential=makeCredential(password);
const proof=await passwordProof(password,credential);
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8xsAAAAASUVORK5CYII=';
const record=(changes={})=>({...emptySubmission(),headline:'Fictional chemistry result',summary:'A test submission.',submitter:'Example Student',group:'Example Group',newsDate:'2026-10-23',details:{paperTitle:'Fictional paper',authors:'Example Student',venue:'Example Journal',publicationStatus:'Accepted',officeComments:'Private office comment'},images:[{id:'figure',type:'image/png',name:'test.png',dataUrl:pixel,caption:'Test figure',credit:'Example',alt:'Test image',rights:'cleared'}],permission:true,...changes});

async function setup(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'newsroom-portal-test-'));
  await writeCredential(join(directory,'password.json'),credential);
  let time=Date.now();const auth=await createOfficeAuth({credentialPath:join(directory,'password.json'),now:()=>time});
  let store=await createPortalStore({directory,officeAuth:auth,now:()=>time,...options});
  const server=createServer(async(req,res)=>{if(await store.handle(req,res))return;if(await auth.handle(req,res))return;res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function client(){
    const cookies=new Map();
    async function call(path,input,extra={}){
      const response=await fetch(base+'/api/'+path,{method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json',Origin:base}:{}),Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...extra},...(input?{body:JSON.stringify(input)}:{})});
      for(const cookie of response.headers.getSetCookie()){
        // The expired legacy office cookie uses another Path; only keep /api cookies.
        if(cookie.includes('Path=/api/office'))continue;
        const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));
      }
      return {status:response.status,data:await response.json(),response};
    }
    const initialized=await call('session');assert.equal(initialized.status,200);
    return {call,cookies,sub:initialized.data.user.sub};
  }
  const office=await client();assert.equal((await office.call('office/unlock',{proof})).status,200);
  return {directory,client,office,advance:ms=>{time+=ms;},restart:async()=>{store=await createPortalStore({directory,officeAuth:auth,now:()=>time,...options});}};
}

test('account-free contributors have isolated drafts and only the password-protected office reads submitted records/images',async t=>{
  const api=await setup(t),a=await api.client(),b=await api.client();
  const source=record({ownerSub:b.sub,editorNotes:'Spoofed review',sample:true});
  const draft=await a.call('submissions',{record:source,role:'editor'});
  assert.equal(draft.status,200);assert.equal(draft.data.record.ownerSub,a.sub);assert.equal(draft.data.record.editorNotes,'');assert.equal(draft.data.record.sample,false);
  assert.deepEqual((await b.call('submissions')).data.records,[]);
  assert.equal((await b.call(`records/${source.id}`)).status,404);
  assert.equal((await b.call('submissions',{record:{...source,version:1}})).status,404);
  const aList=(await a.call('submissions')).data.records;assert.equal(aList.length,1);assert.ok(!('dataUrl' in aList[0].images[0]));
  const submitted=await a.call('submissions',{record:{...draft.data.record,status:'Submitted'}});
  assert.equal(submitted.status,200);assert.deepEqual(Object.keys(submitted.data.record).sort(),['id','reference','status']);
  assert.deepEqual((await a.call('submissions')).data.records,[]);
  assert.equal((await a.call(`records/${source.id}`)).status,404);
  assert.equal((await a.call('submissions',{record:{...draft.data.record,status:'Draft',version:2}})).status,404);
  assert.equal((await api.office.call('submissions')).data.records.length,1);
  const loaded=(await api.office.call(`records/${source.id}`)).data.record;
  assert.equal(loaded.images[0].dataUrl,pixel);assert.equal(loaded.details.officeComments,'Private office comment');
  const review=await api.office.call('submissions',{record:{...loaded,status:'In review',editorNotes:'Office review note'}});
  assert.equal(review.status,200);assert.equal(review.data.record.editorNotes,'Office review note');
  await api.office.call('office/lock',{});
  assert.equal((await api.office.call(`records/${source.id}`)).status,404);
});

test('disk persistence, signed draft cookies, and optimistic version checks survive storage restart',async t=>{
  const api=await setup(t),a=await api.client();
  const saved=(await a.call('submissions',{record:record()})).data.record;
  const next={...saved,headline:'Updated title'};
  const writes=await Promise.all([a.call('submissions',{record:next}),a.call('submissions',{record:next})]);
  assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
  await api.restart();
  assert.equal((await a.call(`records/${saved.id}`)).data.record.headline,'Updated title');
  const path=join(api.directory,'submissions.json');assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await stat(join(api.directory,'contributor-key'))).mode&0o777,0o600);
  const attacker=await api.client();attacker.cookies.set('newsroom_contributor',a.cookies.get('newsroom_contributor').replace(/.$/,'x'));
  assert.equal((await attacker.call('submissions')).status,401);
  api.advance(sessionLifetime+1);
  assert.equal((await api.office.call('submissions',null,{'X-Newsroom-Office':'1'})).status,401);
});

test('server validates submissions, images, permissions, and request origins independently of the UI',async t=>{
  const api=await setup(t),a=await api.client();
  assert.equal((await a.call('submissions',{record:record({status:'Approved'})})).status,403);
  assert.equal((await a.call('submissions',{record:record({status:'Submitted',permission:false})})).status,400);
  assert.equal((await a.call('submissions',{record:record({id:'../private'})})).status,400);
  const badImage=record();badImage.images[0].dataUrl='data:image/png;base64,PGh0bWw+bm90YW5pbWFnZTwvaHRtbD4=';
  assert.equal((await a.call('submissions',{record:badImage})).status,400);
  assert.equal((await a.call('submissions',{record:record()}, {Origin:'https://unrelated.example'})).status,403);
  assert.equal((await a.call('submissions',null,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await a.call('import',{records:[record()]})).status,403);
  const submitted=(await a.call('submissions',{record:record({status:'Submitted',release:'contact'})})).data.record;
  const loaded=(await api.office.call(`records/${submitted.id}`)).data.record;
  assert.equal((await api.office.call('submissions',{record:{...loaded,status:'Published'}})).status,400);
  assert.equal((await api.office.call('submissions',{record:{...loaded,status:'Changes requested',editorNotes:''}})).status,400);
});

test('office imports are atomic, preserve private records, and never replace existing IDs',async t=>{
  const api=await setup(t),a=await api.client();
  const existing=(await a.call('submissions',{record:record()})).data.record;
  const imported=record({status:'Submitted',reference:'EARLIER-PREVIEW',history:[{status:'Submitted',actor:'Example',at:new Date().toISOString(),note:'Retained note'}]});
  const malformed=record({id:'invalid',summary:'x'.repeat(6001)});
  assert.equal((await api.office.call('import',{records:[imported,malformed]})).status,400);
  assert.equal((await api.office.call('submissions')).data.records.length,1);
  const result=await api.office.call('import',{records:[imported,{...existing,headline:'Unwanted replacement'}]});
  assert.equal(result.status,200);assert.equal(result.data.imported,1);
  assert.equal((await api.office.call(`records/${existing.id}`)).data.record.headline,existing.headline);
  const recovered=(await api.office.call(`records/${imported.id}`)).data.record;
  assert.equal(recovered.history[0].note,'Retained note');assert.equal(recovered.reference,'EARLIER-PREVIEW');assert.equal(recovered.images[0].dataUrl,pixel);
  await api.restart();assert.equal((await api.office.call('submissions')).data.records.length,2);
});

test('storage capacity failure preserves the committed records and does not claim success',async t=>{
  const api=await setup(t,{maxStorageBytes:5000}),a=await api.client();
  const first=await a.call('submissions',{record:record()});assert.equal(first.status,200);
  const before=await readFile(join(api.directory,'submissions.json'),'utf8');
  const full=await a.call('submissions',{record:record({summary:'x'.repeat(6000)})});assert.equal(full.status,507);
  assert.equal(await readFile(join(api.directory,'submissions.json'),'utf8'),before);
  assert.equal((await a.call('submissions')).data.records.length,1);
});
