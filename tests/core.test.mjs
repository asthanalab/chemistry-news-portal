import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import {emptySubmission,emptyPublication,publicationEntries,publicationDetailFields,removePublication,validateSubmission,releaseEligible,escapeHtml,safeUrl,demoSubmissions} from '../public/model.js';
import {createWorkbook,workbookSheets,zipFiles} from '../public/exports.js';

const valid=()=>({...emptySubmission(),id:'valid-test',category:'publication',headline:'CO₂ & α-selectivity',summary:'A fictional result.',submitter:'Example Contributor',email:'example@example.edu',group:'Example Group',newsDate:'2026-10-23',details:{paperTitle:'A title',authors:'A. Example',venue:'Example Journal',publicationStatus:'Published'},permission:true});
test('submission requires name and research group, with no institution or email requirement',()=>{
  assert.deepEqual(validateSubmission(valid()),{});
  const student={...valid(),submitter:'Example Student'};delete student.email;
  assert.deepEqual(validateSubmission(student),{});
  const s=valid();s.details.authors='';s.submitter='';s.group='';
  assert.ok(validateSubmission(s)['details.authors']);assert.ok(validateSubmission(s).submitter);assert.ok(validateSubmission(s).group);
  assert.ok(validateSubmission(emptySubmission()).headline);
});
test('release exports exclude embargoes, pending rights, contact holds and unapproved records',()=>{
  const s={...valid(),status:'Approved'};assert.equal(releaseEligible(s),true);
  for(const change of [{status:'Submitted'},{release:'contact'},{release:'embargo',embargo:'2099-01-01T00:00:00Z'},{images:[{rights:'pending'}]}])assert.equal(releaseEligible({...s,...change}),false);
  assert.equal(releaseEligible({...s,release:'embargo',embargo:'2000-01-01T00:00:00Z'}),true);
});
test('image metadata and permission confirmation are mandatory on submission',()=>{
  const s=valid();s.images=[{caption:'',credit:'',alt:''}];s.permission=false;
  assert.ok(validateSubmission(s)['image.0.credit']);assert.ok(validateSubmission(s).permission);
});
test('untrusted text and unsafe URLs remain inert',()=>{
  assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('https://example.com'),'https://example.com/');
  assert.equal(escapeHtml('<img onerror="bad">'),'&lt;img onerror=&quot;bad&quot;&gt;');
});
test('publication workbook excludes contact information, private notes and nonpublic funding amounts',()=>{
  const grant={...valid(),status:'Approved',category:'grant',notes:'PRIVATE NOTE',email:'private@example.edu',details:{projectTitle:'Research',funder:'Funder',investigator:'Example',awardStatus:'Awarded',amount:'123456',currency:'USD',amountPermission:'No'}};
  const workbook=JSON.stringify(workbookSheets([grant],{publicationOnly:true}));
  assert.ok(!workbook.includes('PRIVATE NOTE'));assert.ok(!workbook.includes('private@example.edu'));assert.ok(!workbook.includes('123456'));assert.ok(workbook.includes('Withheld'));
});
test('workbook is a real ZIP container with literal text, not an HTML file renamed as Excel',async()=>{
  const s=valid();s.headline='=HYPERLINK("https://example.com")';
  const bytes=createWorkbook([s]);assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  const content=new TextDecoder().decode(bytes);assert.ok(content.includes('t="inlineStr"'));assert.ok(!content.includes('<f>'));assert.ok(content.includes('xl/workbook.xml'));
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/workbook.xlsx',import.meta.url),createWorkbook([...demoSubmissions(),s]));
});
test('ZIP preserves binary file data',()=>{const bytes=zipFiles({'sample.bin':new Uint8Array([0,255,20]),'readme.txt':'CO₂'});assert.ok(bytes.length>100);});

