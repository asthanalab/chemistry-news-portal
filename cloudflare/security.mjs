import {sha} from './automation.mjs';

const MINUTE=60000;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
const validProof=p=>typeof p==='string'&&/^[a-f0-9]{64}$/.test(p);

// Password recovery is issued only after administrator Google identity verification.
// The Drive backup bridge cannot change credentials or issue recovery tokens.
export class OfficeSecurity {
  constructor(portal,{now=Date.now}={}){
    this.p=portal;this.now=now;
    portal.sql.exec('CREATE TABLE IF NOT EXISTS password_tokens (hash TEXT PRIMARY KEY,data TEXT NOT NULL)');
  }
  get(hash){const row=this.p.one('SELECT data FROM password_tokens WHERE hash=?',hash);return row?JSON.parse(row.data):null;}
  async issue(purpose,sessionKey='',ready=purpose==='change'){
    const token=random()+random(),hash=await sha(token),now=this.now();
    const data={purpose,salt:random(),expires:now+20*MINUTE,credential:this.p.credential().verifier,sessionKey,ready};
    this.p.sql.exec("DELETE FROM password_tokens WHERE CAST(json_extract(data,'$.expires') AS INTEGER)<=?",now);
    this.p.sql.exec('INSERT INTO password_tokens VALUES(?,?)',hash,JSON.stringify(data));
    return {token,hash,data};
  }
  async lookup(token,purpose,actor){
    if(typeof token!=='string'||!/^[a-f0-9]{96}$/.test(token))throw fail('This password link is invalid or expired.',403);
    const hash=await sha(token),data=this.get(hash);
    this.check(data,purpose,actor);return {hash,data};
  }
  check(data,purpose,actor){
    if(!data||data.purpose!==purpose||!data.ready||data.expires<=this.now()||data.credential!==this.p.credential().verifier)throw fail('This password link is invalid or expired.',403);
    if(purpose==='change'&&(actor?.role!=='editor'||data.sessionKey!==actor.sessionKey||!this.p.activeOffice(actor)))throw fail('Unlock the office again before changing its password.',401);
  }
  async action(action,data,actor,ip){
    if(action==='reset-request')throw fail('Email recovery is disabled. Use administrator Google sign-in instead.',403);
    if(action==='change-begin'){
      if(actor.role!=='editor'||!this.p.activeOffice(actor))throw fail('Unlock the office before changing its password.',401);
      this.p.rate('password-change:'+ip,5,5*MINUTE);
      const credential=this.p.credential();
      if(!validProof(data.currentProof)||!equal(await sha(data.currentProof),credential.verifier))throw fail('The current password is incorrect.',403);
      if(credential.verifier!==this.p.credential().verifier||!this.p.activeOffice(actor))throw fail('Office access changed. Unlock the office again.',401);
      const issued=await this.issue('change',actor.sessionKey);
      return {changeToken:issued.token,salt:issued.data.salt,iterations:600000};
    }
    if(action==='reset-challenge'){
      this.p.rate('reset-link:'+ip,20,5*MINUTE);
      const {data:saved}=await this.lookup(data.resetToken,'reset');
      return {salt:saved.salt,iterations:600000};
    }
    if(action==='reset-complete'||action==='change-complete'){
      this.p.rate('password-complete:'+ip,10,5*MINUTE);
      const purpose=action==='reset-complete'?'reset':'change';
      const {hash}=await this.lookup(purpose==='reset'?data.resetToken:data.changeToken,purpose,actor);
      if(!validProof(data.proof))throw fail('Enter a valid new password.');
      const verifier=await sha(data.proof);
      // Re-read after all awaits and consume atomically. Concurrent submissions,
      // logout and another password rotation cannot reuse a validated token.
      this.p.ctx.storage.transactionSync(()=>{
        const saved=this.get(hash);this.check(saved,purpose,actor);
        this.p.admin.put('credential',{salt:saved.salt,iterations:600000,verifier,rootVerifier:this.p.rootCredential().verifier});
        this.p.sql.exec('DELETE FROM sessions');this.p.sql.exec('DELETE FROM password_tokens');
        this.p.admin.put('pair',null);
        this.p.sql.exec('DELETE FROM google_recovery_flows');
      });
      return {changed:true};
    }
    throw fail('This password action is not available.',404);
  }
}
