import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Administration,signature,sha} from '../cloudflare/automation.mjs';
import {makeCredential} from '../office-auth.mjs';

const office={role:'editor'},contributor={role:'contributor'},origin='https://portal.example';
const baseCredential=makeCredential('Synthetic office password');
function setup(t,env={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const sql={exec(query,...args){const stmt=db.prepare(query);const rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>rows};}};
  for(const query of ['CREATE TABLE records (id TEXT PRIMARY KEY, owner TEXT,status TEXT,data TEXT)','CREATE TABLE images (record_id TEXT,image_id TEXT,owner TEXT,type TEXT,size INTEGER,hash TEXT,created INTEGER,PRIMARY KEY(record_id,image_id))','CREATE TABLE chunks (record_id TEXT,image_id TEXT,part INTEGER,data BLOB)','CREATE TABLE sessions (token TEXT,expires INTEGER,credential TEXT)'])sql.exec(query);
  const p={sql,env:{RETAIN_NEWS_BYTES:'0',...env},ctx:{storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}},one:(q,...a)=>sql.exec(q,...a).toArray()[0],rate(){},credential:()=>p.admin.get('credential',baseCredential),record(id){const r=p.one('SELECT data FROM records WHERE id=?',id);return r?JSON.parse(r.data):null;},deleteImage(id,image){if(!p.admin.pin(id,image)){sql.exec('DELETE FROM images WHERE record_id=? AND image_id=?',id,image);sql.exec('DELETE FROM chunks WHERE record_id=? AND image_id=?',id,image);}}};
  const a=p.admin=new Administration(p);
  function add(id,status='Submitted',images=[]){const row={id,status,version:1,headline:id,images,history:[],details:{officeComments:'Private test note'}};sql.exec('INSERT INTO records VALUES(?,?,?,?)',id,'owner',status,JSON.stringify(row));return row;}
  function image(id,name,bytes=new Uint8Array([1,2,3])){sql.exec('INSERT INTO images VALUES(?,?,?,?,?,?,?)',id,name,'owner','image/png',bytes.length,'f'.repeat(64),Date.now());sql.exec('INSERT INTO chunks VALUES(?,?,?,?)',id,name,0,bytes);}
  async function connect(enabled=true){const {code}=await a.createPair();const {secret}=await a.pair({code,folderId:'private-root-123',folderName:'UND Chemistry News Backups'});await a.automation({action:'ready'});if(enabled)a.put('config',{...a.config(),enabled:true});return secret;}
  return {a,p,add,image,connect};
}
async function signed(secret,data,extra={}){const at=Date.now(),nonce=crypto.randomUUID().replaceAll('-','')+'a'.repeat(16),payload=JSON.stringify(data);return {at,nonce,payload,signature:await signature(secret,'google-to-portal',at,nonce,payload),...extra};}
const receipt=task=>({jobId:task.job.id,id:task.record.id,snapshotHash:task.snapshotHash,fileId:'backup-file-'+task.record.id,folderId:'backup-folder-123',fileHash:'d'.repeat(64),verified:true});
const completion=job=>({jobId:job.id,manifestId:'manifest-file-123',manifestHash:'e'.repeat(64),verified:true,mailAccepted:true});

test('automation pairing is expiring and one-use; signed requests reject tampering and replay',async t=>{
  const {a,connect}=setup(t);const secret=await connect();
  await assert.rejects(()=>a.pair({code:'a'.repeat(48)}),/invalid or expired/);
  const message=await signed(secret,{action:'next'});assert.deepEqual(await a.authenticate(message),{action:'next'});
  await assert.rejects(()=>a.authenticate(message),/already used/);
  await assert.rejects(async()=>a.authenticate({...await signed(secret,{action:'next'}),payload:'{"action":"complete"}'}),/authentication/);
  await assert.rejects(async()=>a.authenticate(await signed(secret,{action:'next'},{at:0})),/authentication/);
  await assert.rejects(()=>a.office('settings',{},contributor,'ip',origin),/Office access/);
});

test('daily checks are silent below limits and do not create draft-only rollover loops',async t=>{
  const {a,add,connect}=setup(t);await connect();add('draft','Draft');
  assert.equal((await a.next({})).task,'idle');assert.equal(a.get('backup'),null);
  a.p.env.MAX_STORAGE_BYTES='1000';assert.equal((await a.next({})).task,'idle');assert.equal(a.get('backup'),null);
});