const backendSource=await readFile(new URL('../google-backend/Code.gs',import.meta.url),'utf8');
function backend(extra={}){const ctx=vm.createContext({Date,JSON,Number,String,Object,Array,Set,Error,...extra});vm.runInContext(backendSource,ctx);return ctx;}
test('Google backend enforces identity audience, verification and an explicit access list',()=>{
  let claims={aud:'expected',iss:'https://accounts.google.com',exp:Math.floor(Date.now()/1000)+1000,email_verified:'true',sub:'123',email:'contributor@example.edu',name:'Example'};
  const ctx=backend({UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(claims)})}});
  const settings={clientId:'expected',editors:[],contributors:['contributor@example.edu'],domains:[]};
  assert.equal(ctx.verifyToken_('token',settings).role,'contributor');
  claims.aud='wrong';assert.throws(()=>ctx.verifyToken_('token',settings),/invalid/);claims.aud='expected';
  claims.email_verified='false';assert.throws(()=>ctx.verifyToken_('token',settings),/invalid/);claims.email_verified='true';
  assert.throws(()=>ctx.verifyToken_('token',{...settings,contributors:[],domains:['example.edu']}),/access list/);
  claims.hd='example.edu';assert.equal(ctx.verifyToken_('token',{...settings,contributors:[],domains:['example.edu']}).role,'contributor');
});
test('Google backend rejects invalid files, unknown categories and incomplete submissions',()=>{
  const ctx=backend();const s={...valid(),status:'Submitted'};
  assert.equal(ctx.validateRecord_(s).headline,s.headline);
  const student={...s,submitter:'Example Student'};delete student.email;
  assert.equal(ctx.validateRecord_(student).submitter,'Example Student');
  assert.throws(()=>ctx.validateRecord_({...s,category:'__proto__'}),/category/);
  assert.throws(()=>ctx.validateRecord_({...s,images:[{id:'image',type:'text/html'}]}),/image/);
  assert.throws(()=>ctx.validateRecord_({...s,permission:false}),/permission/);
  assert.equal(ctx.sheetText_('=IMPORTXML("bad")'),'\'=IMPORTXML("bad")');
  assert.equal(ctx.canRead_({ownerSub:'someone-else'},{sub:'123',role:'contributor'}),false);
});
test('Google backend limits email to requested password changes and never shares files publicly',()=>{
  assert.ok(!/GmailApp|setSharing|addViewer|addEditor/.test(backendSource));
  assert.equal((backendSource.match(/MailApp\.sendEmail/g)||[]).length,1);
  assert.ok(backendSource.includes("body.action==='officeResetRequest'"));
  assert.ok(backendSource.includes('to:settings.email'));
});

