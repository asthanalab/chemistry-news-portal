import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomUUID} from 'node:crypto';
const source=await readFile(new URL('../google-automation/Code.gs',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
function sandbox(){
  const properties=new Map([['ROOT_FOLDER','root-folder-123'],['BRIDGE_SECRET','synthetic-secret']]),files=new Map(),sent=[],calls=[];
  let created=0,continuations=0,corrupt=false;
  files.set('root-folder-123',{id:'root-folder-123',name:'UND Chemistry News Backups',mimeType:'application/vnd.google-apps.folder',parents:['root'],permissions:[{role:'owner'}],trashed:false});
  function blob(data,type,name){const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data);return {getBytes:()=>Array.from(bytes,n=>n>127?n-256:n),getDataAsString:()=>bytes.toString(),type,name};}
  const context=vm.createContext({console:{log(){}},Date,JSON,Math,Number,Error,RegExp,PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)})},Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>Array.from(createHash('sha256').update(Buffer.from(b)).digest()),computeHmacSha256Signature:(s,k)=>Array.from(createHmac('sha256',k).update(s).digest()),newBlob:blob,base64Decode:s=>Array.from(Buffer.from(s,'base64')),formatDate:()=>new Date().toISOString().slice(0,10)},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}}),getUserLock:()=>({tryLock:()=>true,releaseLock(){}})},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:m=>sent.push(m)},ScriptApp:{getProjectTriggers:()=>[],deleteTrigger(){},getOAuthToken:()=> 'synthetic-token',newTrigger:()=>({timeBased(){return this;},after(){return this;},create(){continuations++;}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({text:t,setMimeType(){return this;}})},Drive:{About:{get:()=>({storageQuota:{limit:String(15*1024**3),usage:'0'}})}},UrlFetchApp:{fetch:url=>{const id=new URL(url).pathname.split('/').at(-1),f=files.get(id);return {getResponseCode:()=>f?200:404,getBlob:()=>blob(corrupt?'corrupt':f.bytes)};}}});
  context.Drive.Files={
    get(id){const f=files.get(id);if(!f)throw Error('Folder or file missing');return structuredClone(f);},
    list({q}){const [,parent,name]=q.match(/^'([^']+)' in parents and trashed=false and name='([^']+)'$/);return {files:[...files.values()].filter(f=>f.parents.includes(parent)&&f.name===name)};},
    create(meta,content){const f={...meta,id:'created-file-'+(++created),permissions:[{role:'owner'}],trashed:false};if(content){f.bytes=content.getBytes();f.sha256Checksum=hash(f.bytes);}files.set(f.id,f);return structuredClone(f);}
  };
  vm.runInContext(source,context);
  return {context,files,properties,sent,calls,get created(){return created;},get continuations(){return continuations;},corrupt(){corrupt=true;}};
}

test('Google daily idle check sends no email; missing root never silently recreates a folder',()=>{
  const s=sandbox();s.context.call_=data=>{s.calls.push(data);return {task:'idle'};};s.context.dailyCheck();assert.equal(s.sent.length,0);assert.equal(s.created,0);
  s.files.delete('root-folder-123');assert.doesNotThrow(()=>s.context.dailyCheck());assert.equal(s.created,0);assert.equal(s.calls.at(-1).action,'error');assert.equal(s.sent.length,0);
});

test('Google produces a restorable image-bearing backup and verifies it without email permission',()=>{
  const s=sandbox(),raw=Buffer.from([137,80,78,71,13,10,26,10]),row={id:'synthetic-row',version:3,status:'Submitted',headline:'Test',images:[{id:'img',type:'image/png'}],details:{officeComments:'Private note'}};
  const job={id:'a'.repeat(48),created:Date.now(),count:1,cleanup:true,recipient:'admin@example.com'};
  let receipt,complete;
  s.context.call_=data=>{
    s.calls.push(data);
    if(data.action==='next')return receipt?{task:'notify',job}:{task:'record',job,record:structuredClone(row),snapshotHash:hash(Buffer.from(JSON.stringify(row))),images:[{image_id:'img',size:raw.length,hash:hash(raw)}]};
    if(data.action==='image')return {base64:raw.toString('base64'),hash:hash(raw),type:'image/png',size:raw.length};
    if(data.action==='receipt'){receipt=data;job.folderId=data.folderId;return {accepted:true};}
    if(data.action==='index')return {files:[receipt],job};
    if(data.action==='complete'){complete=data;return {completed:true};}
    if(data.action==='error')throw Error(data.message);
  };
  s.context.runBackup();assert.ok(complete.verified);assert.equal(s.sent.length,0);
  const saved=JSON.parse(Buffer.from(s.files.get(receipt.fileId).bytes).toString());assert.equal(saved.format,'chemistry-newsroom');assert.equal(saved.records[0].details.officeComments,'Private note');assert.equal(saved.records[0].images[0].dataUrl,'data:image/png;base64,'+raw.toString('base64'));
  assert.equal(hash(s.files.get(receipt.fileId).bytes),receipt.fileHash);
});

test('Google refuses corrupted backups, and no success acknowledgement or email follows',()=>{
  const s=sandbox();s.corrupt();assert.throws(()=>s.context.saveVerified_('root-folder-123','test.newsroom.json','{"records":[]}'),/checksum/);assert.equal(s.sent.length,0);
});

test('Google permissions exclude Gmail, email sending, account email and whole-Drive access',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../google-automation/appsscript.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.oauthScopes,['https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/script.scriptapp']);
  assert.doesNotMatch(source,/GmailApp|MailApp|sendEmail|Session\.getEffectiveUser|function doPost/);
});
