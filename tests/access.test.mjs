import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {canReadRecord,recordForUser,officeRoute} from '../public/access.js';
import {emptySubmission} from '../public/model.js';

const source=await readFile(new URL('../google-backend/Code.gs',import.meta.url),'utf8');
const contributor={role:'contributor',sub:'contributor-a',email:'a@example.edu',name:'Example Contributor'};
const office={role:'editor',sub:'office',email:'office@example.edu',name:'Example Office'};
const makeRecord=(changes={})=>({...emptySubmission(),id:'private-test',reference:'CN-TEST',ownerSub:contributor.sub,version:1,category:'other',headline:'Private test headline',summary:'Private test summary',submitter:'Example Contributor',group:'Example Group',newsDate:'2026-10-23',details:{people:'Example Contributor'},permission:true,editorNotes:'Private office note',history:[{note:'Private review history'}],original:{summary:'Original private copy'},...changes});
const plain=value=>JSON.parse(JSON.stringify(value));
function backend(){const ctx=vm.createContext({Date,JSON,Number,String,Object,Array,Set,Error});vm.runInContext(source,ctx);return ctx;}

test('local and server policies restrict all submitted statuses to the office',()=>{
  const ctx=backend();
  for(const check of [canReadRecord,ctx.canRead_]){
    assert.equal(check(makeRecord(),contributor),true);
    assert.equal(check(makeRecord({ownerSub:'contributor-b'}),contributor),false);
    assert.equal(check(makeRecord(),{role:'contributor',sub:''}),false);
    assert.equal(check(makeRecord(),{role:'visitor',sub:contributor.sub}),false);
    for(const status of ['Submitted','In review','Changes requested','Approved','Published','Archived']){
      const row=makeRecord({status});
      assert.equal(check(row,contributor),false,status);
      assert.equal(check(row,office),true,status);
    }
    assert.equal(check(makeRecord({ownerSub:'contributor-b'}),office),true);
  }
});

test('submission responses contain a receipt and draft responses exclude office-only history',()=>{
  const ctx=backend();
  for(const prepare of [recordForUser,ctx.recordForUser_]){
    const row=makeRecord({status:'Submitted',images:[{id:'private-image',fileId:'private-drive-id'}]});
    assert.deepEqual(plain(prepare(row,contributor)),{id:row.id,reference:row.reference,status:'Submitted'});
    const draft=prepare({...row,status:'Draft'},contributor);
    assert.equal(draft.editorNotes,'');assert.equal(draft.original,null);assert.deepEqual(plain(draft.history),[]);
    assert.equal(prepare(row,office),row);
  }
  for(const route of ['dashboard','archive','settings','story'])assert.equal(officeRoute(route),true);
  for(const route of ['submit','drafts','edit'])assert.equal(officeRoute(route),false);
});

function endpoint(records,user=contributor){
  const ctx=backend();let storageReads=0,driveReads=0;
  ctx.settings_=()=>({folder:'private-folder'});
  ctx.verifyToken_=token=>{if(token!=='valid-token')throw new Error('Invalid token');return user;};
  ctx.rateLimit_=()=>{};ctx.json_=plain;
  // These tests cover record permissions after office authentication. The
  // separate password suite exercises the actual office authentication layer.
  ctx.officeSession_=user=>user;
  ctx.readRecords_=()=>{storageReads++;return records;};
  ctx.DriveApp={getFolderById(){driveReads++;return {};}};
  const call=body=>ctx.doPost({postData:{contents:JSON.stringify({token:'valid-token',...body})}});
  return {ctx,call,reads:()=>({storageReads,driveReads})};
}

test('list endpoint ignores spoofed roles and never returns submitted news to contributors',()=>{
  const records=[makeRecord(),makeRecord({id:'other-draft',ownerSub:'contributor-b'}),makeRecord({id:'own-submitted',status:'Submitted'}),makeRecord({id:'published',status:'Published'})];
  const api=endpoint(records);
  const result=api.call({action:'list',role:'editor',user:office});
  assert.equal(result.ok,true);assert.deepEqual(result.records.map(r=>r.id),['private-test']);
  assert.equal(result.records[0].editorNotes,'');
  assert.deepEqual(endpoint(records,office).call({action:'list'}).records,plain(records));
});

test('image requests with guessed IDs are denied before private Drive access',()=>{
  const api=endpoint([makeRecord({status:'Submitted'}),makeRecord({id:'other-draft',ownerSub:'contributor-b'})]);
  for(const id of ['private-test','other-draft','missing']){
    const result=api.call({action:'images',id,role:'editor'});
    assert.equal(result.ok,false);assert.match(result.error,/not available/);
  }
  assert.equal(api.reads().driveReads,0);
  assert.equal(endpoint([makeRecord()],office).call({action:'images',id:'private-test'}).ok,true);
});

test('unauthenticated list, image, and save requests never read storage',()=>{
  const api=endpoint([makeRecord()]);
  for(const action of ['list','images','save'])assert.equal(api.call({token:'invalid',action,id:'private-test',record:makeRecord()}).ok,false);
  assert.deepEqual(api.reads(),{storageReads:0,driveReads:0});
});

test('saved submissions become office-only and cannot be changed by their contributor',()=>{
  const api=endpoint([]);const rows=[];let writes=0;
  const sheet={getLastRow:()=>rows.length+1,getRange:row=>({setValues:values=>{writes++;rows[row-2]=JSON.parse(values[0][7]);}})};
  api.ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
  api.ctx.recordsSheet_=()=>sheet;api.ctx.readRecords_=()=>rows;
  api.ctx.SpreadsheetApp={flush:()=>{}};
  const draft=api.call({action:'save',record:makeRecord({ownerSub:'spoofed-owner'})});
  assert.equal(draft.ok,true);assert.equal(draft.record.ownerSub,contributor.sub);
  assert.equal(draft.record.editorNotes,'');
  const submitted=api.call({action:'save',record:{...draft.record,status:'Submitted'}});
  assert.equal(submitted.ok,true);
  assert.deepEqual(Object.keys(submitted.record).sort(),['id','reference','status']);
  assert.equal(rows[0].summary,'Private test summary');
  assert.deepEqual(api.call({action:'list'}).records,[]);
  for(const status of ['Draft','Submitted','Approved']){
    const result=api.call({action:'save',record:{...rows[0],headline:'Unauthorized change',status}});
    assert.equal(result.ok,false);assert.match(result.error,/not available/);
  }
  assert.equal(writes,2);assert.equal(rows[0].headline,'Private test headline');
  api.ctx.verifyToken_=()=>office;
  const reviewed=api.call({action:'save',record:{...rows[0],status:'In review',editorNotes:'Office review'}});
  assert.equal(reviewed.ok,true);assert.equal(reviewed.record.editorNotes,'Office review');
  assert.equal(writes,3);
});
