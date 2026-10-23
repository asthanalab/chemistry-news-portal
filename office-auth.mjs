import {randomBytes, pbkdf2Sync, createHash, timingSafeEqual} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export const iterations=600000;
export const sessionLifetime=30*60*1000;
const digest=proof=>createHash('sha256').update(proof).digest('hex');
export function makeCredential(password,salt=randomBytes(24).toString('hex')){
  if(typeof password!=='string'||password.length<8||password.length>256)throw new Error('Use a password of 8 to 256 characters.');
  const proof=pbkdf2Sync(password,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
  return {salt,iterations,verifier:digest(proof)};
}
export async function writeCredential(path,credential){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,JSON.stringify(credential)+'\n',{mode:0o600,flag:'wx'});
}
export async function createOfficeAuth({credentialPath,now=Date.now}){
  let credential;
  try{credential=JSON.parse(await readFile(credentialPath,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(credential&&(!/^[a-f0-9]{48}$/.test(credential.salt)||credential.iterations!==iterations||!/^[a-f0-9]{64}$/.test(credential.verifier)))throw new Error('Invalid office password configuration.');
  const setupSalt=randomBytes(24).toString('hex'),sessions=new Map();
  let failed=0,blockedUntil=0;
  const cookieName='newsroom_office';
  function token(req){return (req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);}
  function current(req){
    const key=token(req),expiresAt=sessions.get(key)||0;
    if(expiresAt<=now()){sessions.delete(key);return 0;}return expiresAt;
  }
  function reply(res,status,data,cookie){
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})});
    res.end(JSON.stringify(data));
  }
  async function handle(req,res){
    const path=new URL(req.url,'http://localhost').pathname;
    if(!path.startsWith('/api/office/'))return false;
    const allowedHost=/^127\.0\.0\.1:\d+$/.test(req.headers.host||'');
    const validOrigin=req.headers.origin===`http://${req.headers.host}`;
    if(!allowedHost||(req.method==='POST'&&!validOrigin)||req.headers['sec-fetch-site']==='cross-site'){
      reply(res,403,{ok:false,error:'Open the portal from its local address.'});return true;
    }
    try{
      if(req.method==='GET'&&path==='/api/office/challenge'){
        reply(res,200,{ok:true,configured:Boolean(credential),salt:credential?.salt||setupSalt,iterations});return true;
      }
      if(req.method==='GET'&&path==='/api/office/session'){
        const expiresAt=current(req);reply(res,200,{ok:true,unlocked:Boolean(expiresAt),expiresAt});return true;
      }
      if(req.method!=='POST'){reply(res,405,{ok:false,error:'Method not allowed.'});return true;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw new Error('Request too large.');}
      const input=JSON.parse(body||'{}');
      if(path==='/api/office/lock'){
        sessions.delete(token(req));reply(res,200,{ok:true},[`${cookieName}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`,`${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/office; Max-Age=0`]);return true;
      }
      if(!['/api/office/setup','/api/office/unlock'].includes(path)){reply(res,404,{ok:false,error:'Not found.'});return true;}
      if(blockedUntil>now()){reply(res,429,{ok:false,error:'Too many attempts. Try again in 5 minutes.'});return true;}
      if(typeof input.proof!=='string'||!/^[a-f0-9]{64}$/.test(input.proof))throw new Error('Enter a valid office password.');
      if(path==='/api/office/setup'){
        if(credential){reply(res,409,{ok:false,error:'The office password has already been set.'});return true;}
        const prepared={salt:setupSalt,iterations,verifier:digest(input.proof)};
        await writeCredential(credentialPath,prepared);credential=prepared;
      }else{
        if(!credential)throw new Error('Set the office password first.');
        if(!timingSafeEqual(Buffer.from(digest(input.proof),'hex'),Buffer.from(credential.verifier,'hex'))){
          failed++;if(failed>=5){blockedUntil=now()+5*60*1000;failed=0;}
          reply(res,401,{ok:false,error:'Incorrect office password.'});return true;
        }
      }
      failed=0;const id=randomBytes(32).toString('hex'),expiresAt=now()+sessionLifetime;
      for(const [key,expiry] of sessions)if(expiry<=now())sessions.delete(key);
      sessions.set(id,expiresAt);
      reply(res,200,{ok:true,unlocked:true,expiresAt},[`${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionLifetime/1000}`,`${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/office; Max-Age=0`]);
    }catch(error){reply(res,400,{ok:false,error:error.code==='EEXIST'?'The office password has already been set.':error.code?'Office access could not be configured.':error.message});}
    return true;
  }
  return {handle,expiresAt:current};
}