test('rollover requires every verified record; preserves drafts and changed records',async t=>{
  const {a,p,add,connect}=setup(t,{MAX_STORAGE_BYTES:'1000'});await connect();
  add('first');add('changed');add('draft','Draft');
  let task=await a.next({});const job=task.job;
  assert.throws(()=>a.complete(completion(job)),/incomplete/);
  while(task.task==='record'){a.receipt(receipt(task));task=await a.next({});}
  const changed=p.record('changed');changed.version=2;p.sql.exec('UPDATE records SET data=? WHERE id=?',JSON.stringify(changed),'changed');
  assert.ok(p.record('first'));
  assert.equal(a.complete(completion(job)).deleted,1);assert.equal(p.record('first'),null);assert.ok(p.record('draft'));assert.ok(p.record('changed'));
  assert.equal(a.complete(completion(job)).deleted,1);
});

test('snapshot images remain readable during edits; pending new uploads prevent cleanup',async t=>{
  const {a,p,add,image,connect}=setup(t,{MAX_STORAGE_BYTES:'1000'});await connect();
  add('edited','Submitted',[{id:'old'}]);image('edited','old');add('pending');
  let task=await a.next({}),job=task.job;
  const edited=p.record('edited');edited.version++;edited.images=[];p.sql.exec('UPDATE records SET data=? WHERE id=?',JSON.stringify(edited),'edited');p.deleteImage('edited','old');
  assert.equal(a.image({jobId:job.id,id:'edited',imageId:'old'}).size,3);
  while(task.task==='record'){a.receipt(receipt(task));task=await a.next({});}
  image('pending','new-upload');
  assert.equal(a.complete(completion(job)).deleted,0);assert.ok(p.record('pending'));assert.ok(p.record('edited'));
  assert.equal(p.one('SELECT COUNT(*) AS n FROM images WHERE record_id=?','edited').n,0);
  assert.equal(p.one('SELECT COUNT(*) AS n FROM images WHERE record_id=?','pending').n,1);
});

test('failed backup retains records and pins until an explicit retry',async t=>{
  const {a,p,add,image,connect}=setup(t,{MAX_STORAGE_BYTES:'1000'});await connect();add('story','Submitted',[{id:'image'}]);image('story','image');
  const task=await a.next({});await a.automation({action:'error',jobId:task.job.id,message:'Drive folder was deleted.'});
  assert.equal((await a.next({})).task,'stopped');assert.ok(p.record('story'));assert.ok(a.pin('story','image'));
  assert.throws(()=>a.complete(completion(task.job)),/incomplete/);
  await a.office('retry-backup',{},office,'ip',origin);assert.equal((await a.next({})).task,'record');
});

test('manual backup never deletes news or requires a notification',async t=>{
  const {a,p,add,connect}=setup(t);await connect();add('manual');
  const job=await a.startBackup(false),task=await a.next({});a.receipt(receipt(task));await a.next({});
  assert.equal(a.complete({...completion(job),mailAccepted:false}).deleted,0);assert.ok(p.record('manual'));
});

test('email and email-based password recovery remain disabled even after Drive connection',async t=>{
  const {a,connect}=setup(t);await connect();
  for(const action of ['reset-request','reset-challenge','reset-complete','change-email','confirm-email'])await assert.rejects(()=>a.office(action,{},office,'ip',origin),/disabled/);
  assert.equal(typeof a.sendMail,'undefined');assert.equal(a.status().bridge,undefined);
});

test('a new connection cannot enable cleanup until an initial nonempty backup is verified',async t=>{
  const {a,add,connect}=setup(t);await connect(false);assert.equal(a.config().enabled,false);
  await assert.rejects(()=>a.office('enable-backups',{},office,'ip',origin),/initial backup/);
  add('initial');const job=await a.startBackup(false),task=await a.next({});a.receipt(receipt(task));await a.next({});
  a.complete({...completion(job),mailAccepted:false});await a.office('enable-backups',{},office,'ip',origin);assert.equal(a.config().enabled,true);
});


test('cleanup keeps the newest whole news items within its retention target',async t=>{
  const {a,p,add,connect}=setup(t,{MAX_STORAGE_BYTES:'1000'});await connect();
  for(const [id,createdAt] of [['oldest','2026-01-01'],['middle','2026-02-01'],['newest','2026-03-01']]){
    const row=add(id);row.createdAt=createdAt;p.sql.exec('UPDATE records SET data=? WHERE id=?',JSON.stringify(row),id);
  }
  const size=id=>Buffer.byteLength(JSON.stringify(p.record(id)));
  p.env.RETAIN_NEWS_BYTES=String(size('newest')+size('middle'));
  let task=await a.next({});const job=task.job;
  while(task.task==='record'){a.receipt(receipt(task));task=await a.next({});}
  assert.equal(a.complete(completion(job)).deleted,1);assert.equal(p.record('oldest'),null);assert.ok(p.record('middle'));assert.ok(p.record('newest'));
});

test('production policy triggers at 209 MiB and retains 50 MiB of latest news',t=>{
  const {a,p}=setup(t);delete p.env.RETAIN_NEWS_BYTES;assert.equal(a.usage().thresholdBytes,209*1048576);assert.equal(a.usage().retainBytes,50*1048576);
});
