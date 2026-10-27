import { config } from './config.js';
import { demoSubmissions } from './model.js';
import { isOffice, canReadRecord, recordForUser } from './access.js';
import {passwordProof} from './office-password.js';
let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject)=>{
    const r=indexedDB.open('chemistry-newsroom-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('submissions',{keyPath:'id'});
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
  return dbPromise;
}
async function transaction(mode, callback) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('submissions',mode), store=tx.objectStore('submissions');
    let result; const req=callback(store);
    if(req)req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Saving was interrupted.'));
  });
}
const previewId = config.mode==='local' ? (sessionStorage.getItem('newsroom-contributor') || crypto.randomUUID()) : '';
if(config.mode==='local')sessionStorage.setItem('newsroom-contributor',previewId);
export const session={token:'',role:'contributor',sub:previewId,email:'',name:'Contributor preview',expiresAt:0,officeToken:'',officeExpiresAt:0,officeEligible:false};
async function portalRequest(path,payload){
  const response=await fetch(`/api/${path}`,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...(payload?{'Content-Type':'application/json'}:{}),...(isOffice(session)?{'X-Newsroom-Office':'1'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  const data=await response.json();
  if(!response.ok||!data.ok){
    if(response.status===401&&isOffice(session)){session.role='contributor';session.officeExpiresAt=0;window.dispatchEvent(new Event('office-locked'));}
    throw Object.assign(new Error(data.error||'The portal is unavailable. Your form has not been cleared.'),{status:response.status});
  }
  return data;
}
// Recover the previous browser-only preview into private server storage once the
// office is unlocked. Keep the original browser copy and skip existing IDs.
export async function recoverBrowserPreview(){
  if(config.mode!=='server'||!isOffice(session))return 0;
  const rows=await transaction('readonly',s=>s.getAll());
  if(!rows.length)return 0;
  return (await portalRequest('import',{records:rows})).imported;
}
async function localOfficeRequest(action,payload){
  const response=await fetch(`/api/office/${action}`,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:{},...(payload?{body:JSON.stringify(payload)}:{})});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Office access is unavailable.');return data;
}
export async function officeChallenge(){return config.mode!=='google'?localOfficeRequest('challenge'):googleRequest('officeChallenge');}
export async function requestOfficePasswordChange(){
  if(config.mode==='cloudflare')return localOfficeRequest('reset-request',{});
  if(config.mode!=='google')throw new Error('Password recovery email is not configured. Contact the portal administrator. No email has been sent.');
  return googleRequest('officeResetRequest');
}
export async function officeResetChallenge(resetToken){
  if(config.mode==='cloudflare')return localOfficeRequest('reset-challenge',{resetToken});
  if(config.mode!=='google')throw new Error('Open the password-change link on the connected department portal.');
  return googleRequest('officeResetChallenge',{resetToken});
}
export async function completeOfficePasswordChange(resetToken,password){
  const challenge=await officeResetChallenge(resetToken),proof=await passwordProof(password,challenge);
  if(config.mode==='cloudflare')return localOfficeRequest('reset-complete',{resetToken,proof});
  return googleRequest('officeResetComplete',{resetToken,proof});
}
export async function deleteSubmission(record){
  if(!isOffice(session))throw new Error('Only the office can delete news.');
  if(!['server','cloudflare'].includes(config.mode))throw new Error('Delete is available on the hosted portal and server preview.');
  return portalRequest('records/'+encodeURIComponent(record.id)+'/delete',{version:record.version});
}
export async function administration(action='settings',data){
  if(config.mode!=='cloudflare')return {connected:false,preview:true};
  return portalRequest('office/'+action,data);
}
export async function unlockOffice(password,setup=false){
  const challenge=await officeChallenge();
  if(setup&&config.mode==='google')throw new Error('Ask the administrator to configure the office password.');
  const proof=await passwordProof(password,challenge);
  const result=config.mode!=='google'?await localOfficeRequest(setup?'setup':'unlock',{proof}):await googleRequest('officeUnlock',{proof});
  if(config.mode!=='google'){session.role='editor';session.name='Department office';session.officeExpiresAt=result.expiresAt;}
  else{Object.assign(session,result.user);session.officeToken=result.officeToken;}
}
export async function lockOffice(){
  try{if(config.mode!=='google')await localOfficeRequest('lock',{});else if(session.officeToken)await googleRequest('officeLock');}
  finally{session.role='contributor';session.officeToken='';session.officeExpiresAt=0;if(config.mode!=='google')session.name='Contributor';localStorage.setItem('newsroom-office-locked',crypto.randomUUID());}
}
async function assertLocalOffice(){
  if(!isOffice(session))return;
  const result=await localOfficeRequest('session');
  if(!result.unlocked){session.role='contributor';session.officeExpiresAt=0;window.dispatchEvent(new Event('office-locked'));throw new Error('Office access is locked. Enter the password again.');}
}
export async function googleRequest(action,payload={}) {
  if(!session.token || Date.now()>=session.expiresAt) throw new Error('Your Google session has expired. Please sign in again; your open form is still here.');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),55000);
  try {
    const r=await fetch(config.googleScriptUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:session.token,officeToken:session.officeToken,...payload}),signal:controller.signal,credentials:'omit',redirect:'follow'});
    if(!r.ok)throw new Error('The shared workspace could not be reached. Your form has not been cleared.');
    const data=await r.json();if(!data.ok)throw new Error(data.error || 'The workspace could not complete that request.');return data;
  } finally {clearTimeout(timeout);}
}
export async function initialize() {
  if(config.mode==='cloudflare'){Object.assign(session,(await portalRequest('session')).user);return;}
  if(config.mode==='server'){
    Object.assign(session,(await portalRequest('session')).user);
    const previousOwner=sessionStorage.getItem('newsroom-contributor');
    if(previousOwner&&!sessionStorage.getItem('newsroom-drafts-migrated')){
      const oldDrafts=(await transaction('readonly',s=>s.getAll())).filter(r=>r.status==='Draft'&&r.ownerSub===previousOwner);
      const currentIds=new Set((await listSubmissions()).map(r=>r.id));
      let complete=true;
      for(const draft of oldDrafts)if(!currentIds.has(draft.id)){
        try{
          await saveSubmission({...draft,version:undefined});
          if(oldDrafts.length===1)session.restoredDraftId=draft.id;
        }catch(error){
          complete=false;session.migrationWarning='An earlier draft could not be restored here. Its browser copy is preserved; ask the office to recover it in Settings.';
        }
      }
      if(complete)sessionStorage.setItem('newsroom-drafts-migrated','1');
    }
    return;
  }
  if(config.mode==='google')return;
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw new Error('Shared deployment requires Google mode and office sign-in. Local preview mode cannot run on a public site.');
  await database();
  if(!localStorage.getItem('newsroom-seeded')){
    await transaction('readwrite',s=>{for(const row of demoSubmissions())s.put(row);});
    localStorage.setItem('newsroom-seeded','1');
  }
}
export async function listSubmissions() {
  if(['server','cloudflare'].includes(config.mode))return (await portalRequest('submissions')).records;
  if(config.mode==='google')return (await googleRequest('list')).records;
  await assertLocalOffice();
  const rows=await transaction('readonly',s=>s.getAll());
  return rows.filter(r=>canReadRecord(r,session)).map(r=>recordForUser(r,session));
}
export async function saveSubmission(record) {
  if(config.mode==='cloudflare'){
    try{
      const saved=(await portalRequest('submissions',{record:await uploadCloudImages(record)})).record;
      for(const key of uploadedImages.keys())if(key.startsWith(record.id+':')&&!record.images.some(i=>key===record.id+':'+i.id))uploadedImages.delete(key);
      return saved;
    }catch(error){for(const key of uploadedImages.keys())if(key.startsWith(record.id+':'))uploadedImages.delete(key);throw error;}
  }
  if(config.mode==='server')return (await portalRequest('submissions',{record})).record;
  if(config.mode==='google')return (await googleRequest('save',{record})).record;
  await assertLocalOffice();
  const old=await transaction('readonly',s=>s.get(record.id));
  if(old&&!canReadRecord(old,session))throw new Error('This submission is only available to the office.');
  if(!isOffice(session)&&!['Draft','Submitted'].includes(record.status))throw new Error('Only the office can change review status.');
  const saved={...record,ownerSub:old?.ownerSub||session.sub};
  if(!isOffice(session)){saved.editorNotes=old?.editorNotes||'';saved.original=null;saved.publishedUrl='';}
  await transaction('readwrite',s=>s.put(saved));return recordForUser(saved,session);
}
export async function loadImages(record) {
  if(config.mode==='cloudflare'){
    const full=(await portalRequest('records/'+encodeURIComponent(record.id))).record;
    for(const image of full.images){
      const response=await cloudImageRequest('images/'+encodeURIComponent(full.id)+'/'+encodeURIComponent(image.id));
      image.dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);response.blob().then(blob=>reader.readAsDataURL(blob)).catch(reject);});
      uploadedImages.set(full.id+':'+image.id,image.dataUrl);
    }
    return full;
  }
  if(config.mode==='server')return (await portalRequest(`records/${encodeURIComponent(record.id)}`)).record;
  if(config.mode==='local'){
    await assertLocalOffice();
    const stored=await transaction('readonly',s=>s.get(record.id));
    if(!stored||!canReadRecord(stored,session))throw new Error('This submission is only available to the office.');
    return recordForUser(stored,session);
  }
  if(!record.images?.some(i=>!i.dataUrl))return record;
  const data=await googleRequest('images',{id:record.id});return {...record,images:data.images};
}
export async function localImport(records) {
  if(config.mode==='cloudflare'){
    const existing=new Set((await listSubmissions()).map(r=>r.id)),prepared=[];
    for(const record of records)if(!existing.has(record.id))prepared.push(await uploadCloudImages(record));
    return (await portalRequest('import',{records:prepared})).imported;
  }
  if(config.mode==='server')return (await portalRequest('import',{records})).imported;
  if(config.mode==='google')throw new Error('Backup import is available in local mode only.');
  if(!isOffice(session))throw new Error('Only the office can import backups.');
  await assertLocalOffice();
  // One transaction: either the complete validated package is imported, or no records change.
  await transaction('readwrite',s=>{for(const row of records)s.put(row);});
}

// Transfer one binary image at a time; record requests contain metadata only.
const uploadedImages=new Map();
async function cloudImageRequest(path,body,type){
  const response=await fetch('/api/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...(type?{'Content-Type':type}:{}),...(isOffice(session)?{'X-Newsroom-Office':'1'}:{})},...(body?{body}:{})});
  if(!response.ok){
    const data=await response.json().catch(()=>({}));
    if(response.status===401&&isOffice(session)){session.role='contributor';session.officeExpiresAt=0;window.dispatchEvent(new Event('office-locked'));}
    throw new Error(data.error||'The image could not be transferred. Your form has not been cleared.');
  }
  return response;
}
async function uploadCloudImages(record){
  const images=[];
  for(const image of record.images||[]){
    const key=record.id+':'+image.id;
    if(image.dataUrl&&uploadedImages.get(key)!==image.dataUrl){
      const encoded=image.dataUrl.split(',')[1],raw=atob(encoded),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
      await cloudImageRequest('uploads/'+encodeURIComponent(record.id)+'/'+encodeURIComponent(image.id),bytes,image.type);
      uploadedImages.set(key,image.dataUrl);
    }
    const {dataUrl,...metadata}=image;images.push(metadata);
  }
  return {...record,images};
}
