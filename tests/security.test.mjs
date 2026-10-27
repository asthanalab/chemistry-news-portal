import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createLocalJWKSet,generateKeyPair,exportJWK,SignJWT,base64url} from 'jose';
import {OfficeSecurity} from '../cloudflare/security.mjs';
import {GoogleRecovery,verifyGoogleIdentity} from '../cloudflare/google-recovery.mjs';
import {Administration,sha} from '../cloudflare/automation.mjs';
import {makeCredential} from '../office-auth.mjs';
import {passwordProof} from '../public/office-password.js';
const root=makeCredential('Synthetic initial password'),baseProof=await passwordProof('Synthetic initial password',root);
const oauth={clientId:'123-example.apps.googleusercontent.com',clientSecret:'synthetic-test-client-secret'},email='administrator@gmail.com',origin='https://portal.example';
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test-key';
const keys=createLocalJWKSet({keys:[jwk]});
async function idToken({nonce='test-nonce',now=Date.now(),...claims}={}){
 return new SignJWT({nonce,email,email_verified:true,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://accounts.google.com').setAudience(oauth.clientId).setSubject('123456789').setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(now/1000)+3600).sign(privateKey);
}
function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let now=Date.now(),rootValue=root,tokenClaims={},failExchange=false;
 const exchanges=[],rates=new Map();
 const sql={exec(q,...args){const s=db.prepare(q),rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE sessions(token TEXT PRIMARY KEY,expires INTEGER,credential TEXT)');
 const p={sql,env:{GOOGLE_OAUTH:JSON.stringify(oauth),PORTAL_ORIGIN:origin,PORTAL_RECOVERY_GOOGLE_EMAIL:email},one:(q,...a)=>sql.exec(q,...a).toArray()[0],rootCredential:()=>rootValue,
 credential(){const c=this.admin.get('credential');return c?.rootVerifier===rootValue.verifier?c:rootValue;},
 activeOffice(actor){const s=this.one('SELECT * FROM sessions WHERE token=?',actor.sessionKey);return !!(s&&s.expires>now&&s.credential===this.credential().verifier);},
 rate(key,max,window){let r=rates.get(key);if(!r||r.until<=now)r={n:0,until:now+window};if(++r.n>max)throw Object.assign(new Error('rate limited'),{status:429});rates.set(key,r);},
 ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}}};
 p.admin=new Administration(p);const security=p.security=new OfficeSecurity(p,{now:()=>now});
 let activeNonce='';
 const google=new GoogleRecovery(p,{now:()=>now,verify:(token,options)=>verifyGoogleIdentity(token,options,keys),send:async(url,options)=>{
  exchanges.push({url,options});if(failExchange)throw new Error('network');
  return Response.json({id_token:await idToken({now,nonce:activeNonce,...tokenClaims})});
 }});
 const actor={role:'editor',sessionKey:'test-session'};
 const session=()=>sql.exec('INSERT OR REPLACE INTO sessions VALUES(?,?,?)',actor.sessionKey,now+1800000,p.credential().verifier);session();
 async function begin(){const result=await google.start('ip'),url=new URL(result.url);activeNonce=url.searchParams.get('nonce');return {...result,url,request(overrides={}){return new Request(origin+'/api/office/google-callback?'+new URLSearchParams({code:'synthetic-code',state:url.searchParams.get('state'),...overrides.query}),{headers:{Cookie:result.cookie.split(';')[0],...overrides.headers}});}};}
 return {p,security,google,actor,session,begin,exchanges,advance(ms){now+=ms;},claims(c){tokenClaims=c;},fail(){failExchange=true;},rotateRoot(c){rootValue=c;}};
}
const guest={role:'contributor'};

test('Google identity validation rejects forged, wrong-account, unverified, wrong-audience, nonce and issuer tokens',async()=>{
 const options={clientId:oauth.clientId,email,nonce:'test-nonce'};
 assert.equal((await verifyGoogleIdentity(await idToken(),options,keys)).email,email);
 for(const claims of [{email:'attacker@gmail.com'},{email_verified:false},{nonce:'wrong'},{azp:'wrong-client'}])await assert.rejects(()=>idToken(claims).then(t=>verifyGoogleIdentity(t,options,keys)));
 for(const field of ['aud','iss','exp']){
  let token=new SignJWT({email,email_verified:true,nonce:'test-nonce',sub:'123456789',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,aud:oauth.clientId,iss:'https://accounts.google.com',[field]:field==='exp'?1:'wrong'}).setProtectedHeader({alg:'RS256',kid:jwk.kid});
  await assert.rejects(()=>token.sign(privateKey).then(t=>verifyGoogleIdentity(t,options,keys)));
 }
 const valid=await idToken();await assert.rejects(()=>verifyGoogleIdentity(valid.slice(0,-10)+'a'.repeat(10),options,keys));
 const forged=base64url.encode(JSON.stringify({alg:'none'}))+'.'+base64url.encode(JSON.stringify({email,email_verified:true,nonce:'test-nonce'}))+'.';
 await assert.rejects(()=>verifyGoogleIdentity(forged,options,keys));
});

test('Google recovery requests only identity scopes and uses state, browser binding, PKCE and one-use callbacks',async t=>{
 const s=setup(t),flow=await s.begin();
 assert.equal(flow.url.searchParams.get('scope'),'openid email');assert.equal(flow.url.searchParams.get('access_type'),'online');
 assert.equal(flow.url.searchParams.has('client_secret'),false);assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
 for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/api/office/google-callback'])assert.ok(flow.cookie.includes(flag));
 await assert.rejects(()=>s.google.callback(flow.request({headers:{Cookie:''}})),/Start Google/);
 await assert.rejects(()=>s.google.callback(flow.request({query:{state:'f'.repeat(48)}})),/Start Google/);
 assert.equal(s.exchanges.length,0);
 const redirect=await s.google.callback(flow.request());assert.ok(redirect.startsWith(origin+'/#office-reset/'));
 assert.equal(s.exchanges.length,1);const post=s.exchanges[0];assert.equal(post.url,'https://oauth2.googleapis.com/token');
 const verifier=post.options.body.get('code_verifier');assert.equal(base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),flow.url.searchParams.get('code_challenge'));
 await assert.rejects(()=>s.google.callback(flow.request()),/Start Google/);
 assert.equal(s.p.activeOffice(s.actor),true);assert.equal(s.p.credential().verifier,root.verifier);
});

