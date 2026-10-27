// Private administrative state. Google owns the schedule and backup files;
// the portal only accepts signed acknowledgements from its paired script.
const MB=1048576,DAY=86400000,encoder=new TextEncoder();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hex=x=>Array.from(new Uint8Array(x),v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(24)));
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
export const sha=async x=>hex(await crypto.subtle.digest('SHA-256',typeof x==='string'?encoder.encode(x):x));
export async function signature(secret,direction,at,nonce,payload){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode([direction,at,nonce,payload].join('\n'))));
}
const driveId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,150}$/.test(x);

export class Administration {
  constructor(portal){
    this.p=portal;this.sql=portal.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY,data TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS automation_nonces (nonce TEXT PRIMARY KEY,expires INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS backup_items (id TEXT PRIMARY KEY,data TEXT NOT NULL,hash TEXT,receipt TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS backup_pins (record_id TEXT,image_id TEXT,hash TEXT,size INTEGER,type TEXT,PRIMARY KEY(record_id,image_id))');
  }
  get(key,fallback=null){const r=this.p.one('SELECT data FROM admin_settings WHERE key=?',key);return r?JSON.parse(r.data):fallback;}
  put(key,data){this.sql.exec('INSERT OR REPLACE INTO admin_settings VALUES(?,?)',key,JSON.stringify(data));}
  config(){return this.get('config',{enabled:false,lastCheck:0,lastError:''});}
  connected(){const c=this.config();return !!(this.get('bridge')&&c.folderId);}
  usage(){
    const r=this.p.one('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS metadata FROM records');
    const total=r.metadata+this.p.one('SELECT COALESCE(SUM(size),0) AS total FROM images').total;
    const max=Number(this.p.env.MAX_STORAGE_BYTES||256*MB),maxRecords=Number(this.p.env.MAX_RECORDS||1000);
    return {bytes:total,records:r.count,metadata:r.metadata,maxBytes:max,maxRecords,thresholdBytes:Math.max(0,max-47*MB),retainBytes:Number(this.p.env.RETAIN_NEWS_BYTES||50*MB)};
  }
  needed(){const u=this.usage();return u.bytes>=u.thresholdBytes;}
  status(){
    const c=this.config(),job=this.get('backup');
    return {...c,connected:this.connected(),usage:this.usage(),schedule:'Daily, approximately 9–10 a.m. Central Time',job:job?{id:job.id,state:job.state,created:job.created,completed:job.completed||0,count:job.count,verified:this.p.one("SELECT COUNT(*) AS n FROM backup_items WHERE receipt IS NOT NULL").n,deleted:job.deleted||0,folderId:job.folderId||'',cleanup:job.cleanup}:null};
  }
  pin(recordId,imageId){return !!this.p.one('SELECT 1 FROM backup_pins WHERE record_id=? AND image_id=?',recordId,imageId);}
  prunePins(){
    const pins=this.sql.exec('SELECT record_id,image_id FROM backup_pins').toArray();
    this.sql.exec('DELETE FROM backup_pins');
    for(const pin of pins){const row=this.p.record(pin.record_id);if(!row?.images.some(i=>i.id===pin.image_id))this.p.deleteImage(pin.record_id,pin.image_id);}
  }
  async createPair(){
    const code=random();this.put('pair',{hash:await sha(code),expires:Date.now()+20*60000,credential:this.p.credential().verifier});return {code,expiresMinutes:20};
  }
  async pair(data){
    const saved=this.get('pair');
    if(!saved||saved.expires<Date.now()||saved.credential!==this.p.credential().verifier||!equal(saved.hash,await sha(String(data.code||''))))throw fail('The connection code is invalid or expired.',403);
    if(this.get('pair')?.hash!==saved.hash)throw fail('This connection code has already been used.',409);
    if(!driveId(data.folderId)||data.folderName!=='UND Chemistry News Backups')throw fail('Invalid Google connection details.');
    const secret=random()+random();
    this.put('bridge',{secret});this.put('pair',null);
    this.put('config',{...this.config(),folderId:data.folderId,enabled:false,lastCheck:0,lastError:''});
    return {secret};
  }
  async authenticate(envelope){
    const bridge=this.get('bridge');
    if(!bridge||!envelope||typeof envelope.payload!=='string'||envelope.payload.length>200000||!/^[a-f0-9]{48}$/.test(envelope.nonce||'')||!Number.isSafeInteger(envelope.at)||Math.abs(Date.now()-envelope.at)>300000)throw fail('Automation authentication failed.',403);
    const expected=await signature(bridge.secret,'google-to-portal',envelope.at,envelope.nonce,envelope.payload);
    if(!equal(expected,envelope.signature))throw fail('Automation authentication failed.',403);
    this.sql.exec('DELETE FROM automation_nonces WHERE expires<?',Date.now());
    if(this.p.one('SELECT 1 FROM automation_nonces WHERE nonce=?',envelope.nonce))throw fail('This automation request was already used.',409);
    this.sql.exec('INSERT INTO automation_nonces VALUES(?,?)',envelope.nonce,Date.now()+300000);
    try{return JSON.parse(envelope.payload);}catch{throw fail('Invalid automation request.');}
  }
  async startBackup(cleanup=false){
    const old=this.get('backup');if(old&&!['complete'].includes(old.state))return old;
    const c=this.config();if(!this.connected())throw fail('Connect Google before starting a backup.',503);
    const job={id:random(),state:'uploading',created:Date.now(),count:0,cleanup,folderId:'',deleted:0};
    this.p.ctx.storage.transactionSync(()=>{
      this.prunePins();this.sql.exec('DELETE FROM backup_items');
      for(const r of this.sql.exec('SELECT id,data FROM records').toArray()){
        const row=JSON.parse(r.data);this.sql.exec('INSERT INTO backup_items VALUES(?,?,NULL,NULL)',r.id,r.data);job.count++;
        for(const img of row.images){const meta=this.p.one('SELECT hash,size,type FROM images WHERE record_id=? AND image_id=?',r.id,img.id);if(!meta)throw fail('A submission image is missing. Backup cannot safely continue.',409);this.sql.exec('INSERT INTO backup_pins VALUES(?,?,?,?,?)',r.id,img.id,meta.hash,meta.size,meta.type);}
      }
      this.put('backup',job);
    });return job;
  }
  async next(data){
    const c=this.config();this.put('config',{...c,lastCheck:Date.now()});
    let job=this.get('backup');
    if(!job||job.state==='complete'){
      if(!c.enabled||!this.needed())return {task:'idle'};
      if(!this.p.one("SELECT COUNT(*) AS n FROM records WHERE status!='Draft'").n){this.put('config',{...this.config(),lastError:'Capacity is occupied by drafts or pending uploads. No submitted records can be cleaned automatically.'});return {task:'idle'};}
      job=await this.startBackup(true);
    }
    if(job.state==='error')return {task:'stopped',error:c.lastError};
    if(job.state==='notifying')return {task:'notify',job};
    const row=this.p.one('SELECT * FROM backup_items WHERE receipt IS NULL ORDER BY id LIMIT 1');
    if(!row){job.state='notifying';this.put('backup',job);return {task:'notify',job};}
    const hash=row.hash||await sha(row.data);this.sql.exec('UPDATE backup_items SET hash=? WHERE id=?',hash,row.id);
    return {task:'record',job,record:JSON.parse(row.data),snapshotHash:hash,images:this.sql.exec('SELECT image_id,hash,size,type FROM backup_pins WHERE record_id=?',row.id).toArray()};
  }
  image(data){
    const job=this.get('backup'),pin=this.p.one('SELECT * FROM backup_pins WHERE record_id=? AND image_id=?',data.id,data.imageId);
    if(!job||job.id!==data.jobId||job.state!=='uploading'||!pin)throw fail('Backup image unavailable.',404);
    const bytes=new Uint8Array(pin.size);let at=0;
    for(const part of this.sql.exec('SELECT data FROM chunks WHERE record_id=? AND image_id=? ORDER BY part',data.id,data.imageId).toArray()){bytes.set(new Uint8Array(part.data),at);at+=part.data.byteLength;}
    if(at!==pin.size)throw fail('Incomplete image. Cleanup is blocked.',409);
    let encoded='';for(let start=0;start<bytes.length;start+=32768)encoded+=String.fromCharCode(...bytes.subarray(start,start+32768));
    return {base64:btoa(encoded),hash:pin.hash,type:pin.type,size:pin.size};
  }
  receipt(data){
    const job=this.get('backup'),item=this.p.one('SELECT hash FROM backup_items WHERE id=?',data.id);
    if(!job||job.state!=='uploading'||job.id!==data.jobId||!item||!equal(item.hash,data.snapshotHash)||!driveId(data.fileId)||!driveId(data.folderId)||!/^[a-f0-9]{64}$/.test(data.fileHash||'')||data.verified!==true)throw fail('Invalid backup verification receipt.',409);
    if(job.folderId&&job.folderId!==data.folderId)throw fail('The backup folder changed unexpectedly.',409);
    job.folderId=data.folderId;this.put('backup',job);
    this.sql.exec('UPDATE backup_items SET receipt=? WHERE id=?',JSON.stringify({fileId:data.fileId,fileHash:data.fileHash,verifiedAt:Date.now()}),data.id);
    return {accepted:true};
  }
  complete(data){
    const job=this.get('backup');
    if(job?.id===data.jobId&&job.state==='complete')return {completed:true,deleted:job.deleted};
    if(!job||job.id!==data.jobId||job.state!=='notifying'||!driveId(data.manifestId)||!/^[a-f0-9]{64}$/.test(data.manifestHash||'')||data.verified!==true||this.p.one('SELECT COUNT(*) AS n FROM backup_items WHERE receipt IS NULL').n)throw fail('Backup verification is incomplete. Nothing was deleted.',409);
    let deleted=0;
    this.p.ctx.storage.transactionSync(()=>{
      // Retain the most recently submitted whole news items up to the target.
      // Drafts and any new/changed versions are additionally protected below.
      const newest=this.sql.exec('SELECT id,data FROM records WHERE status!=?', 'Draft').toArray()
        .map(r=>({...r,row:JSON.parse(r.data)})).sort((a,b)=>String(b.row.submittedAt||b.row.createdAt||'').localeCompare(String(a.row.submittedAt||a.row.createdAt||''))||b.id.localeCompare(a.id));
      const keep=new Set();let retained=0;const target=this.usage().retainBytes;
      for(const item of newest){
        const size=encoder.encode(item.data).length+Number(this.p.one('SELECT COALESCE(SUM(size),0) AS total FROM images WHERE record_id=?',item.id).total);
        if(target<=0||retained+size>target&&keep.size)break;
        keep.add(item.id);retained+=size;
      }
      if(job.cleanup)for(const item of this.sql.exec('SELECT id,data FROM backup_items').toArray()){
        const row=JSON.parse(item.data),current=this.p.one('SELECT data FROM records WHERE id=?',item.id);
        const pending=this.p.one('SELECT COUNT(*) AS n FROM images i WHERE i.record_id=? AND NOT EXISTS (SELECT 1 FROM backup_pins p WHERE p.record_id=i.record_id AND p.image_id=i.image_id)',item.id).n;
        if(row.status!=='Draft'&&!keep.has(item.id)&&current?.data===item.data&&!pending){this.sql.exec('DELETE FROM records WHERE id=?',item.id);deleted++;}
      }
      this.prunePins();this.sql.exec('DELETE FROM backup_items');
      this.put('backup',{...job,state:'complete',deleted,completed:Date.now(),manifestId:data.manifestId,manifestHash:data.manifestHash});
      this.put('config',{...this.config(),lastError:''});
    });return {completed:true,deleted};
  }
  async automation(data){
    if(data.action==='next')return this.next(data);
    if(data.action==='image')return this.image(data);
    if(data.action==='receipt')return this.receipt(data);
    if(data.action==='complete')return this.complete(data);
    if(data.action==='index'){
      const job=this.get('backup');if(!job||job.id!==data.jobId||job.state!=='notifying')throw fail('Backup index is not ready.',409);
      return {job,files:this.sql.exec('SELECT id,hash,receipt FROM backup_items ORDER BY id').toArray().map(r=>({id:r.id,snapshotHash:r.hash,...JSON.parse(r.receipt)}))};
    }
    if(data.action==='error'){
      const job=this.get('backup');if(job&&job.id===data.jobId&&job.state!=='complete')this.put('backup',{...job,state:'error'});
      this.put('config',{...this.config(),lastError:String(data.message||'Google backup failed. Live data was retained.').slice(0,500)});return {retained:true};
    }
    if(data.action==='ready'){
      this.put('config',{...this.config(),lastError:'',lastCheck:Date.now()});return {connected:true};
    }
    throw fail('Unknown automation action.');
  }
  async office(action,data,actor,ip,origin){
    if(['reset-request','reset-challenge','reset-complete','change-email','confirm-email'].includes(action))throw fail('Email access and email-based password recovery are disabled.',403);
    if(actor.role!=='editor')throw fail('Office access is required.',401);
    if(action==='settings')return this.status();
    if(action==='pair')return this.createPair();
    if(action==='backup-now'){return {job:await this.startBackup(false)};}
    if(action==='enable-backups'){
      const job=this.get('backup');
      if(!this.connected()||!job||job.state!=='complete'||job.cleanup||job.count<1||!job.manifestHash)throw fail('Complete and verify an initial backup before enabling automatic cleanup.',409);
      this.put('config',{...this.config(),enabled:true});return {enabled:true};
    }
    if(action==='retry-backup'){
      const job=this.get('backup');if(job?.state==='error')this.put('backup',{...job,state:'uploading'});
      this.put('config',{...this.config(),lastError:''});return {queued:true};
    }
    throw fail('This office action is not available.',404);
  }
}
