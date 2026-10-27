// Run setup once with the short-lived code from the authenticated office.
// Keep the connection code out of the public repository. It expires in 20 minutes.
const PORTAL_URL='https://chemistry-news-portal.chemistry-newsroom.workers.dev';
const PAIRING_CODE='';
const FOLDER_NAME='UND Chemistry News Backups';

function props_(){return PropertiesService.getScriptProperties();}
function hex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function sha_(bytes){return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes));}
function nonce_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'').slice(0,16);}
function sign_(direction,at,nonce,payload){return hex_(Utilities.computeHmacSha256Signature([direction,at,nonce,payload].join('\n'),props_().getProperty('BRIDGE_SECRET')));}
function same_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function json_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function post_(path,data){
  const response=UrlFetchApp.fetch(PORTAL_URL+path,{method:'post',contentType:'application/json',payload:JSON.stringify(data),muteHttpExceptions:true});
  const result=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!result.ok)throw new Error(result.error||'The portal did not accept the request.');return result;
}
function call_(data){const at=Date.now(),nonce=nonce_(),payload=JSON.stringify(data);return post_('/api/automation',{at:at,nonce:nonce,payload:payload,signature:sign_('google-to-portal',at,nonce,payload)});}

function setup(){
  if(props_().getProperty('BRIDGE_SECRET'))throw new Error('Already connected. Do not recreate the backup folder.');
  if(!/^[a-f0-9]{48}$/.test(PAIRING_CODE))throw new Error('Add the current office connection code before running setup.');
  // The script creates its own folder at My Drive root. drive.file permits
  // this app's files without granting access to unrelated Drive contents.
  let folderId=props_().getProperty('ROOT_FOLDER');
  if(!folderId){folderId=Drive.Files.create({name:FOLDER_NAME,mimeType:'application/vnd.google-apps.folder',parents:['root']},null,{fields:'id'}).id;props_().setProperty('ROOT_FOLDER',folderId);}
  privateFolder_(folderId);
  const result=post_('/api/automation/pair',{code:PAIRING_CODE,folderId:folderId,folderName:FOLDER_NAME});
  props_().setProperty('BRIDGE_SECRET',result.secret);
  console.log('Connected the private backup folder. Run finishSetup to schedule daily checks. No Gmail access or email permission is used.');
}
function finishSetup(){
  if(!props_().getProperty('BRIDGE_SECRET'))throw new Error('Run setup first.');
  privateFolder_(props_().getProperty('ROOT_FOLDER'));
  call_({action:'ready'});
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='dailyCheck'))ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(9).inTimezone('America/Chicago').create();
  console.log('Daily silent checks are scheduled for approximately 9–10 a.m. Central. Complete a verification backup before enabling cleanup in Office settings.');
}
function privateFolder_(id){
  if(!id)throw new Error('The backup folder is missing. Live records will be retained.');
  const f=Drive.Files.get(id,{fields:'id,name,mimeType,trashed,permissions(type,role)'});
  if(f.trashed||f.mimeType!=='application/vnd.google-apps.folder'||(f.permissions||[]).some(p=>p.role!=='owner'))throw new Error('The backup folder is missing or shared. Restore its private access before continuing.');return f;
}
function find_(parent,name){return (Drive.Files.list({q:"'"+parent+"' in parents and trashed=false and name='"+name+"'",fields:'files(id,name,mimeType,sha256Checksum)',pageSize:100}).files||[])[0];}
function bytes_(id){const r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error('Could not read back the saved backup.');return r.getBlob().getBytes();}
function saveVerified_(folder,name,text){
  const blob=Utilities.newBlob(text,'application/json',name),hash=sha_(blob.getBytes());
  let file=find_(folder,name);
  if(!file){
    const quota=Drive.About.get({fields:'storageQuota'}).storageQuota;
    if(quota.limit&&Number(quota.limit)-Number(quota.usage)<blob.getBytes().length+5*1048576)throw new Error('Google Drive is full. No paid storage will be purchased.');
    file=Drive.Files.create({name:name,parents:[folder],mimeType:'application/json'},blob,{fields:'id,sha256Checksum'});
  }
  if(sha_(bytes_(file.id))!==hash)throw new Error('Backup checksum verification failed. Live records are retained.');
  return {id:file.id,hash:hash};
}
function dailyCheck(){runBackup();}
function continueBackup(){runBackup();}
function scheduleContinuation_(){if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='continueBackup'))ScriptApp.newTrigger('continueBackup').timeBased().after(60000).create();}
function runBackup(){
  // Daily runs check usage silently. Short continuations finish an already
  // started rollover within Apps Script's per-execution runtime allowance.
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='continueBackup').forEach(t=>ScriptApp.deleteTrigger(t));
  const start=Date.now(),lock=LockService.getUserLock();if(!lock.tryLock(1000))return;
  let job;
  try{
    const root=props_().getProperty('ROOT_FOLDER');privateFolder_(root);
    while(Date.now()-start<240000){
      const task=call_({action:'next'});job=task.job;
      if(task.task==='idle'||task.task==='stopped')return;
      const folderName=new Date(job.created).toISOString().replace(/[:.]/g,'-')+'-'+job.id;
      let folder=find_(root,folderName);
      if(!folder)folder=Drive.Files.create({name:folderName,mimeType:'application/vnd.google-apps.folder',parents:[root]},null,{fields:'id'});
      privateFolder_(folder.id);
      if(task.task==='record'){
        const row=task.record;
        if(sha_(Utilities.newBlob(JSON.stringify(row)).getBytes())!==task.snapshotHash)throw new Error('Snapshot metadata did not verify.');
        for(const img of row.images){
          const source=call_({action:'image',jobId:job.id,id:row.id,imageId:img.id}),raw=Utilities.base64Decode(source.base64);
          const expected=task.images.find(i=>i.image_id===img.id);
          if(!expected||raw.length!==expected.size||sha_(raw)!==expected.hash)throw new Error('Snapshot image did not verify.');
          img.dataUrl='data:'+source.type+';base64,'+source.base64;
        }
        const pkg={format:'chemistry-newsroom',version:1,exportedAt:new Date(job.created).toISOString(),records:[row]};
        const file=saveVerified_(folder.id,row.id+'-'+task.snapshotHash+'.newsroom.json',JSON.stringify(pkg));
        call_({action:'receipt',jobId:job.id,id:row.id,snapshotHash:task.snapshotHash,fileId:file.id,fileHash:file.hash,folderId:folder.id,verified:true});
      }else if(task.task==='notify'){
        const index=call_({action:'index',jobId:job.id}),key='VERIFY_'+job.id;
        let at=Number(props_().getProperty(key)||0);
        for(;at<index.files.length;at++){
          const file=index.files[at],saved=Drive.Files.get(file.fileId,{fields:'id,parents,trashed,sha256Checksum'});
          if(saved.trashed||!saved.parents.includes(folder.id)||saved.sha256Checksum!==file.fileHash)throw new Error('A verified backup was changed or removed. Live data is retained.');
          props_().setProperty(key,String(at+1));
          if(Date.now()-start>240000){scheduleContinuation_();return;}
        }
        const manifest=saveVerified_(folder.id,'manifest.json',JSON.stringify({format:'chemistry-newsroom-manifest',version:1,jobId:job.id,created:new Date(job.created).toISOString(),records:index.files}));
        privateFolder_(root);privateFolder_(folder.id);
        call_({action:'complete',jobId:job.id,manifestId:manifest.id,manifestHash:manifest.hash,verified:true});
        props_().deleteProperty(key);return;
      }
    }
    scheduleContinuation_();
  }catch(error){
    // No automatic failure emails: show the issue privately in office settings.
    try{call_({action:'error',jobId:job&&job.id,message:String(error.message).slice(0,450)});}catch{}
    console.log('The backup stopped. Live records were retained; inspect Office settings.');
    return; // Do not throw: an unhandled trigger failure can generate a Google email.
  }finally{lock.releaseLock();}
}
