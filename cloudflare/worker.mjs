import {validatePortalRecord,validImageBytes} from '../record-validation.mjs';
import {canReadRecord,recordForUser} from '../public/access.js';
import {releaseEligible} from '../public/model.js';
import {Administration} from './automation.mjs';

const MB=1024*1024, DAY=86400000, SESSION=1800000, CHUNK=512*1024;
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const encoder=new TextEncoder();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(24)));
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
const cookie=(req,name)=>(req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const setCookie=(name,value,seconds,req)=>name+'='+value+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age='+seconds+(new URL(req.url).protocol==='https:'?'; Secure':'');
function json(data,status=200,headers={}){
  return Response.json({ok:status<400,...data},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
async function bytes(req,limit){
  if(Number(req.headers.get('Content-Length'))>limit)throw fail('This upload is too large.',413);
  const reader=req.body?.getReader();if(!reader)return new Uint8Array();
  const parts=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw fail('This upload is too large.',413);}parts.push(value);}
  const data=new Uint8Array(length);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return data;
}
async function input(req,limit=MB){
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))throw fail('Use JSON for this request.',415);
  try{return JSON.parse(new TextDecoder().decode(await bytes(req,limit)));}catch(e){if(e.status)throw e;throw fail('Invalid request data.');}
}

// One private SQLite object holds the department inbox. It is never publicly bound.
export class Newsroom {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS records_owner ON records(owner,status)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS images (record_id TEXT, image_id TEXT, owner TEXT, type TEXT, size INTEGER, hash TEXT, created INTEGER, PRIMARY KEY(record_id,image_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (record_id TEXT, image_id TEXT, part INTEGER, data BLOB, PRIMARY KEY(record_id,image_id,part))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER, credential TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, count INTEGER, expires INTEGER)');
    this.admin=new Administration(this);
    this.ctx.blockConcurrencyWhile(async()=>{
      let key=await ctx.storage.get('cookie-key');
      if(!key){key=random();await ctx.storage.put('cookie-key',key);}
      this.signingKey=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    });
  }
  one(query,...args){return this.sql.exec(query,...args).toArray()[0];}
  record(id){const row=this.one('SELECT data FROM records WHERE id=?',id);return row?JSON.parse(row.data):null;}
  async sign(value){return hex(await crypto.subtle.sign('HMAC',this.signingKey,encoder.encode(value)));}
  credential(){
    let c=this.admin.get('credential');if(!c)try{c=JSON.parse(this.env.OFFICE_CREDENTIAL);}catch{}
    if(!c||!/^[a-f0-9]{48}$/.test(c.salt)||c.iterations!==600000||!/^[a-f0-9]{64}$/.test(c.verifier))throw fail('The portal administrator is completing setup. Please try again later.',503);
    return c;
  }
  async actor(req,c){
    const token=cookie(req,'newsroom_contributor'),[sub,expiry,signature]=token.split('.');
    const valid=/^[a-f0-9]{48}$/.test(sub||'')&&Number(expiry)>Date.now()&&equal(signature,await this.sign(sub+'.'+expiry));
    const officeToken=cookie(req,'newsroom_office');
    const session=/^[a-f0-9]{48}$/.test(officeToken)?this.one('SELECT expires,credential FROM sessions WHERE token=?',await digest(officeToken)):null;
    const office=session&&session.expires>Date.now()&&equal(session.credential,c.verifier);
    return {sub:valid?sub:'',role:office?'editor':'contributor',officeExpiresAt:office?session.expires:0};
  }
  rate(key,limit,window){
    const now=Date.now(),old=this.one('SELECT count,expires FROM rates WHERE key=?',key);
    if(old&&old.expires>now&&old.count>=limit)throw fail('Too many requests. Please wait a few minutes and try again.',429);
    this.sql.exec('INSERT OR REPLACE INTO rates VALUES(?,?,?)',key,old&&old.expires>now?old.count+1:1,old&&old.expires>now?old.expires:now+window);
    if(!this.cleanupAt||this.cleanupAt<now){this.sql.exec('DELETE FROM rates WHERE expires<?',now);this.sql.exec('DELETE FROM sessions WHERE expires<?',now);this.cleanupAt=now+3600000;}
  }
  capacity(extraBytes=0,extraRecords=0,extraMetadata=0){
    const images=this.one('SELECT COALESCE(SUM(size),0) AS total FROM images').total;
    const records=this.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS total FROM records');
    if(images+records.total+extraBytes>Number(this.env.MAX_STORAGE_BYTES||256*MB)||records.count+extraRecords>Number(this.env.MAX_RECORDS||1000)||records.total+extraMetadata>16*MB)throw fail('Portal storage is full. Please contact the office. Nothing was saved.',507);
  }
  imageMap(id,actor){
    return new Map(this.sql.exec('SELECT image_id,type,size,owner FROM images WHERE record_id=?',id).toArray().filter(i=>actor.role==='editor'||i.owner===actor.sub).map(i=>[i.image_id,i]));
  }
  putRecord(row){
    const data=JSON.stringify(row);
    if(encoder.encode(data).length>512*1024)throw fail('This submission contains too much text.',413);
    const old=this.one('SELECT length(CAST(data AS BLOB)) AS size FROM records WHERE id=?',row.id);
    const delta=encoder.encode(data).length-(old?.size||0);
    this.capacity(delta,old?0:1,delta);
    this.sql.exec('INSERT OR REPLACE INTO records VALUES(?,?,?,?)',row.id,row.ownerSub,row.status,data);
  }
  save(source,actor){
    return this.ctx.storage.transactionSync(()=>{
      const old=this.record(String(source?.id||''));
      if(!old&&source?.version)throw fail('This news item was removed. Reload before continuing.',409);
      if(old&&!canReadRecord(old,actor))throw fail('This submission is not available.',404);
      if(old&&Number(source.version)!==old.version)throw fail('This submission was updated elsewhere. Reload before editing it again.',409);
      const row=validatePortalRecord(source,old,this.imageMap(String(source?.id||''),actor)),office=actor.role==='editor';
      if((!old||!office)&&!['Draft','Submitted'].includes(row.status))throw fail('Only the office can change review status.',403);
      if(!office){row.editorNotes='';row.publishedUrl='';}
      if(row.status==='Changes requested'&&!row.editorNotes.trim())throw fail('Describe the requested changes in the office note.');
      if(row.status==='Published'&&!releaseEligible(row))throw fail('Resolve release restrictions before recording publication.');
      const at=new Date().toISOString();
      Object.assign(row,{ownerSub:old?.ownerSub||actor.sub,reference:old?.reference||'CN-'+new Date().getFullYear()+'-'+random().slice(0,8).toUpperCase(),createdAt:old?.createdAt||at,updatedAt:at,version:(old?.version||0)+1,sample:old?.sample||false,email:old?.email||'',channels:old?.channels||['Newsletter','Department website'],publishedAt:old?.publishedAt||(row.status==='Published'?at:''),original:old?.original||(old&&old.status!=='Draft'?{headline:old.headline,summary:old.summary,details:old.details,additionalPublications:old.additionalPublications}:null)});
      row.history=[...(old?.history||[]),{status:row.status,at,actor:office?'Department office':row.submitter||'Contributor',note:office&&row.editorNotes!==old?.editorNotes?row.editorNotes:''}].slice(-150);
      this.putRecord(row);
      // A saved image removal also removes its private bytes. A failed save rolls
      // this back together with the record; unrelated pending uploads are retained.
      for(const removed of old?.images||[])if(!row.images.some(i=>i.id===removed.id)){
        this.deleteImage(row.id,removed.id);
      }
      return recordForUser(row,actor);
    });
  }
  deleteImage(recordId,imageId){
    // An in-progress snapshot pins its bytes until verified completion.
    if(this.admin.pin(recordId,imageId))return;
    this.sql.exec('DELETE FROM chunks WHERE record_id=? AND image_id=?',recordId,imageId);
    this.sql.exec('DELETE FROM images WHERE record_id=? AND image_id=?',recordId,imageId);
  }
  deleteRecord(id,version,actor){
    if(actor.role!=='editor')throw fail('Only the office can delete news.',403);
    return this.ctx.storage.transactionSync(()=>{
      const row=this.record(id);if(!row)throw fail('This news item is not available.',404);
      if(row.version!==version)throw fail('This news item changed. Reload and review it before deleting.',409);
      this.sql.exec('DELETE FROM records WHERE id=?',id);
      for(const image of this.sql.exec('SELECT image_id FROM images WHERE record_id=?',id).toArray())this.deleteImage(id,image.image_id);
      return {deleted:true};
    });
  }
  importRecords(sources,actor){
    if(actor.role!=='editor')throw fail('Only the office can import records.',403);
    if(!Array.isArray(sources)||sources.length>1000)throw fail('Import up to 1,000 records.');
    return this.ctx.storage.transactionSync(()=>{
      let count=0;
      for(const source of sources){
        if(this.record(String(source?.id||'')))continue;
        const row=validatePortalRecord(source,null,this.imageMap(String(source?.id||''),actor));
        if(!Number.isFinite(Date.parse(source.createdAt))||!Number.isFinite(Date.parse(source.updatedAt)))throw fail('Invalid record dates.');
        // Retain only bounded fields from the backup, never imported access credentials.
        Object.assign(row,{ownerSub:'imported-office-record',version:1,reference:String(source.reference||'CN-IMPORT-'+random().slice(0,8)).slice(0,100),createdAt:source.createdAt.slice(0,40),updatedAt:source.updatedAt.slice(0,40),sample:source.sample===true,email:'',channels:['Newsletter','Department website'],publishedAt:String(source.publishedAt||'').slice(0,40),original:null,history:(Array.isArray(source.history)?source.history:[]).slice(-150).map(h=>({status:String(h.status||'').slice(0,40),at:String(h.at||'').slice(0,40),actor:String(h.actor||'').slice(0,200),note:String(h.note||'').slice(0,6000)}))});
        if(source.original){const original=validatePortalRecord({...row,...source.original,id:row.id,status:'Draft',images:[]},null,new Map());row.original={headline:original.headline,summary:original.summary,details:original.details,additionalPublications:original.additionalPublications};}
        this.putRecord(row);count++;
      }return count;
    });
  }
  async upload(req,recordId,imageId,actor,ip){
    if(!idPattern.test(recordId)||!idPattern.test(imageId))throw fail('Invalid image identifier.');
    const authorize=()=>{
      const row=this.record(recordId),existing=this.one('SELECT * FROM images WHERE record_id=? AND image_id=?',recordId,imageId);
      if(row&&!canReadRecord(row,actor)||existing&&actor.role!=='editor'&&existing.owner!==actor.sub)throw fail('This submission is not available.',404);
      return existing;
    };
    authorize();
    this.rate('upload:'+ip,120,3600000);
    const type=req.headers.get('Content-Type'),data=await bytes(req,10*MB);
    if(!validImageBytes(data,type))throw fail('Each image must be a valid JPEG, PNG, or WebP up to 10 MB.');
    const hash=await digest(data);
    this.ctx.storage.transactionSync(()=>{
      const existing=authorize();
      if(existing){if(existing.hash!==hash||existing.type!==type)throw fail('Use a new image identifier for a replacement image.',409);return;}
      const size=this.one('SELECT COALESCE(SUM(size),0) AS size,COUNT(*) AS count FROM images WHERE record_id=?',recordId);
      if(size.size+data.length>30*MB||size.count>=30)throw fail('Keep all images within 30 MB per submission.');
      this.capacity(data.length);
      this.sql.exec('INSERT INTO images VALUES(?,?,?,?,?,?,?)',recordId,imageId,actor.sub,type,data.length,hash,Date.now());
      for(let start=0,part=0;start<data.length;start+=CHUNK,part++)this.sql.exec('INSERT INTO chunks VALUES(?,?,?,?)',recordId,imageId,part,data.slice(start,start+CHUNK).buffer);
    });
    return json({size:data.length});
  }
  image(recordId,imageId,actor){
    const row=this.record(recordId);
    if(!row||!canReadRecord(row,actor)||!row.images.some(i=>i.id===imageId))throw fail('This image is not available.',404);
    const info=this.one('SELECT type,size FROM images WHERE record_id=? AND image_id=?',recordId,imageId);
    if(!info)throw fail('This image is not available.',404);
    let part=0;
    const body=new ReadableStream({pull:controller=>{
      const chunk=this.one('SELECT data FROM chunks WHERE record_id=? AND image_id=? AND part=?',recordId,imageId,part++);
      if(chunk)controller.enqueue(new Uint8Array(chunk.data));else controller.close();
    }});
    return new Response(body,{headers:{'Content-Type':info.type,'Content-Length':String(info.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Content-Disposition':'inline'}});
  }
  async fetch(req){
    try{
      const url=new URL(req.url),path=url.pathname;
      // These machine endpoints require a one-use pairing code or a signed,
      // timestamped request. No browser cookie authorizes automation access.
      if(path==='/api/automation/pair'&&req.method==='POST'){
        this.rate('pair:global',10,300000);return json(await this.admin.pair(await input(req,4096)));
      }
      if(path==='/api/automation'&&req.method==='POST')return json(await this.admin.automation(await this.admin.authenticate(await input(req,256*1024))));
      if(req.headers.get('Sec-Fetch-Site')==='cross-site'||req.method!=='GET'&&req.headers.get('Origin')!==url.origin)throw fail('Open the portal from its own address.',403);
      if(!['GET','POST'].includes(req.method))throw fail('Method not allowed.',405);
      const credential=this.credential(),actor=await this.actor(req,credential);
      // A keyed digest avoids retaining contributors' raw IP addresses.
      const ip=await this.sign(req.headers.get('CF-Connecting-IP')||'local');
      if(path==='/api/office/challenge'&&req.method==='GET')return json({configured:true,salt:credential.salt,iterations:credential.iterations,recoveryConnected:false});
      if(path==='/api/office/session'&&req.method==='GET')return json({unlocked:actor.role==='editor',expiresAt:actor.officeExpiresAt});
      if(path==='/api/office/unlock'&&req.method==='POST'){
        this.rate('login:'+ip,5,300000);this.rate('login:global',100,300000);
        const data=await input(req,2048);
        if(typeof data.proof!=='string'||!/^[a-f0-9]{64}$/.test(data.proof)||!equal(await digest(data.proof),credential.verifier))throw fail('Incorrect office password.',401);
        const token=random(),expiresAt=Date.now()+SESSION;
        this.sql.exec('INSERT INTO sessions VALUES(?,?,?)',await digest(token),expiresAt,credential.verifier);
        return json({unlocked:true,expiresAt},200,{'Set-Cookie':setCookie('newsroom_office',token,SESSION/1000,req)});
      }
      if(path==='/api/office/lock'&&req.method==='POST'){
        this.sql.exec('DELETE FROM sessions WHERE token=?',await digest(cookie(req,'newsroom_office')));
        return json({},200,{'Set-Cookie':setCookie('newsroom_office','',0,req)});
      }
      if(path.startsWith('/api/office/')){
        const action=path.slice('/api/office/'.length);
        if(!['settings','pair','reset-request','reset-challenge','reset-complete','change-email','confirm-email','backup-now','retry-backup','enable-backups'].includes(action))throw fail('This office action is not available.',404);
        if(req.method!==(action==='settings'?'GET':'POST'))throw fail('Method not allowed.',405);
        return json(await this.admin.office(action,req.method==='POST'?await input(req,4096):{},actor,ip,url.origin));
      }
      if(path==='/api/session'&&req.method==='GET'){
        let header={};
        if(!actor.sub){this.rate('session:'+ip,100,3600000);actor.sub=random();const value=actor.sub+'.'+(Date.now()+30*DAY);header={'Set-Cookie':setCookie('newsroom_contributor',value+'.'+await this.sign(value),30*DAY/1000,req)};}
        return json({user:{...actor,name:actor.role==='editor'?'Department office':'Contributor'}},200,header);
      }
      if(req.headers.get('X-Newsroom-Office')==='1'&&actor.role!=='editor')throw fail('Office access has expired. Enter the password again.',401);
      if(!actor.sub)throw fail('Your browser session has expired. Reload the portal to continue.',401);
      if(req.method==='POST')this.rate('write:'+ip,600,3600000);
      if(path==='/api/submissions'&&req.method==='GET'){
        const rows=actor.role==='editor'?this.sql.exec('SELECT data FROM records'):this.sql.exec("SELECT data FROM records WHERE owner=? AND status='Draft'",actor.sub);
        return json({records:rows.toArray().map(r=>recordForUser(JSON.parse(r.data),actor))});
      }
      if(path==='/api/submissions'&&req.method==='POST')return json({record:this.save((await input(req)).record,actor)});
      if(path==='/api/import'&&req.method==='POST'){
        if(actor.role!=='editor')throw fail('Only the office can import records.',403);
        return json({imported:this.importRecords((await input(req,16*MB)).records,actor)});
      }
      const record=path.match(/^\/api\/records\/([a-zA-Z0-9_-]{1,100})$/);
      const deletion=path.match(/^\/api\/records\/([a-zA-Z0-9_-]{1,100})\/delete$/);
      if(deletion&&req.method==='POST')return json(this.deleteRecord(deletion[1],(await input(req,2048)).version,actor));
      if(record&&req.method==='GET'){const row=this.record(record[1]);if(!row||!canReadRecord(row,actor))throw fail('This submission is not available.',404);return json({record:recordForUser(row,actor)});}
      const image=path.match(/^\/api\/(uploads|images)\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
      if(image&&image[1]==='uploads'&&req.method==='POST')return await this.upload(req,image[2],image[3],actor,ip);
      if(image&&image[1]==='images'&&req.method==='GET')return this.image(image[2],image[3],actor);
      throw fail('Not found.',404);
    }catch(error){return json({error:error.status?error.message:'The portal could not complete the request. Please try again.'},error.status||500);}
  }
}

export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(url.pathname.startsWith('/api/')){
      if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'Use the secure portal address.'},403);
      return env.PORTAL.get(env.PORTAL.idFromName('department-news')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};
