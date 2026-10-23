import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {categories,category,statuses,publicationEntries,validateSubmission,releaseEligible,safeUrl} from './public/model.js';
import {canReadRecord,recordForUser} from './public/access.js';

import {validatePortalRecord} from './record-validation.mjs';
export {validatePortalRecord} from './record-validation.mjs';
const MB=1024*1024, identifier=/^[a-zA-Z0-9_-]{1,100}$/;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function text(value,limit,label){
  if(value==null)return '';
  if(typeof value!=='string'||value.length>limit)throw fail(`${label} must be text of at most ${limit.toLocaleString()} characters.`);
  return value;
}
function details(input,cat){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid news details.');
  const result={};
  for(const [key] of category(cat).fields)result[key]=text(input[key],key==='abstract'?20000:['officeComments','moreInformation'].includes(key)?6000:2000,key);
  if(cat==='publication')result.publicationDate=text(input.publicationDate,30,'Publication date');
  return result;
}
const metadata=row=>({...row,images:row.images.map(({dataUrl,...image})=>image)});

export async function createPortalStore({directory,officeAuth,now=Date.now,maxStorageBytes=256*MB}){
  await mkdir(directory,{recursive:true,mode:0o700});
  const dbPath=join(directory,'submissions.json'),keyPath=join(directory,'contributor-key');
  let key;
  try{key=await readFile(keyPath);}catch(error){if(error.code!=='ENOENT')throw error;key=randomBytes(32);await writeFile(keyPath,key,{flag:'wx',mode:0o600});}
  let records=[];
  try{records=JSON.parse(await readFile(dbPath,'utf8'));if(!Array.isArray(records))throw new Error('Invalid submission store.');}catch(error){if(error.code!=='ENOENT')throw error;}
  let queue=Promise.resolve();
  const serialized=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
  async function commit(next){
    const body=JSON.stringify(next);
    if(next.length>1000||Buffer.byteLength(body)>maxStorageBytes)throw fail('Portal storage is full. Ask the office administrator to back up the records and review storage. Nothing was saved.',507);
    // A rename commits the complete snapshot; a failed write leaves the prior file intact.
    const temporary=join(directory,'submissions.pending');
    await writeFile(temporary,body,{mode:0o600});await rename(temporary,dbPath);records=next;
  }
  const cookieName='newsroom_contributor',lifetime=30*24*60*60*1000;
  const sign=value=>createHmac('sha256',key).update(value).digest('hex');
  function contributor(req){
    const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
    const [id,until,signature]=cookie.split('.'),payload=`${id}.${until}`;
    if(!/^[a-f0-9]{48}$/.test(id||'')||!/^\d{13}$/.test(until||'')||!/^[a-f0-9]{64}$/.test(signature||'')||Number(until)<=now())return '';
    return timingSafeEqual(Buffer.from(sign(payload),'hex'),Buffer.from(signature,'hex'))?id:'';
  }
  function user(req){return {role:officeAuth.expiresAt(req)?'editor':'contributor',sub:contributor(req)};}
  function response(res,status,data,cookie){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));}
  async function body(req,limit=44*MB){
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail('Use JSON for this request.',415);
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>limit)throw fail('This upload is too large.',413);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail('Invalid request data.');}
  }
  async function save(input,actor){
    return serialized(async()=>{
      const old=records.find(r=>r.id===input?.id);
      if(old&&!canReadRecord(old,actor))throw fail('This submission is not available.',404);
      if(old&&Number(input.version)!==old.version)throw fail('This submission was updated elsewhere. Reload before editing it again.',409);
      const row=validatePortalRecord(input,old),office=actor.role==='editor';
      if((!old||!office)&&!['Draft','Submitted'].includes(row.status))throw fail('Only the office can change review status.',403);
      if(!office){row.editorNotes='';row.publishedUrl='';}
      if(row.status==='Changes requested'&&!row.editorNotes.trim())throw fail('Describe the requested changes in the office note.');
      if(row.status==='Published'&&!releaseEligible(row,now()))throw fail('Resolve release restrictions before recording publication.');
      const at=new Date(now()).toISOString();
      Object.assign(row,{ownerSub:old?.ownerSub||actor.sub,reference:old?.reference||`CN-${new Date(now()).getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,createdAt:old?.createdAt||at,updatedAt:at,version:(old?.version||0)+1,sample:old?.sample||false,email:old?.email||'',channels:old?.channels||['Newsletter','Department website'],publishedAt:old?.publishedAt||(row.status==='Published'?at:''),original:old?.original||(old&&old.status!=='Draft'?{headline:old.headline,summary:old.summary,details:old.details,additionalPublications:old.additionalPublications}:null)});
      row.history=[...(old?.history||[]),{status:row.status,at,actor:office?'Department office':row.submitter||'Contributor',note:office&&row.editorNotes!==old?.editorNotes?row.editorNotes:''}].slice(-150);
      await commit(records.filter(r=>r.id!==row.id).concat(row));
      return recordForUser(row,actor);
    });
  }
  async function importRecords(input){
    if(!Array.isArray(input)||input.length>1000)throw fail('Import up to 1,000 records.');
    return serialized(async()=>{
      const ids=new Set(records.map(r=>r.id)),addition=[];
      for(const source of input){
        if(ids.has(source?.id))continue;
        const row=validatePortalRecord(source);
        row.createdAt=text(source.createdAt,40,'Created date');row.updatedAt=text(source.updatedAt||source.createdAt,40,'Updated date');
        if(!Number.isFinite(Date.parse(row.createdAt))||!Number.isFinite(Date.parse(row.updatedAt)))throw fail('Invalid record dates.');
        row.reference=text(source.reference,100,'Reference')||`CN-IMPORT-${randomBytes(4).toString('hex')}`;
        row.version=1;row.ownerSub='imported-office-record';row.sample=source.sample===true;row.email=text(source.email,254,'Email');
        row.publishedAt=text(source.publishedAt,40,'Published date');row.channels=['Newsletter','Department website'];
        row.original=source.original?{headline:text(source.original.headline,180,'Original headline'),summary:text(source.original.summary,6000,'Original summary'),details:details(source.original.details,row.category),additionalPublications:validatePortalRecord({...row,status:'Draft',images:[],additionalPublications:source.original.additionalPublications||[]}).additionalPublications} : null;
        row.history=(Array.isArray(source.history)?source.history:[]).slice(-150).map(h=>({status:text(h.status,40,'History status'),at:text(h.at,40,'History date'),actor:text(h.actor,200,'History author'),note:text(h.note,6000,'History note')}));
        addition.push(row);ids.add(row.id);
      }
      if(addition.length)await commit(records.concat(addition));
      return addition.length;
    });
  }
  async function handle(req,res){
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/api/session','/api/submissions','/api/import'].includes(path)&&!path.startsWith('/api/records/'))return false;
    try{
      if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')||req.headers['sec-fetch-site']==='cross-site'||(req.method==='POST'&&req.headers.origin!==`http://${req.headers.host}`))throw fail('Open the portal from its local address.',403);
      if(path==='/api/session'&&req.method==='GET'){
        let id=contributor(req),cookie;
        if(!id){id=randomBytes(24).toString('hex');const payload=`${id}.${now()+lifetime}`;cookie=`${cookieName}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${lifetime/1000}`;}
        const expiry=officeAuth.expiresAt(req);
        response(res,200,{ok:true,user:{sub:id,role:expiry?'editor':'contributor',name:expiry?'Department office':'Contributor',officeExpiresAt:expiry}},cookie);return true;
      }
      const actor=user(req);
      if(req.headers['x-newsroom-office']==='1'&&actor.role!=='editor')throw fail('Office access has expired. Enter the password again.',401);
      if(!actor.sub)throw fail('Your browser session has expired. Reload the portal to continue.',401);
      if(path==='/api/submissions'&&req.method==='GET'){response(res,200,{ok:true,records:records.filter(r=>canReadRecord(r,actor)).map(r=>metadata(recordForUser(r,actor)))});return true;}
      if(path==='/api/submissions'&&req.method==='POST'){response(res,200,{ok:true,record:await save((await body(req)).record,actor)});return true;}
      if(path.startsWith('/api/records/')&&req.method==='GET'){
        const row=records.find(r=>r.id===path.slice('/api/records/'.length));
        if(!row||!canReadRecord(row,actor))throw fail('This submission is not available.',404);
        response(res,200,{ok:true,record:recordForUser(row,actor)});return true;
      }
      if(path==='/api/import'&&req.method==='POST'){
        if(actor.role!=='editor')throw fail('Only the office can import records.',403);
        response(res,200,{ok:true,imported:await importRecords((await body(req,104*MB)).records)});return true;
      }
      throw fail('Method not allowed.',405);
    }catch(error){response(res,error.status||500,{ok:false,error:error.status?error.message:'The portal could not save or read the records. Please try again.'});}
    return true;
  }
  return {handle};
}