const multiple=()=>({...valid(),reference:'MULTI-TEST',status:'Submitted',additionalPublications:[{...emptyPublication(),id:'second-paper',paperTitle:'Second paper: CO₂ chemistry',authors:'B. Example',venue:'Second Journal',publicationStatus:'Accepted',abstract:'Second abstract',publicationDate:'2026-10-22'}],images:[{id:'first-image',type:'image/png',name:'first.png',size:100,caption:'First caption',credit:'Example',alt:'First figure',rights:'cleared'},{id:'second-image',publicationId:'second-paper',type:'image/png',name:'second.png',size:100,caption:'Second caption',credit:'Example',alt:'Second figure',rights:'cleared'}]});
test('multiple papers validate independently without changing legacy single-paper records',()=>{
  assert.equal(publicationEntries(valid()).length,1);
  const s=multiple();assert.deepEqual(validateSubmission(s),{});
  s.additionalPublications[0].authors='';
  assert.ok(validateSubmission(s,1)['additionalPublications.0.authors']);
  assert.deepEqual(validateSubmission(s,0),{});
  s.additionalPublications[0].publicationDate='invalid';
  assert.ok(validateSubmission(s,1)['additionalPublications.0.publicationDate']);
  s.additionalPublications[0].id='primary';assert.ok(validateSubmission(s,1).publications);
});
test('publication images retain their owner through removal and reject dangling associations',()=>{
  const s=multiple();removePublication(s,'second-paper');
  assert.equal(s.additionalPublications.length,0);assert.equal(s.images.length,1);assert.equal(s.images[0].id,'first-image');
  s.images.push(multiple().images[1]);assert.ok(validateSubmission(s,2).images);
  const four=multiple();four.images=Array.from({length:4},(_,i)=>({...four.images[0],id:`image-${i}`}));
  assert.ok(validateSubmission(four,2).images);
  four.images[3].publicationId='second-paper';assert.deepEqual(validateSubmission(four,2),{});
  four.images.forEach(i=>i.size=10*1024*1024);assert.ok(validateSubmission(four,2).images);
});
test('Excel exports each paper separately and maps images to the correct paper',async()=>{
  const s={...multiple(),status:'Approved',notes:'PRIVATE MULTI NOTE'};
  const sheets=workbookSheets([s],{publicationOnly:true});
  const papers=sheets.find(x=>x.name==='Publication').rows,media=sheets.find(x=>x.name==='Media').rows;
  assert.equal(papers.length,3);assert.equal(papers[1][2],'primary');assert.equal(papers[2][2],'second-paper');
  assert.equal(papers[2][papers[0].indexOf('Abstract')],'Second abstract');
  assert.equal(papers[2][papers[0].indexOf('Publication date')],'2026-10-22');
  assert.equal(media[1][media[0].indexOf('Publication number')],1);
  assert.equal(media[2][media[0].indexOf('Paper title')],s.additionalPublications[0].paperTitle);
  assert.ok(!JSON.stringify(sheets).includes('PRIVATE MULTI NOTE'));
  assert.equal(workbookSheets([{...s,release:'contact'}],{publicationOnly:true}).some(x=>x.name==='Publication'),false);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/multiple-publications.xlsx',import.meta.url),createWorkbook([s]));
});
test('Google backend preserves every paper and validates every paper and image association',()=>{
  const ctx=backend(),s=multiple(),clean=ctx.validateRecord_(s);
  assert.equal(clean.additionalPublications[0].abstract,'Second abstract');assert.equal(clean.images[1].publicationId,'second-paper');assert.equal(clean.images[0].publicationId,'primary');
  s.additionalPublications[0].venue='';assert.throws(()=>ctx.validateRecord_(s),/publication 2/);
  s.status='Draft';assert.equal(ctx.validateRecord_(s).additionalPublications.length,1);
  s.images[1].publicationId='missing';assert.throws(()=>ctx.validateRecord_(s),/missing publication/);
  s.images=[];s.additionalPublications[0].id='primary';assert.throws(()=>ctx.validateRecord_(s),/publication ID/);
});

test('publication office comments stay internal while more information is retained in public copy',()=>{
  const s={...multiple(),status:'Approved'};
  s.details.officeComments='PRIVATE FIRST PAPER COMMENT';s.details.moreInformation='First paper context';
  s.additionalPublications[0].officeComments='PRIVATE SECOND PAPER COMMENT';s.additionalPublications[0].moreInformation='Second paper context';
  assert.deepEqual(validateSubmission(s),{});
  const internal=JSON.stringify(workbookSheets([s])),publicCopy=JSON.stringify(workbookSheets([s],{publicationOnly:true}));
  for(const note of [s.details.officeComments,s.additionalPublications[0].officeComments]){
    assert.ok(internal.includes(note));assert.ok(!publicCopy.includes(note));
  }
  assert.ok(!publicCopy.includes('Comments to the office'));
  assert.ok(publicCopy.includes('First paper context'));assert.ok(publicCopy.includes('Second paper context'));
  assert.ok(!publicationDetailFields(true).some(([key])=>key==='officeComments'));
  assert.ok(publicationDetailFields(true).some(([key])=>key==='moreInformation'));
  const ctx=backend(),clean=ctx.validateRecord_(s);
  assert.equal(clean.details.officeComments,s.details.officeComments);
  assert.equal(clean.additionalPublications[0].moreInformation,'Second paper context');
  s.details.officeComments='x'.repeat(6000);s.additionalPublications[0].moreInformation='x'.repeat(6000);
  assert.deepEqual(validateSubmission(s),{});ctx.validateRecord_(s);
  s.additionalPublications[0].moreInformation+='x';
  assert.ok(validateSubmission(s)['additionalPublications.0.moreInformation']);
  assert.throws(()=>ctx.validateRecord_(s),/too long/);
});
