import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createOfficeAuth,makeCredential,writeCredential,sessionLifetime} from '../office-auth.mjs';
import {passwordProof} from '../public/office-password.js';

const password='Fictional password for tests only';
const credential=makeCredential(password);
const proof=await passwordProof(password,credential);
const wrongProof=await passwordProof('Incorrect fictional password',credential);
test('password proofs use a unique salt and the stored verifier cannot log in',async()=>{
  assert.equal(proof.length,64);
  assert.equal(createHash('sha256').update(proof).digest('hex'),credential.verifier);
  assert.notEqual(credential.verifier,proof);
  assert.notEqual(makeCredential(password).verifier,credential.verifier);
  assert.equal(JSON.stringify(credential).includes(password),false);
  await assert.rejects(passwordProof(password,{...credential,iterations:1}),/configuration/);
  assert.throws(()=>makeCredential('short'),/8 to 256/);
});

test('local password endpoint rejects bypasses, locks out guesses, and expires/revokes sessions',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'newsroom-auth-test-')),path=join(directory,'password.json');
  await writeCredential(path,credential);
  assert.equal((await stat(path)).mode&0o777,0o600);
  let time=Date.now();const auth=await createOfficeAuth({credentialPath:path,now:()=>time});
  const server=createServer((req,res)=>auth.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(action,body,cookie='',origin=base)=>{
    const response=await fetch(`${base}/api/office/${action}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  assert.equal((await call('session')).body.unlocked,false);
  const challenge=await call('challenge');assert.equal(challenge.body.salt,credential.salt);assert.ok(!('verifier' in challenge.body));
  assert.equal((await call('unlock',{proof},'','https://unrelated.example')).status,403);
  assert.equal((await call('setup',{proof})).status,409);
  for(let i=0;i<5;i++)assert.equal((await call('unlock',{proof:i===0?credential.verifier:wrongProof})).status,401);
  assert.equal((await call('unlock',{proof})).status,429);
  time+=5*60*1000+1;
  const unlocked=await call('unlock',{proof});assert.equal(unlocked.status,200);
  assert.match(unlocked.cookie,/HttpOnly/);assert.match(unlocked.cookie,/SameSite=Strict/);
  const cookie=unlocked.cookie.split(';')[0];
  assert.equal((await call('session',null,cookie)).body.unlocked,true);
  assert.equal((await call('session',null,'newsroom_office=forged')).body.unlocked,false);
  await call('lock',{},cookie);
  assert.equal((await call('session',null,cookie)).body.unlocked,false);
  const second=await call('unlock',{proof});time+=sessionLifetime+1;
  assert.equal((await call('session',null,second.cookie.split(';')[0])).body.unlocked,false);
  await assert.rejects(writeCredential(path,makeCredential('Another fictional password')),error=>error.code==='EEXIST');
});

test('first local password setup is one-time and persists only a verifier',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'newsroom-first-password-')),path=join(directory,'password.json');
  const auth=await createOfficeAuth({credentialPath:path});
  const server=createServer((req,res)=>auth.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const challenge=await (await fetch(`${base}/api/office/challenge`)).json();assert.equal(challenge.configured,false);
  const setupProof=await passwordProof(password,challenge);
  const response=await fetch(`${base}/api/office/setup`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({proof:setupProof})});
  assert.equal(response.status,200);
  const saved=await readFile(path,'utf8');assert.ok(!saved.includes(password));assert.ok(!saved.includes(setupProof));
  assert.equal((await (await fetch(`${base}/api/office/challenge`)).json()).configured,true);
});

const backendSource=await readFile(new URL('../google-backend/Code.gs',import.meta.url),'utf8');
function googleBackend(){
  let time=Date.now();class Clock extends Date{static now(){return time;}}
  const cache=new Map(),sent=[],properties={OFFICE_PASSWORD_SALT:credential.salt,OFFICE_PASSWORD_VERIFIER:credential.verifier,OFFICE_RESET_EMAIL:'office@example.edu',PORTAL_URL:'https://example.edu/news/'};
  const office={role:'editor',sub:'office-a',name:'Office A',email:'office@example.edu',expiresAt:time+3600000};
  const contributor={...office,role:'contributor',sub:'contributor-a'};
  const ctx=vm.createContext({Date:Clock,JSON,Number,String,Object,Array,Set,Error,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key],setProperty:(key,value)=>{properties[key]=value;},setProperties:values=>Object.assign(properties,values),deleteProperty:key=>{delete properties[key];}})},
    CacheService:{getScriptCache:()=>({get:key=>{const e=cache.get(key);return e&&e.until>time?e.value:null;},put:(key,value,seconds)=>cache.set(key,{value,until:time+seconds*1000}),remove:key=>cache.delete(key)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>[...createHash('sha256').update(value).digest()],getUuid:()=>randomUUID()},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:message=>sent.push(message)}
  });
  vm.runInContext(backendSource,ctx);ctx.settings_=()=>({});ctx.rateLimit_=()=>{};ctx.json_=value=>JSON.parse(JSON.stringify(value));
  ctx.verifyToken_=token=>token==='office'?office:token==='other-office'?{...office,sub:'office-b'}:contributor;
  ctx.readRecords_=()=>[{id:'private',status:'Submitted',ownerSub:'contributor-a',summary:'Private material',images:[]}];
  ctx.DriveApp={getFolderById:()=>({})};
  const call=body=>ctx.doPost({postData:{contents:JSON.stringify({token:'office',...body})}});
  return {call,ctx,advance:ms=>{time+=ms;},properties,sent};
}

test('Google office access requires both an allowed account and the password on all private paths',()=>{
  const {call}=googleBackend();
  const locked=call({action:'session'}).user;assert.equal(locked.role,'contributor');assert.equal(locked.officeEligible,true);
  assert.deepEqual(call({action:'list',role:'editor'}).records,[]);
  assert.equal(call({action:'images',id:'private'}).ok,false);
  assert.equal(call({action:'officeUnlock',token:'contributor',proof}).ok,false);
  assert.equal(call({action:'officeChallenge',token:'contributor'}).ok,false);
  assert.equal(call({action:'officeUnlock',proof:credential.verifier}).ok,false);
  const unlocked=call({action:'officeUnlock',proof});assert.equal(unlocked.ok,true);assert.equal(unlocked.user.role,'editor');
  const officeToken=unlocked.officeToken;
  assert.equal(call({action:'list',officeToken}).records.length,1);
  assert.equal(call({action:'images',id:'private',officeToken}).ok,true);
  assert.deepEqual(call({action:'list',officeToken,token:'other-office'}).records,[]);
  assert.deepEqual(call({action:'list',officeToken,token:'contributor'}).records,[]);
  call({action:'officeLock',officeToken});assert.deepEqual(call({action:'list',officeToken}).records,[]);
});

test('Google office sessions expire, password rotation revokes them, and repeated guesses are blocked',()=>{
  const api=googleBackend();
  for(let i=0;i<5;i++)assert.equal(api.call({action:'officeUnlock',proof:wrongProof}).ok,false);
  assert.match(api.call({action:'officeUnlock',proof}).error,/Too many attempts/);
  api.advance(300001);
  const first=api.call({action:'officeUnlock',proof});assert.equal(first.ok,true);
  api.advance(sessionLifetime+1);assert.deepEqual(api.call({action:'list',officeToken:first.officeToken}).records,[]);
  const next=api.call({action:'officeUnlock',proof});assert.equal(next.ok,true);
  api.properties.OFFICE_PASSWORD_VERIFIER='a'.repeat(64);
  assert.deepEqual(api.call({action:'list',officeToken:next.officeToken}).records,[]);
});

test('password-change email goes only to the configured administrator and never on submission',async()=>{
  const api=googleBackend();
  api.call({action:'session'});api.call({action:'list'});assert.equal(api.sent.length,0);
  assert.equal(api.call({action:'officeResetRequest',token:'contributor'}).ok,false);assert.equal(api.sent.length,0);
  const oldOfficeToken=api.call({action:'officeUnlock',proof}).officeToken;
  assert.equal(api.call({action:'officeResetRequest',email:'attacker@example.org',redirect:'https://attacker.example'}).ok,true);
  assert.equal(api.sent.length,1);assert.equal(api.sent[0].to,'office@example.edu');
  assert.ok(api.sent[0].body.includes('https://example.edu/news/#office-reset/'));assert.ok(!api.sent[0].body.includes('attacker'));
  assert.ok(!api.sent[0].body.includes(password));
  const resetToken=api.sent[0].body.match(/#office-reset\/([a-f0-9]{64})/)[1];
  assert.equal(api.call({action:'officeResetRequest'}).ok,false);assert.equal(api.sent.length,1);
  // A different approved office account cannot use the administrator's link.
  const originalVerify=api.ctx.verifyToken_;
  api.ctx.verifyToken_=token=>token==='other-office'?{...originalVerify(token),email:'different@example.edu'}:originalVerify(token);
  assert.equal(api.call({action:'officeResetChallenge',resetToken,token:'other-office'}).ok,false);
  const challenge=api.call({action:'officeResetChallenge',resetToken});assert.equal(challenge.ok,true);
  const newProof=await passwordProof('Replacement fictional password',challenge);
  assert.equal(api.call({action:'officeResetComplete',resetToken,proof:newProof}).ok,true);
  assert.equal(api.call({action:'officeResetComplete',resetToken,proof:newProof}).ok,false);
  assert.deepEqual(api.call({action:'list',officeToken:oldOfficeToken}).records,[]);
  assert.equal(api.call({action:'officeUnlock',proof}).ok,false);
  assert.equal(api.call({action:'officeUnlock',proof:newProof}).ok,true);
  assert.equal(api.sent.length,1);
});

test('password-change links expire and delivery failures do not claim success',()=>{
  const api=googleBackend();api.call({action:'officeResetRequest'});
  const resetToken=api.sent[0].body.match(/#office-reset\/([a-f0-9]{64})/)[1];
  api.advance(1200001);
  assert.equal(api.call({action:'officeResetChallenge',resetToken}).ok,false);
  api.ctx.MailApp.sendEmail=()=>{throw new Error('Synthetic delivery failure');};
  assert.equal(api.call({action:'officeResetRequest'}).ok,false);
  assert.equal(api.properties.OFFICE_RESET_CURRENT,undefined);
});
