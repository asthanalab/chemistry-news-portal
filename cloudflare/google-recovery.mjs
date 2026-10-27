import {createRemoteJWKSet,jwtVerify,base64url} from 'jose';
import {sha} from './automation.mjs';

const MINUTE=60000;
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
export async function verifyGoogleIdentity(token,{clientId,email,nonce,now=Date.now()},keys=googleKeys){
  const {payload}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,requiredClaims:['sub','iat','exp','nonce','email','email_verified'],maxTokenAge:'10m',clockTolerance:30,currentDate:new Date(now)});
  if(payload.nonce!==nonce||payload.email_verified!==true||typeof payload.email!=='string'||payload.email.toLowerCase()!==email||typeof payload.sub!=='string'||!/^\d{1,255}$/.test(payload.sub)||payload.azp&&payload.azp!==clientId)throw fail('This Google account cannot recover office access.');
  return {sub:payload.sub,email:payload.email.toLowerCase()};
}

export class GoogleRecovery {
  constructor(portal,{send=fetch,verify=verifyGoogleIdentity,now=Date.now}={}){
    this.p=portal;this.send=(...args)=>send(...args);this.verify=verify;this.now=now;
    portal.sql.exec('CREATE TABLE IF NOT EXISTS google_recovery_flows (hash TEXT PRIMARY KEY,data TEXT NOT NULL)');
  }
  config(){
    let c;try{c=JSON.parse(this.p.env.GOOGLE_OAUTH);}catch{return null;}
    const email=this.p.env.PORTAL_RECOVERY_GOOGLE_EMAIL,origin=this.p.env.PORTAL_ORIGIN;
    if(!c||typeof c.clientId!=='string'||!c.clientId.endsWith('.apps.googleusercontent.com')||c.clientId.length>256||typeof c.clientSecret!=='string'||c.clientSecret.length<20||c.clientSecret.length>256||typeof email!=='string'||!/^[a-z0-9._%+-]+@gmail\.com$/.test(email))return null;
    try{const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin)return null;}catch{return null;}
    return {...c,email,origin,redirectUri:origin+'/api/office/google-callback'};
  }
  configured(){return !!this.config();}
  status(){return {recoveryConnected:this.configured(),recoveryMethod:'google',recoveryAccount:this.p.env.PORTAL_RECOVERY_GOOGLE_EMAIL||'',recoveryDiagnostic:this.p.admin.get('googleRecoveryDiagnostic')};}
  problem(code){this.p.admin.put('googleRecoveryDiagnostic',{at:this.now(),code});return fail('Google recovery could not verify the administrator account.');}
  cookie(value,maxAge){return 'newsroom_recovery='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/api/office/google-callback; Max-Age='+maxAge;}
  async start(ip){
    const c=this.config();if(!c)throw fail('Google recovery setup is not complete. Contact the hosting administrator.',503);
    this.p.rate('google-start:'+ip,5,5*MINUTE);this.p.rate('google-start:global',60,60*MINUTE);
    const state=random(),browser=random(),nonce=random(),verifier=random()+random();
    const [hash,browserHash,challenge]=await Promise.all([sha(state),sha(browser),crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))]);
    const flow={browserHash,nonce,verifier,credential:this.p.credential().verifier,clientId:c.clientId,email:c.email,expires:this.now()+10*MINUTE};
    this.p.sql.exec("DELETE FROM google_recovery_flows WHERE CAST(json_extract(data,'$.expires') AS INTEGER)<=?",this.now());
    this.p.sql.exec('INSERT INTO google_recovery_flows VALUES(?,?)',hash,JSON.stringify(flow));
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:base64url.encode(new Uint8Array(challenge)),code_challenge_method:'S256',access_type:'online',prompt:'select_account',login_hint:c.email}).toString();
    return {url:url.href,cookie:this.cookie(browser,600)};
  }
  async callback(req){
    const c=this.config();if(!c)throw this.problem('not_configured');
    const url=new URL(req.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
    const browser=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('newsroom_recovery='))?.slice('newsroom_recovery='.length)||'';
    if(url.origin!==c.origin||req.method!=='GET'||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!/^[a-f0-9]{48}$/.test(state||'')||!/^[a-f0-9]{48}$/.test(browser)||!code||code.length>4096||url.searchParams.has('error')||url.searchParams.has('iss')&&!['https://accounts.google.com','accounts.google.com'].includes(url.searchParams.get('iss'))){this.problem(browser?'callback_shape':'browser_cookie_missing');throw fail('Start Google recovery again from this portal.');}
    const [hash,browserHash]=await Promise.all([sha(state),sha(browser)]),row=this.p.one('SELECT data FROM google_recovery_flows WHERE hash=?',hash);
    const flow=row?JSON.parse(row.data):null;
    if(!flow||flow.expires<=this.now()||flow.browserHash!==browserHash||flow.credential!==this.p.credential().verifier||flow.clientId!==c.clientId||flow.email!==c.email){this.problem('state_invalid');throw fail('Start Google recovery again from this portal.');}
    // Consume before exchanging the code. Failed or concurrent callbacks must restart.
    this.p.sql.exec('DELETE FROM google_recovery_flows WHERE hash=?',hash);
    let identity,phase='exchange';
    try{
      const response=await this.send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code,code_verifier:flow.verifier,grant_type:'authorization_code',redirect_uri:c.redirectUri}),redirect:'manual',signal:AbortSignal.timeout(10000)});
      const raw=await response.text();if(!response.ok||raw.length>16384){phase='exchange_http_'+response.status;throw new Error();}
      const result=JSON.parse(raw);if(typeof result.id_token!=='string'||result.id_token.length>12000)throw new Error();
      phase='identity';identity=await this.verify(result.id_token,{clientId:c.clientId,email:c.email,nonce:flow.nonce,now:this.now()});
    }catch(error){const code=typeof error.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'rejected';throw this.problem(phase+'_'+code);}
    if(flow.credential!==this.p.credential().verifier)throw fail('The password changed. Start recovery again.');
    const bound=this.p.admin.get('googleRecoveryIdentity');
    if(bound&&bound.email===c.email&&bound.sub!==identity.sub)throw fail('This Google account cannot recover office access.');
    const issued=await this.p.security.issue('reset','',true);
    if(issued.data.credential!==flow.credential){this.p.sql.exec('DELETE FROM password_tokens WHERE hash=?',issued.hash);throw fail('The password changed. Start recovery again.');}
    this.p.admin.put('googleRecoveryIdentity',{email:c.email,sub:identity.sub});
    this.p.admin.put('googleRecoveryDiagnostic',{at:this.now(),code:'verified'});
    // No automatic office session. The administrator must choose a new password.
    return c.origin+'/#office-reset/'+issued.token;
  }
}