test('Wrong Google account, failed exchange and expired recovery issue no password token',async t=>{
 const s=setup(t);s.claims({email:'attacker@gmail.com'});let flow=await s.begin();
 await assert.rejects(()=>s.google.callback(flow.request()),/could not verify/);assert.equal(s.p.one('SELECT COUNT(*) AS n FROM password_tokens').n,0);
 s.claims({});s.fail();flow=await s.begin();await assert.rejects(()=>s.google.callback(flow.request()),/could not verify/);
 flow=await s.begin();s.advance(10*60000);await assert.rejects(()=>s.google.callback(flow.request()),/Start Google/);
 assert.equal(s.p.one('SELECT COUNT(*) AS n FROM password_tokens').n,0);assert.equal(s.p.credential().verifier,root.verifier);
});

test('Google reset token is hashed and single-use; concurrent completion changes once and revokes all sessions',async t=>{
 const s=setup(t),flow=await s.begin(),redirect=await s.google.callback(flow.request()),token=redirect.split('/').at(-1);
 const stored=s.p.one('SELECT * FROM password_tokens');assert.equal(stored.hash,await sha(token));assert.equal(JSON.stringify(stored).includes(token),false);
 const challenge=await s.security.action('reset-challenge',{resetToken:token},guest,'ip');
 const proof=await passwordProof('Synthetic new secure passphrase',challenge);
 const results=await Promise.allSettled([s.security.action('reset-complete',{resetToken:token,proof},guest,'ip'),s.security.action('reset-complete',{resetToken:token,proof},guest,'ip')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(s.p.activeOffice(s.actor),false);assert.equal(s.p.credential().verifier,await sha(proof));
 await assert.rejects(()=>s.security.action('reset-challenge',{resetToken:token},guest,'ip'),/invalid or expired/);
});

test('Recovery rejects malformed and expired tokens, disabled email routes and excess start requests',async t=>{
 const s=setup(t);
 for(const token of ['',null,'a'.repeat(48),'f'.repeat(96)])await assert.rejects(()=>s.security.action('reset-challenge',{resetToken:token},guest,'ip'),/invalid or expired/);
 await assert.rejects(()=>s.security.action('reset-request',{},guest,'ip'),/Email recovery is disabled/);
 const flow=await s.begin(),token=(await s.google.callback(flow.request())).split('/').at(-1);s.advance(20*60000);
 await assert.rejects(()=>s.security.action('reset-complete',{resetToken:token,proof:baseProof},guest,'ip'),/invalid or expired/);
 for(let i=0;i<5;i++)await s.begin();await assert.rejects(()=>s.begin(),/rate limited/);
 assert.equal(s.p.credential().verifier,root.verifier);
});

test('Password rotation invalidates outstanding Google flows and tokens; hosting recovery overrides app credential',async t=>{
 const s=setup(t),flow=await s.begin(),token=(await s.google.callback(flow.request())).split('/').at(-1),pending=await s.begin();
 const begin=await s.security.action('change-begin',{currentProof:baseProof},s.actor,'ip'),proof=await passwordProof('Synthetic replacement passphrase',begin);
 await s.security.action('change-complete',{changeToken:begin.changeToken,proof},s.actor,'ip');
 await assert.rejects(()=>s.security.action('reset-challenge',{resetToken:token},guest,'ip'),/invalid or expired/);
 await assert.rejects(()=>s.google.callback(pending.request()),/Start Google/);
 s.session();assert.equal(s.p.activeOffice(s.actor),true);
 const recovery=makeCredential('Synthetic hosting recovery password');s.rotateRoot(recovery);
 assert.equal(s.p.credential().verifier,recovery.verifier);assert.equal(s.p.activeOffice(s.actor),false);
});

test('Current-password change cannot outlive logout or session expiration',async t=>{
 const s=setup(t);
 await assert.rejects(()=>s.security.action('change-begin',{currentProof:baseProof},guest,'ip'),/Unlock/);
 await assert.rejects(()=>s.security.action('change-begin',{currentProof:'0'.repeat(64)},s.actor,'ip'),/incorrect/);
 const begin=await s.security.action('change-begin',{currentProof:baseProof},s.actor,'ip');s.p.sql.exec('DELETE FROM sessions');
 await assert.rejects(()=>s.security.action('change-complete',{changeToken:begin.changeToken,proof:baseProof},s.actor,'ip'),/Unlock/);
 s.session();s.advance(31*60000);await assert.rejects(()=>s.security.action('change-begin',{currentProof:baseProof},s.actor,'ip'),/Unlock/);
});
