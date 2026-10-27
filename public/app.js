import { config } from './config.js';
import { categories, category, statuses, emptySubmission, emptyPublication, publicationEntries, publicationDetailFields, imagePublicationId, removePublication, maxPublications, maxSubmissionImageBytes, validateSubmission, releaseEligible, releaseLabel, safeUrl, escapeHtml as e, uid } from './model.js';
import { initialize, recoverBrowserPreview, listSubmissions, saveSubmission, loadImages, localImport, session, googleRequest, officeChallenge, unlockOffice, lockOffice, requestOfficePasswordChange, officeResetChallenge, completeOfficePasswordChange } from './storage.js';
import { isOffice, officeRoute } from './access.js';
import { createWorkbook, zipFiles, dataUrlBytes, download } from './exports.js';

const paths={
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M13 6l6 6-6 6',back:'M19 12H5 M11 6l-6 6 6 6',
  book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M13 7a3 3 0 0 1 3-3h5v15h-5a4 4 0 0 0-3 2',
  award:'M8 14l-2 7 6-3 6 3-2-7 M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  cap:'M2 9l10-6 10 6-10 6z M6 12v6c4 3 8 3 12 0v-6 M22 9v8',
  star:'m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3 9.7l6.3-.9z',
  mic:'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v1a7 7 0 0 0 14 0v-1 M12 18v4 M8 22h8',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.9',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  calendar:'M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16',
  spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5',
  archive:'M3 3h18v5H3z M5 8v13h14V8 M9 12h6',
  settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 2h6l1 3 3 1 3 4-2 3v4l-4 3-3-1-4 1-3-4 1-4-2-3 3-4 3-1z',
  search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6',
  download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  upload:'M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5',
  check:'M5 12l4 4L19 6',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  image:'M3 3h18v18H3z M3 16l6-6 5 5 3-3 4 4 M16 7h.01',
  close:'M6 6l12 12 M6 18 18 6',chevron:'m9 5 7 7-7 7',filter:'M4 7h16 M7 12h10 M10 17h4',
  info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01',
  shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  edit:'m16 3 5 5-12 12-6 1 1-6z M13 6l5 5', menu:'M3 6h18 M3 12h18 M3 18h18',
};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const state={records:[],route:'home',search:'',filterCategory:'all',filterStatus:'all',tab:'all',selected:new Set(),form:null,step:0,errors:{},showSamples:localStorage.getItem('newsroom-show-samples')!=='false',busy:false,dirty:false,detailId:null,saveTimer:null,saveQueue:Promise.resolve(),saveFailed:false};
const app=document.querySelector('#app'), dialog=document.querySelector('#dialog');
const date=(value,opts={month:'short',day:'numeric',year:'numeric'})=>value?new Date(value.length===10?value+'T12:00:00':value).toLocaleDateString('en-US',opts):'—';
const formatBytes=n=>n<1048576?`${Math.round(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
const isEditor=()=>isOffice(session);
let accessVersion=0;
let officeTimer;
function requireOffice(){if(!isEditor()||Date.now()>=session.officeExpiresAt)throw new Error('Office access is locked. Enter the password again.');}
const visibleRecords=()=>state.records.filter(r=>state.showSamples || !r.sample);
function toast(message,error=false){const el=document.querySelector('#toast');el.textContent=message;el.className=`show ${error?'error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',5000);}
function errorMessage(err){return err?.name==='QuotaExceededError'?'This browser’s storage is full. Download a backup and use smaller images. Nothing was submitted.':err?.name==='AbortError'?'The request timed out. Your form is still here. Retry to confirm whether it was saved.':err.message || 'Something went wrong. Please try again.';}
function badge(status){return `<span class="status ${status.toLowerCase().replaceAll(' ','-')}"><span></span>${e(status)}</span>`;}
function routeTo(route){location.hash=route;}
function formProgress(){return ['News type','Story details','Images & release','Review & submit'];}
function home(){
  state.route='home';
  shell('<a class="home-submit" href="#submit">Submit news</a>');
  window.scrollTo(0,0);
}
function shell(content){
  const active=state.route==='detail'?'dashboard':state.route;
  const navigation=isEditor()?[['dashboard','Office inbox'],['submit','Submit news'],['drafts','Drafts'],['archive','Archive'],['settings','Settings']]:[['submit','Submit news'],['drafts','My drafts'],['office','Office access']];
  app.innerHTML=`<div class="workspace"><header class="site-header"><div class="header-title"><a class="brand" href="#${isEditor()?'dashboard':'home'}">Chemistry news</a><span class="department">${e(config.department)}</span><span class="mode-label">${isEditor()?'Office workspace':'Department news portal'}</span></div><nav aria-label="Main navigation">${navigation.map(([route,label])=>`<a href="#${route}" class="nav-link ${active===route?'active':''}" ${active===route?'aria-current="page"':''}>${label}${route==='drafts'?` <span>(${visibleRecords().filter(r=>r.status==='Draft').length})</span>`:''}</a>`).join('')}${isEditor()||session.token?`<button data-action="sign-out" class="text-button">${isEditor()?'Lock office':'Sign out'}</button>`:''}<button data-action="help" class="help-link">Help</button></nav></header><main id="main" class="${state.route==='home'?'home-page':''}" tabindex="-1">${content}</main><footer class="footer">${config.mode==='local'?'Local preview — saved in this browser.':config.mode==='server'?'Local preview · Private departmental submissions.':'Private departmental submissions.'} AI generate tool.</footer></div>`;
}
function filteredRecords(){
  return visibleRecords().filter(r=>state.route==='drafts'?r.status==='Draft':state.route==='archive'?r.status==='Archived':r.status!=='Archived' && r.status!=='Draft')
    .filter(r=>state.tab!=='review' || ['Submitted','In review','Changes requested'].includes(r.status))
    .filter(r=>state.tab!=='approved'||r.status==='Approved')
    .filter(r=>state.filterCategory==='all'||r.category===state.filterCategory)
    .filter(r=>state.filterStatus==='all'||r.status===state.filterStatus)
    .filter(r=>[r.headline,r.summary,r.group,r.submitter,r.reference,category(r.category).name,...publicationEntries(r).flatMap(p=>[p.paperTitle,p.authors,p.venue,p.doi])].join(' ').toLowerCase().includes(state.search.toLowerCase()))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function dashboard(){
  const records=visibleRecords(), main=state.route==='dashboard';
  if(!isEditor()&&state.route==='drafts'&&!records.some(r=>r.status==='Draft')){routeTo('home');return;}
  const review=records.filter(r=>['Submitted','In review','Changes requested'].includes(r.status)).length;
  const title=state.route==='drafts'?(isEditor()?'Drafts':'My drafts'):state.route==='archive'?'Archive':'Office inbox';
  shell(`<div class="page-heading"><div><h1>${title}</h1><p>${state.route==='drafts'?'Continue editing a saved submission.':state.route==='archive'?'Previously reviewed submissions.':'Review submissions, manage images, and download Excel files.'}</p></div><div class="heading-actions">${isEditor()?'<button class="button secondary" data-action="refresh-inbox">Refresh</button>':''}<a class="button primary" href="#submit">Submit news</a></div></div>
  <section class="news-panel"><div class="panel-heading"><div><span id="record-count"></span></div>${isEditor()?`<button class="button secondary small" data-action="export">${icon('download')} Export <span class="desktop-word">Excel</span></button>`:''}</div>${main?`<div class="tabs" role="group" aria-label="Filter by review stage">${[['all','All submissions'],['review','Needs review'],['approved','Approved']].map(([key,label])=>`<button data-tab="${key}" class="tab ${state.tab===key?'selected':''}" aria-pressed="${state.tab===key}">${label}${key==='review'?`<span>${review}</span>`:''}</button>`).join('')}</div>`:''}<div class="table-toolbar"><label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Search submissions…" value="${e(state.search)}" aria-label="Search submissions"></label><div class="filters"><select id="category-filter" aria-label="Filter by category"><option value="all">All categories</option>${categories.map(c=>`<option value="${c.id}" ${state.filterCategory===c.id?'selected':''}>${c.short}</option>`).join('')}</select>${isEditor()?`<select id="status-filter" aria-label="Filter by status"><option value="all">All statuses</option>${statuses.map(s=>`<option ${state.filterStatus===s?'selected':''}>${s}</option>`).join('')}</select>`: ""}</div></div><div id="selection-bar"></div><div id="table-container"></div><div class="panel-footer"><span id="table-caption"></span></div></section>
  ${config.mode!=='google'&&isEditor()&&records.some(r=>r.sample)?`<p class="preview-note">Sample submissions are fictional. <a href="#settings">Show or hide sample data</a></p>`:''}`);
  renderTable();
}
function renderTable(){
  const rows=filteredRecords();
  document.querySelector('#record-count').textContent=`${rows.length} ${rows.length===1?'submission':'submissions'}`;
  document.querySelector('#table-caption').textContent=`Showing ${rows.length} ${rows.length===1?'submission':'submissions'}`;
  document.querySelector('#selection-bar').innerHTML=isEditor()&&state.selected.size?`<div class="selection-bar">${state.selected.size} selected <button data-action="clear-selection" class="text-button">Clear selection</button><button data-action="export" class="text-button">Export selected ${icon('download')}</button></div>`:'';
  document.querySelector('#table-container').innerHTML=rows.length?`<div class="table-scroll"><table class="news-table ${isEditor()?'':'contributor-table'}"><thead><tr><th class="check-col"><input type="checkbox" id="select-all" aria-label="Select all visible submissions" ${rows.every(r=>state.selected.has(r.id))?'checked':''}></th><th>News item</th><th>Research group</th><th>Submitted</th><th>Status</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>${rows.map(r=>`<tr><td class="check-col"><input type="checkbox" data-select="${r.id}" aria-label="Select ${e(r.headline||'Untitled draft')}" ${state.selected.has(r.id)?'checked':''}></td><td class="story-cell"><a class="story-link" href="#${r.status==='Draft'?'edit':'story'}/${r.id}"><div><strong>${e(r.headline||'Untitled draft')}</strong><div class="story-meta">${r.category==='publication'&&publicationEntries(r).length>1?`${publicationEntries(r).length} publications`:e(category(r.category).short)}${r.images?.length?`<span>·</span>${icon('image')}${r.images.length}`:''}${r.sample?'<span>·</span><span class="sample-label">Sample</span>':''}${releaseLabel(r)!=='Ready for consideration'?`<span>·</span><span class="hold-label">${e(releaseLabel(r))}</span>`:''}</div></div></a></td><td class="group-cell"><span>${e(r.group||'Not yet added')}</span><small>${e(r.submitter||'Draft contributor')}</small></td><td class="date-cell">${date(r.createdAt,{month:'short',day:'numeric'})}<small>${new Date(r.createdAt).getFullYear()}</small></td><td>${badge(r.status)}</td><td><a class="row-open" href="#${r.status==='Draft'?'edit':'story'}/${r.id}" aria-label="Open ${e(r.headline||'draft')}">${icon('chevron')}</a></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><span>${icon('file')}</span><h3>${state.search||state.filterCategory!=='all'||state.filterStatus!=='all'?'No matching submissions':'No submissions yet'}</h3><p>${state.search||state.filterCategory!=='all'||state.filterStatus!=='all'?'Try a different search or clear your filters.':'Use Submit news to add an item.'}</p><button class="button secondary" data-action="${state.search||state.filterCategory!=='all'||state.filterStatus!=='all'?'reset-filters':'new'}">${state.search||state.filterCategory!=='all'||state.filterStatus!=='all'?'Clear filters':'Submit news'}</button></div>`;
}
function field(key,label,{value='',type='text',required=false,help='',options=[],wide=false,placeholder='',disabled=false}={}){
  const error=state.errors[key],id='field-'+key.replaceAll('.','-');
  const attrs=`id="${id}" name="${key}" ${required?'required':''} ${disabled?'disabled':''} ${error?`aria-invalid="true" aria-describedby="${id}-error"`:help?`aria-describedby="${id}-help"`:''}`;
  return `<div class="field ${wide?'wide':''}"><label for="${id}">${e(label)}${required?'<span class="required">*</span>':' <span class="optional">Optional</span>'}</label>${type==='textarea'?`<textarea ${attrs} rows="${key==='summary'?5:4}" maxlength="${key.endsWith('.abstract')?20000:6000}" placeholder="${e(placeholder)}">${e(value)}</textarea>`:type==='select'?`<select ${attrs}>${options.map(v=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(v)}</option>`).join('')}</select>`:`<input ${attrs} type="${type}" value="${e(value)}" ${type==='number'?'min="0" step="any"':''} ${key==='headline'?'maxlength="180"':''} placeholder="${e(placeholder)}">`}${error?`<span id="${id}-error" class="field-error">${e(error)}</span>`:help?`<small id="${id}-help">${e(help)}</small>`:''}</div>`;
}
function publicationFields(s){
  const papers=publicationEntries(s);
  return `<div class="publication-list">${papers.map((paper,index)=>{
    const prefix=index===0?'details':`additionalPublications.${index-1}`;
    return `<fieldset class="publication-fields"><legend>Publication ${index+1}</legend>${index?`<button type="button" class="text-button remove-publication" data-remove-publication="${e(paper.id)}" aria-label="Remove publication ${index+1}">Remove</button>`:''}<div class="fields">${category('publication').fields.map(([key,label,required,type='text',options])=>field(`${prefix}.${key}`,label,{value:paper[key]||'',required,type,options:options?['',...options]:[],wide:type==='textarea'||['paperTitle','authors'].includes(key),help:key==='officeComments'?'Private comments for the department office. Excluded from publication exports.':key==='moreInformation'?'Additional context, links, or details that may be used in the news item.':'',placeholder:key==='officeComments'?'Anything the office should know about this publication?':key==='moreInformation'?'Add any other information about this paper.':''})).join('')}${field(`${prefix}.publicationDate`,'Publication date',{value:paper.publicationDate||'',type:'date',help:'The date for this paper, if known.'})}</div></fieldset>`;
  }).join('')}</div>${state.errors.publications?`<p class="field-error">${e(state.errors.publications)}</p>`:''}<div class="publication-actions"><button type="button" class="button secondary" data-action="add-publication" ${papers.length>=maxPublications?'disabled':''}>Add another publication</button><span class="muted">${papers.length} of ${maxPublications} publications</span></div>${state.removedPublication?`<p class="inline-note" role="status">Publication removed with its images. <button type="button" class="text-button" data-action="undo-publication">Undo</button></p>`:''}`;
}
function imageFields(s){
  const groups=s.category==='publication'?publicationEntries(s):[{id:'primary'}];
  return `<input type="file" id="image-input" accept="image/jpeg,image/png,image/webp" multiple hidden><div id="upload-status" role="status"></div>${state.errors.images?`<p class="field-error">${e(state.errors.images)}</p>`:''}${groups.map((paper,index)=>`<section class="publication-images" aria-label="${s.category==='publication'?`Images for publication ${index+1}`:'Images'}">${s.category==='publication'?`<h3>Publication ${index+1}: ${e(paper.paperTitle||'Untitled publication')}</h3>`:''}<div class="dropzone" data-upload-publication="${e(paper.id)}" tabindex="0" role="button" aria-label="${s.category==='publication'?`Choose images for publication ${index+1}`:'Choose images to upload'}"><strong>Drop images here, or <span>browse files</span></strong><p>JPG, PNG, or WebP · up to 3 images</p></div><div class="image-list">${s.images.map((img,i)=>({img,i})).filter(({img})=>s.category!=='publication'||imagePublicationId(img)===paper.id).map(({img,i})=>`<div class="image-card"><div class="image-top"><img src="${img.dataUrl}" alt="${e(img.alt||'Uploaded image preview')}"><div><strong>${e(img.name)}</strong><small>${formatBytes(img.size)}</small></div><button type="button" class="icon-button" data-remove-image="${i}" aria-label="Remove ${e(img.name)}">${icon('close')}</button></div><div class="fields">${field(`image.${i}.caption`,'Caption',{value:img.caption,required:true,wide:true,placeholder:'Who or what is pictured?'})}${field(`image.${i}.credit`,'Photo / figure credit',{value:img.credit,required:true})}${field(`image.${i}.alt`,'Alternative text',{value:img.alt,required:true})}${field(`image.${i}.rights`,'Permission to use',{value:img.rights,type:'select',options:['cleared','pending'],required:true,help:'Choose “pending” if permission still needs to be confirmed.'})}</div></div>`).join('')}</div></section>`).join('')}`;
}
function imagePreview(images){return images.length?`<div class="story-images">${images.map(i=>`<figure><img src="${i.dataUrl||''}" alt="${e(i.alt)}"><figcaption>${e(i.caption)}<small>Credit: ${e(i.credit)}</small></figcaption></figure>`).join('')}</div>`:'';}
function publicationPreview(s){
  return publicationEntries(s).map((paper,index)=>`<section class="detail-section"><h3>Publication ${index+1}: ${e(paper.paperTitle||'Untitled publication')}</h3><dl class="detail-fields">${[...category('publication').fields,['publicationDate','Publication date']].filter(([key])=>key!=='paperTitle'&&paper[key]).map(([key,label])=>`<div class="${['abstract','officeComments','moreInformation'].includes(key)?'full':''}"><dt>${e(label)}${key==='officeComments'?' (private)':''}</dt><dd>${e(paper[key])}</dd></div>`).join('')}</dl>${imagePreview(s.images.filter(i=>imagePublicationId(i)===paper.id))}</section>`).join('');
}
function renderForm(){
  const s=state.form;if(!s)return;
  const cat=category(s.category);
  let content='';
  if(state.step===0)content=`<div class="section-intro"><h2>Category and your details</h2><p>Send news to the department office for private review.</p></div><div class="field"><label for="news-category">News category <span class="required">*</span></label><select id="news-category" name="category" required>${categories.map(c=>`<option value="${c.id}" ${s.category===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select></div><div class="section-divider"></div><h3>Your details</h3><p class="muted">Students, faculty, and staff can submit news.</p><div class="fields">${field('submitter','Your name',{value:s.submitter,required:true,placeholder:'First and last name'})}${field('group','Research group',{value:s.group,required:true,placeholder:'Your research group or laboratory'})}</div>`;
  if(state.step===1)content=`<div class="section-intro"><h2>News details</h2>${s.category==='publication'?'<p>Add one or more publications below. The headline, summary, your details, and release preferences apply to the whole submission.</p>':''}</div><div class="fields">${field('headline','Proposed headline',{value:s.headline,required:true,wide:true,placeholder:'A short, descriptive title for your news',help:'Up to 180 characters. The editor can help refine it.'})}${field('summary','News summary',{value:s.summary,required:true,wide:true,type:'textarea',placeholder:'What happened, who was involved, and why does it matter?',help:'Aim for 50–150 words, in language a general audience can understand.'})}${field('newsDate','News date',{value:s.newsDate,required:true,type:'date'})}${field('link','Supporting link',{value:s.link,type:'url',placeholder:'https://…'})}</div><div class="section-divider"></div>${s.category==='publication'?publicationFields(s):`<h3>${e(cat.name)} details</h3><div class="fields">${cat.fields.map(([key,label,required,type='text',options])=>field(`details.${key}`,label,{value:s.details[key]||'',required,type,options:options?['',...options]:[],wide:type==='textarea'||['projectTitle','thesis','talkTitle','authors'].includes(key)})).join('')}</div>`}`;
  if(state.step===2)content=`<div class="section-intro"><h2>Images and release date</h2><p>Images are optional. Add up to 3 per ${s.category==='publication'?'publication':'submission'}, 10 MB each (30 MB total).</p></div>${imageFields(s)}<div class="section-divider"></div><h3>Release preferences</h3><p class="muted">The office reviews submissions privately. These preferences guide any later use of the news; submitting does not publish it.</p><div class="release-options">${[['ready','Ready for editorial consideration','The editor may prepare this story for publication.'],['embargo','Hold until a specific date','Keep this news private until the embargo ends.'],['contact','Contact me before release','Discuss the timing with me before sharing.']].map(([v,l,d])=>`<label class="radio-card ${s.release===v?'chosen':''}"><input type="radio" name="release" value="${v}" ${s.release===v?'checked':''}><div><strong>${l}</strong><span>${d}</span></div></label>`).join('')}</div><div class="fields">${s.release==='embargo'?field('embargo','Embargo ends',{value:toLocalTime(s.embargo),type:'datetime-local',required:true,wide:true,help:`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}):''}${field('notes','Private note to the editor',{value:s.notes,type:'textarea',wide:true,placeholder:'Anything the editor should know? This stays out of publication exports.'})}</div>`;
  if(state.step===3)content=`<div class="section-intro"><h2>Review your submission</h2><p>Check the details below, then submit.</p></div>${storyPreview(s)}<div class="review-meta"><span>${icon('people')}${e(s.submitter)} · ${e(s.group)}</span><span>${icon('calendar')}${date(s.newsDate)}</span><span>${icon('shield')}${e(releaseLabel(s))}</span></div><label class="confirm-check"><input name="permission" type="checkbox" ${s.permission?'checked':''}><span>I confirm that this information is accurate and that I have permission to provide this material for departmental communications.</span></label>${state.errors.permission?`<p class="field-error">${e(state.errors.permission)}</p>`:''}<div class="inline-note">${icon('info')}<span>${config.mode==='local'?'This preview saves on this device only. In the shared portal, submitted news is visible only to the office.':'Only authorized office staff can view your submission after you send it. Nothing is published automatically.'}</span></div>`;
  shell(`<div class="form-heading"><a class="back-link" href="#${isEditor()?'dashboard':'home'}">${icon('back')} ${isEditor()?'Back to office inbox':'Back to home'}</a><div class="page-heading"><div><h1>Submit news</h1><p>Required fields are marked with an asterisk (*).</p></div><div class="draft-indicator" id="save-status">${icon('check')}${s.reference?'Draft saved':'Not saved yet'}</div></div></div><div class="form-layout"><aside class="form-guide"><ol>${formProgress().map((label,i)=>`<li class="${i===state.step?'current':i<state.step?'complete':''}"><button type="button" data-step="${i}" ${i>state.step?'disabled':''}><span>${i<state.step?icon('check'):i+1}</span><div>${label}<small>${['Category and your details','Submission information','Attachments and restrictions','Check your submission'][i]}</small></div></button></li>`).join('')}</ol></aside><form id="news-form" novalidate class="form-card">${Object.keys(state.errors).length?'<div class="validation-summary" role="alert">A few details need your attention. Please check the marked fields below.</div>':''}${content}<div class="form-actions"><button type="button" class="text-button" data-action="save-draft">${icon('file')} Save draft</button><div>${state.step>0?`<button type="button" class="button secondary" data-action="previous">Back</button>`:''}<button type="submit" class="button primary" ${state.busy?'disabled':''}>${state.busy?'Saving…':state.step===3?'Submit news':'Continue'}${icon(state.step===3?'check':'arrow')}</button></div></div></form></div>`);
}
function toLocalTime(iso){if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);}
function storyPreview(s){return `<article class="story-preview"><div class="story-preview-top"><span class="category-tag">${e(category(s.category).name)}${s.category==='publication'&&publicationEntries(s).length>1?` · ${publicationEntries(s).length} papers`:''}</span>${s.sample?'<span class="sample-pill">Fictional sample</span>':''}</div><h2>${e(s.headline||'Your headline')}</h2><p class="summary-text">${e(s.summary||'Your story summary will appear here.')}</p>${s.category==='publication'?publicationPreview(s):imagePreview(s.images)}${s.link&&safeUrl(s.link)?`<a class="source-link" href="${e(safeUrl(s.link))}" target="_blank" rel="noopener noreferrer">View supporting source ${icon('arrow')}</a>`:''}</article>`;}

async function renderDetail(id){
  requireOffice();
  const access=accessVersion;
  let s=state.records.find(r=>r.id===id);if(!s){shell('<div class="empty-state"><h1>Story not found.</h1><a href="#dashboard">Return to news desk</a></div>');return;}
  if(s.images.some(i=>!i.dataUrl)){s=await loadImages(s);if(access!==accessVersion)return;state.records=state.records.map(r=>r.id===s.id?s:r);}
  state.detailId=id;
  shell(`<a class="back-link" href="#dashboard">${icon('back')} Back to submissions</a><div class="detail-header"><div><div class="eyebrow">${e(s.reference)}</div><h1>Review submission</h1></div><div class="heading-actions"><button class="button secondary" data-action="export-story">${icon('download')} Export</button><a class="button secondary" href="#edit/${s.id}">${icon('edit')} Edit story</a></div></div><div class="detail-layout"><div><div class="detail-main">${storyPreview(s)}</div>${s.category!=='publication'?`<section class="detail-section"><h3>${e(category(s.category).name)} details</h3><dl class="detail-fields">${category(s.category).fields.filter(([k])=>s.details[k]).map(([k,l])=>`<div class="${k==='abstract'?'full':''}"><dt>${e(l)}</dt><dd>${e(s.details[k])}</dd></div>`).join('')}</dl></section>`:''}${s.notes?`<section class="detail-section private-note"><h3>${icon('shield')} Private note to editor</h3><p>${e(s.notes)}</p></section>`:''}<section class="detail-section"><h3>Activity</h3><ol class="history">${[...s.history].reverse().map(h=>`<li><span class="history-dot"></span><div><strong>${e(h.status)}</strong><p>${e(h.actor)} · ${date(h.at)}${h.note?`<br>${e(h.note)}`:''}</p></div></li>`).join('')||'<li>No editorial changes yet.</li>'}</ol></section></div><aside class="review-sidebar"><section class="review-card"><div class="eyebrow">EDITORIAL STATUS</div>${badge(s.status)}<div class="release-notice">${icon('shield')}<span>${e(releaseLabel(s))}${s.release==='embargo'?`<small>${date(s.embargo)} · ${new Date(s.embargo).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small>`:''}</span></div>${isEditor()?`<label for="review-status">Move story to</label><select id="review-status">${statuses.filter(x=>x!=='Draft').map(x=>`<option ${x===s.status?'selected':''}>${x}</option>`).join('')}</select><label for="editor-note">Editor’s note <span class="optional">Optional</span></label><textarea id="editor-note" rows="4" placeholder="Add context or describe a requested change…">${e(s.editorNotes||'')}</textarea><label for="published-url">Publication link <span class="optional">Optional</span></label><input id="published-url" type="url" placeholder="https://…" value="${e(s.publishedUrl||'')}"><button class="button primary full-width" data-action="update-status">${icon('check')} Save review</button><p class="microcopy">Status updates are saved here. No emails are sent.</p>`:s.editorNotes?`<h3>Editor’s note</h3><p>${e(s.editorNotes)}</p>`:''}</section><section class="review-card contact-card"><div class="eyebrow">SUBMITTED BY</div><div class="contact-person"><div class="avatar light">${e(s.submitter.split(' ').filter(Boolean).map(x=>x[0]).slice(-2).join(''))}</div><div><strong>${e(s.submitter)}</strong><span>${e(s.group)}</span></div></div>${s.email?`<p class="contact-email">${e(s.email)}</p>`:''}<div class="contact-date">${icon('calendar')}News date: ${date(s.newsDate)}</div><div class="contact-date">${icon('clock')}Received: ${date(s.createdAt)}</div></section></aside></div>`);
}
function settings(){
  requireOffice();
  shell(`<div class="page-heading"><div><h1>Office settings</h1><p>Manage access and keep a private copy of your records.</p></div></div><div class="settings-grid">
    <section class="settings-card"><h2>Portal storage</h2><p>${['server','cloudflare'].includes(config.mode)?'Submissions and images are stored privately on the portal server. Review everything in the office inbox; Excel is an optional download. No Google account is required.':config.mode==='local'?'This older preview stores records in this browser. Download a backup before clearing browser data.':'Storage is managed by the configured backend.'}</p><div class="setting-row"><div><strong>Office access</strong><small>The office password protects submissions, images, and exports. Sessions expire after 30 minutes.</small></div><button class="text-button" data-action="change-office-password">Change password</button></div><div class="setting-row"><div><strong>Email delivery</strong><small>No submission or review emails are sent. Password recovery email is not connected.</small></div><span class="off-badge">Off</span></div></section>
    <section class="settings-card"><h2>Backup and restore</h2><p>Download all records and images as a private backup. Importing adds new records and leaves existing records unchanged.</p><div class="settings-buttons"><button class="button primary" data-action="backup">Download backup</button>${config.mode!=='google'?'<button class="button secondary" data-action="import">Import backup</button><input id="backup-input" type="file" accept=".json" hidden>':''}</div><p class="microcopy">Keep backups in a secure location. They include private office notes.</p>${config.mode==='server'?'<p class="microcopy"><button class="text-button" data-action="recover-preview">Import earlier browser preview records</button></p>':''}</section>
    ${state.records.some(r=>r.sample)?`<section class="settings-card"><h2>Sample records</h2><p>Fictional records from the earlier preview are labeled in the inbox and exports.</p><label class="toggle-row"><input type="checkbox" id="show-samples" ${state.showSamples?'checked':''}><span>Show sample records</span></label></section>`:''}
    <section class="settings-card"><h2>${config.mode==='cloudflare'?'Hosting':'Local preview'}</h2><p>${config.mode==='cloudflare'?'This portal uses Cloudflare Workers Free with private storage. The application accepts up to 1,000 records and 256 MB of stored content. If a service or storage limit is reached, new requests stop until capacity is available. No paid upgrade or automatic email is configured.':'This portal is running on this computer. Shared department access requires hosting the server at a department address. No external account, paid service, or billing integration is connected.'}</p></section>
  </div>`);
}

async function officeAccess(error=''){
  state.route='office';
  const access=accessVersion,route=location.hash;
  if(config.mode==='google'&&!session.officeEligible){shell(`<section class="success-card"><h1>Office access</h1><p>Only approved office accounts can unlock the inbox.</p><button class="button secondary" data-action="sign-out">Sign in with an office account</button><p><a href="#submit">Return to the submission form</a></p></section>`);return;}
  shell('<section class="success-card"><h1>Office access</h1><p>Loading…</p></section>');
  let challenge;
  try{challenge=await officeChallenge();}catch(err){error=errorMessage(err);}
  if(access!==accessVersion||route!==location.hash)return;
  const setup=challenge&&!challenge.configured;
  shell(`<section class="success-card office-login"><h1>${setup?'Set office password':'Office access'}</h1><p>${setup?'Create a password for the department office.':'Enter the office password to view submissions, images, and exports.'}</p>${error?`<p class="field-error" role="alert">${e(error)}</p>`:''}${challenge?`<form id="office-form" data-setup="${setup}"><div class="field"><label for="office-password">${setup?'New office password':'Office password'}</label><input id="office-password" type="password" name="officePassword" autocomplete="${setup?'new-password':'current-password'}" required maxlength="256" ${setup?'minlength="8"':''}></div>${setup?'<div class="field"><label for="office-confirm">Confirm password</label><input id="office-confirm" type="password" name="officeConfirm" autocomplete="new-password" minlength="8" maxlength="256" required></div><p class="microcopy">Use at least 8 characters. Keep this password somewhere safe.</p>':''}<button type="submit" class="button primary">${setup?'Set password and open inbox':'Unlock office'}</button></form>`:''}<p class="microcopy">Office access locks after 30 minutes, or when you choose Lock office.</p><button type="button" class="text-button" data-action="change-office-password">Change password</button><p class="microcopy"><a href="#submit">Return to the submission form</a></p></section>`);
}
function renderSignIn(){
  const office=officeRoute(location.hash.slice(1).split('/')[0])||location.hash==='#office'||location.hash.startsWith('#office-reset/');
  state.route=office?'office':'submit';
  shell(`<section class="success-card"><h1>${office?'Office sign-in':'Submit news privately'}</h1><p>${office?'Only authorized office accounts can open the inbox, submitted records, images, and exports.':'Sign in to send news to the department office. Other contributors cannot see your submissions.'}</p><div id="google-signin"></div><p class="microcopy">The portal does not publish submissions or send emails.</p></section>`);
  if(window.google?.accounts?.id)google.accounts.id.renderButton(document.querySelector('#google-signin'),{theme:'outline',size:'large'});
}
function passwordChangeDialog(){
  openDialog('Change office password',config.mode==='google'?`<p>A one-use password-change link will be sent to the configured administrator. The current password stays active until the link is used.</p><button class="button primary" data-action="request-password-change">Send password-change email</button>`:`<p>Password recovery email is not configured for this portal. Contact the portal administrator to arrange a password change.</p><p>The current password remains active. No email has been sent.</p><button class="button secondary" data-action="close-dialog">Close</button>`);
}

async function renderPasswordReset(resetToken){
  state.route='office';
  shell('<section class="success-card"><h1>Change office password</h1><p>Checking your link…</p></section>');
  try{
    await officeResetChallenge(resetToken);
    shell(`<section class="success-card office-login"><h1>Change office password</h1><p>Set the new office password. Existing office sessions will be locked.</p><form id="office-reset-form"><div class="field"><label for="new-office-password">New office password</label><input id="new-office-password" name="officePassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></div><div class="field"><label for="confirm-office-password">Confirm password</label><input id="confirm-office-password" name="officeConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></div><p class="microcopy">Use at least 8 characters.</p><button class="button primary" type="submit">Save new password</button></form></section>`);
  }catch(err){shell(`<section class="success-card"><h1>Password change unavailable</h1><p role="alert">${e(errorMessage(err))}</p><a href="#office">Return to office access</a></section>`);}
}
async function submitPasswordReset(form){
  let password=form.elements.officePassword.value;
  if(password.length<8||password!==form.elements.officeConfirm.value){toast('Use at least 8 characters and make sure both passwords match.',true);return;}
  const button=form.querySelector('button');button.disabled=true;
  try{
    await completeOfficePasswordChange(location.hash.split('/')[1]||'',password);
    resetWorkspace();session.role='contributor';session.officeToken='';session.officeExpiresAt=0;clearTimeout(officeTimer);
    localStorage.setItem('newsroom-office-locked',crypto.randomUUID());
    history.replaceState(null,'','#office');await officeAccess();toast('Password changed. Unlock the office with your new password.');
  }catch(err){toast(errorMessage(err),true);}
  finally{password='';form.reset();button.disabled=false;}
}
function resetWorkspace(){
  accessVersion++;clearTimeout(state.saveTimer);
  state.records=[];state.form=null;state.removedPublication=null;state.exportRecords=[];state.selected.clear();state.detailId=null;state.dirty=false;dialog.close();
}
async function clearWorkspace(){
  if(state.busy)throw new Error('Please wait for the current save to finish.');
  if(state.dirty&&state.form?.status!=='Draft')throw new Error('Finish submitting your changes before leaving this view.');
  if(state.dirty)await persistDraft(false);
  clearTimeout(state.saveTimer);await state.saveQueue.catch(()=>{});
  resetWorkspace();
}
function scheduleOfficeLock(){
  clearTimeout(officeTimer);
  if(isEditor())officeTimer=setTimeout(()=>forceOfficeLock(),Math.max(0,session.officeExpiresAt-Date.now()));
}
async function forceOfficeLock(){
  clearTimeout(officeTimer);resetWorkspace();session.role='contributor';
  shell('<section class="success-card"><h1>Office locked</h1><p>Enter the password again to continue.</p></section>');
  try{await lockOffice();}catch{}
  if(config.mode==='google'&&!session.token)renderSignIn();else await officeAccess();
}
async function submitOffice(form){
  let password=form.elements.officePassword.value;
  const setup=form.dataset.setup==='true';
  if(setup&&(password.length<8||password!==form.elements.officeConfirm.value)){toast('Use at least 8 characters and make sure both passwords match.',true);return;}
  const button=form.querySelector('button');button.disabled=true;button.textContent='Checking…';
  try{
    await clearWorkspace();await unlockOffice(password,setup);
    if(config.mode==='server'&&!localStorage.getItem('newsroom-server-migrated')){
      try{const count=await recoverBrowserPreview();localStorage.setItem('newsroom-server-migrated','1');if(count)toast(`${count} earlier preview records moved into portal storage. The browser backup was kept.`);}catch(err){toast(`Earlier preview records remain in this browser: ${errorMessage(err)}`,true);}
    }
    state.records=await listSubmissions();scheduleOfficeLock();
    if(location.hash==='#dashboard')await renderRoute();else routeTo('dashboard');
  }catch(err){if(isEditor()){try{await lockOffice();}catch{}}await officeAccess(errorMessage(err));}
  finally{password='';form.reset();button.disabled=false;}
}
async function signOut(){
  await clearWorkspace();clearTimeout(officeTimer);
  if(isEditor()){
    session.role='contributor';shell('<section class="success-card"><h1>Office locked</h1><p>Closing office access…</p></section>');
    try{await lockOffice();}finally{if(location.hash==='#office')await officeAccess();else routeTo('office');}
    return;
  }
  Object.assign(session,{token:'',role:'contributor',sub:'',email:'',name:'',expiresAt:0,officeToken:'',officeExpiresAt:0,officeEligible:false});renderSignIn();
}
async function renderRoute(){
  const access=accessVersion;
  const hash=location.hash.slice(1)||'home';
  const [route,id]=hash.split('/');state.selected.clear();state.search='';state.filterCategory='all';state.filterStatus='all';state.tab='all';
  if(route==='home'){home();return;}
  if(config.mode==='google'&&!session.token){renderSignIn();return;}
  if(route==='office-reset'){await renderPasswordReset(id);return;}
  if(isEditor()&&Date.now()>=session.officeExpiresAt){await forceOfficeLock();return;}
  if(route==='office'){if(isEditor()){routeTo('dashboard');return;}await officeAccess();window.scrollTo(0,0);return;}
  if(officeRoute(route)&&!isEditor()){state.route='office';await officeAccess();window.scrollTo(0,0);return;}
  if(['submit','edit'].includes(route)){
    if(route==='edit'){
      const existing=state.records.find(r=>r.id===id);if(!existing){if(!isEditor()){await officeAccess();return;}toast('That record is not available.',true);routeTo('dashboard');return;}
      if(state.form?.id!==id){const loaded=await loadImages(existing);if(access!==accessVersion)return;state.removedPublication=null;state.form=structuredClone(loaded);}
    }else if(!state.form || state.form.status!=='Draft'){state.form=emptySubmission();state.removedPublication=null;}
    if(config.mode==='google'){state.form.email=session.email;state.form.submitter ||= session.name;}
    state.route='submit';state.step=0;state.errors={};renderForm();
  }else if(route==='story'){state.route='detail';await renderDetail(id);}
  else if(['dashboard','drafts','archive','settings'].includes(route)){if(['server','cloudflare'].includes(config.mode)){const rows=await listSubmissions();if(access!==accessVersion||location.hash.slice(1)!==hash)return;state.records=rows;}state.route=route;state.route==='settings'?settings():dashboard();}
  else {routeTo('home');return;}
  window.scrollTo({top:0});
}
function getFormValue(name,value){
  if(name.startsWith('additionalPublications.')){const [,index,key]=name.split('.');state.form.additionalPublications[Number(index)][key]=value;}
  else if(name.startsWith('details.'))state.form.details[name.split('.')[1]]=value;
  else if(name.startsWith('image.')){const [,index,key]=name.split('.');state.form.images[Number(index)][key]=value;}
  else if(name==='embargo')state.form.embargo=value?new Date(value).toISOString():'';
  else state.form[name]=value;
  state.dirty=true;
}
function scheduleSave(){clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>persistDraft(false).catch(err=>toast(errorMessage(err),true)),1400);const label=document.querySelector('#save-status');if(label)label.innerHTML=`${icon('clock')} Unsaved changes`;}
function persistDraft(notify=true){
  clearTimeout(state.saveTimer);if(!state.form)return Promise.resolve();
  if(state.form.status!=='Draft'){
    const label=document.querySelector('#save-status');if(label)label.innerHTML=`${icon('edit')} Changes saved when resubmitted`;
    if(notify)toast('Use Review & submit to save changes to a submitted story.');return Promise.resolve();
  }
  state.form.reference ||= `CN-${new Date().getFullYear()}-${state.form.id.slice(0,6).toUpperCase()}`;
  state.form.updatedAt=new Date().toISOString();const snapshot=structuredClone(state.form);
  const task=state.saveQueue.catch(()=>{}).then(async()=>{
    snapshot.version=state.records.find(r=>r.id===snapshot.id)?.version;
    const saved=await saveSubmission(snapshot);state.records=state.records.filter(r=>r.id!==saved.id).concat(saved);
    if(state.form?.id===saved.id && state.form.updatedAt===snapshot.updatedAt){state.dirty=false;state.form.version=saved.version;state.form.reference=saved.reference;}
    state.saveFailed=false;const label=document.querySelector('#save-status');if(label && !state.dirty)label.innerHTML=`${icon('check')} Draft saved`;
    if(notify)toast('Draft saved. Return using this browser to continue.');
  }).catch(err=>{state.saveFailed=true;const label=document.querySelector('#save-status');if(label)label.textContent='Not saved — please retry';throw err;});
  state.saveQueue=task;return task;
}
async function advance(){
  if(state.busy)return;
  state.errors=validateSubmission(state.form,state.step);
  if(Object.keys(state.errors).length){renderForm();document.querySelector('[aria-invalid="true"]')?.focus();return;}
  if(state.step<3){if(state.form.status==='Draft')await persistDraft(false);state.step++;state.errors={};renderForm();window.scrollTo({top:0,behavior:'smooth'});return;}
  state.errors=validateSubmission(state.form);
  if(Object.keys(state.errors).length){state.step=Object.keys(state.errors).some(k=>['submitter','group'].includes(k))?0:Object.keys(state.errors).some(k=>['headline','summary','newsDate','link'].includes(k)||k.startsWith('details.')||k.startsWith('additionalPublications.')||k==='publications')?1:2;renderForm();return;}
  state.busy=true;renderForm();clearTimeout(state.saveTimer);
  try{
    await state.saveQueue.catch(()=>{});
    const row=structuredClone(state.form);const now=new Date().toISOString();
    row.reference ||= `CN-${new Date().getFullYear()}-${row.id.slice(0,6).toUpperCase()}`;
    if(row.status!=='Draft' && !row.original){const previous=state.records.find(r=>r.id===row.id);row.original={headline:previous.headline,summary:previous.summary,details:structuredClone(previous.details),additionalPublications:structuredClone(previous.additionalPublications||[])};}
    row.status='Submitted';row.updatedAt=now;row.history.push({status:'Submitted',at:now,actor:row.submitter,note:state.form.status==='Draft'?'Submitted for editorial review.':'Updated story submitted for renewed review.'});
    row.version=state.records.find(r=>r.id===row.id)?.version;
    const saved=await saveSubmission(row);state.records=state.records.filter(r=>r.id!==saved.id).concat(isEditor()?[saved]:[]);state.dirty=false;state.form=null;state.busy=false;state.route='success';
    shell(`<section class="success-card"><div class="success-mark">${icon('check')}</div><h1>Submission received</h1>${row.category==='publication'&&publicationEntries(row).length>1?`<p>${publicationEntries(row).length} publications submitted together.</p>`:''}<p>${config.mode==='local'?'Saved locally for the office preview. This has not been sent to the department.':config.mode==='server'?'Your submission is saved in this portal’s private office inbox.':'Your submission has been sent privately to the department office.'}</p><div class="success-reference"><span>SUBMISSION REFERENCE</span><strong>${e(saved.reference)}</strong></div><h3>${e(row.headline)}</h3><p>Submitted news and images are available only to the office. Nothing is published automatically.</p><p class="microcopy">No email was sent. Keep your reference number for your records.</p><div class="success-actions">${isEditor()?`<a class="button primary" href="#story/${saved.id}">View submission ${icon('arrow')}</a>`:''}<button class="button secondary" data-action="new">Submit another story</button></div></section>`);window.scrollTo(0,0);
  }catch(err){state.busy=false;renderForm();throw err;}
}
async function addImages(files,publicationId='primary'){
  if(state.busy)return;state.busy=true;clearTimeout(state.saveTimer);
  const messages=[];try{
    for(const file of files){
      if(state.form.images.filter(i=>state.form.category!=='publication'||imagePublicationId(i)===publicationId).length>=config.maxImages){messages.push('You can add up to three images per publication or news item.');break;}
      if(state.form.images.reduce((total,i)=>total+i.size,0)+file.size>maxSubmissionImageBytes){messages.push('Keep all images in one submission within 30 MB.');continue;}
      if(file.size>config.maxImageBytes){messages.push(`${file.name} is larger than 10 MB.`);continue;}
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)){messages.push(`${file.name}: use JPG, PNG, or WebP.`);continue;}
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!validImageBytes(bytes,file.type)){messages.push(`${file.name} is not a valid supported image.`);continue;}
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
      const bitmap=await createImageBitmap(file);bitmap.close();
      state.form.images.push({id:uid(),...(state.form.category==='publication'?{publicationId}:{}),name:file.name,type:file.type,size:file.size,dataUrl,caption:'',credit:'',alt:'',rights:'cleared'});state.dirty=true;
    }
  }finally{state.busy=false;renderForm();scheduleSave();}
  if(messages.length)toast(messages.join(' '),true);else toast('Image added. Add a caption, credit, and alternative text.');
}
function validImageBytes(b,type){return type==='image/png'?b.length>8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v):type==='image/jpeg'?b.length>3&&b[0]===255&&b[1]===216&&b[2]===255:type==='image/webp'?b.length>12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP':false;}
function openDialog(title,body){dialog.innerHTML=`<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button data-action="close-dialog" class="icon-button" aria-label="Close dialog">${icon('close')}</button></div>${body}`;dialog.showModal();}
function exportDialog(records){
  requireOffice();
  state.exportRecords=records;
  openDialog('Export submissions',`<p class="muted">Export ${records.length} ${records.length===1?'selected story':'stories'}. Choose the material you need.</p><label class="radio-card chosen"><input type="radio" name="export-scope" value="internal" checked><div><strong>Internal review</strong><span>All selected records, including private notes and contact details.</span></div></label><label class="radio-card"><input type="radio" name="export-scope" value="publication"><div><strong>Approved editorial copy</strong><span>Private office download of approved, release-eligible news. Excludes notes and contacts. Does not publish anything.</span></div></label><div class="export-options"><button class="export-option" data-action="download-excel">${icon('file')}<div><strong>Excel workbook</strong><span>Formatted .xlsx with category and media sheets</span></div>${icon('download')}</button><button class="export-option" data-action="download-package">${icon('image')}<div><strong>Stories + media package</strong><span>Workbook, images, credits, and a readable digest</span></div>${icon('download')}</button></div><p class="microcopy">Exports are snapshots. Changes in Excel do not update this workspace.</p>`);
}
async function performExport(bundle=false){
  requireOffice();
  const access=accessVersion;
  const publicationOnly=dialog.querySelector('input[name="export-scope"]:checked').value==='publication';
  let records=state.exportRecords.filter(r=>!publicationOnly||releaseEligible(r));if(!records.length){toast('No approved, release-eligible stories in this selection.',true);return;}
  const trigger=dialog.querySelector(`[data-action="${bundle?'download-package':'download-excel'}"]`);trigger.disabled=true;
  try {
    const xlsx=createWorkbook(records,{publicationOnly});const prefix=`chemistry-news-${new Date().toISOString().slice(0,10)}`;
    if(!bundle)download(xlsx,`${prefix}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else{
      const files={'news.xlsx':xlsx};const digest=[];
      for(let r of records){r=await loadImages(r);if(access!==accessVersion)return;const base=r.reference.replace(/[^a-zA-Z0-9_-]/g,'_');
        const figures=[];
        for(const img of r.images){const name=`${base}/${img.id}.${({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[img.type]}`;files[name]=dataUrlBytes(img.dataUrl);figures.push(`<figure>${r.category==='publication'?`<p>Publication ${publicationEntries(r).findIndex(p=>p.id===imagePublicationId(img))+1}</p>`:''}<img src="${e(name)}" alt="${e(img.alt)}"><figcaption>${e(img.caption)} — ${e(img.credit)}</figcaption></figure>`);}
        digest.push(`<article><p>${e(r.reference)} · ${e(category(r.category).name)}${r.sample?' · FICTIONAL SAMPLE':''}</p><h2>${e(r.headline)}</h2><p class="summary">${e(r.summary)}</p>${r.category==='publication'?publicationEntries(r).map((paper,index)=>`<section><h3>Publication ${index+1}: ${e(paper.paperTitle)}</h3>${[...publicationDetailFields(publicationOnly),['publicationDate','Publication date']].filter(([key])=>key!=='paperTitle'&&paper[key]).map(([key,label])=>`<p><strong>${e(label)}:</strong> ${e(paper[key])}</p>`).join('')}</section>`).join(''):''}${figures.join('')}</article>`);
      }
      files['stories.html']=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chemistry Newsroom — story package</title><style>body{max-width:860px;margin:50px auto;padding:0 24px;font:17px/1.65 system-ui;color:#20362e}article{border-top:1px solid #ccc;margin-top:32px;padding-top:20px}h1,h2{font-family:Georgia,serif}.summary{white-space:pre-wrap}img{max-width:100%;max-height:440px}figcaption{font-size:14px}</style><h1>Chemistry Newsroom</h1><p>${publicationOnly?'Publication copy':'INTERNAL REVIEW — contains unapproved or held material. Check release instructions in the workbook.'}</p>${digest.join('')}</html>`;
      download(zipFiles(files),`${prefix}-media.zip`,'application/zip');
    }
    toast(`${records.length} ${records.length===1?'story':'stories'} exported.`);dialog.close();
  }finally{trigger.disabled=false;}
}
async function updateStatus(){
  requireOffice();
  const access=accessVersion;
  const old=state.records.find(r=>r.id===state.detailId);const status=document.querySelector('#review-status').value,note=document.querySelector('#editor-note').value.trim(),publishedUrl=document.querySelector('#published-url').value.trim();
  if(status==='Changes requested'&&!note)throw new Error('Add an editor’s note describing the requested changes.');
  if(publishedUrl&&!safeUrl(publishedUrl))throw new Error('Enter a valid http:// or https:// publication link.');
  if(status==='Published'&&!releaseEligible({...old,status:'Approved'}))throw new Error('Resolve the release hold and image permissions before marking this story published.');
  const next={...old,status,editorNotes:note,publishedUrl,updatedAt:new Date().toISOString(),publishedAt:status==='Published'?(old.publishedAt||new Date().toISOString()):old.publishedAt,history:[...old.history,{status,at:new Date().toISOString(),actor:session.name,note}]};
  const button=document.querySelector('[data-action="update-status"]');button.disabled=true;
  try{const saved=await saveSubmission(next);if(access!==accessVersion)return;state.records=state.records.map(r=>r.id===saved.id?saved:r);await renderDetail(saved.id);toast('Review saved. No email was sent.');}finally{button.disabled=false;}
}
async function backup(){
  requireOffice();
  const access=accessVersion,data=[];for(const record of state.records){data.push(await loadImages(record));if(access!==accessVersion)return;}
  download(JSON.stringify({format:'chemistry-newsroom',version:1,exportedAt:new Date().toISOString(),records:data},null,2),`chemistry-newsroom-${new Date().toISOString().slice(0,10)}.newsroom.json`,'application/json');toast('Backup downloaded. Keep it in a private location.');
}
async function importBackup(file){
  requireOffice();
  if(!file)return;if(file.size>100*1024*1024)throw new Error('This backup exceeds the 100 MB import limit.');
  const data=JSON.parse(await file.text());
  if(data.format!=='chemistry-newsroom'||data.version!==1||!Array.isArray(data.records)||data.records.length>1000)throw new Error('Choose a valid Chemistry Newsroom backup (up to 1,000 records).');
  const existing=new Set(state.records.map(r=>r.id));const records=[];
  for(const r of data.records){
    if(typeof r.id!=='string'||r.id.length>100||!statuses.includes(r.status)||!categories.some(c=>c.id===r.category)||typeof r.headline!=='string'||typeof r.createdAt!=='string'||!Array.isArray(r.images)||r.images.length>30||!r.details||typeof r.details!=='object'||Array.isArray(r.details))throw new Error('This backup contains an invalid record. Nothing was imported.');
    if(r.additionalPublications!==undefined && (!Array.isArray(r.additionalPublications)||r.additionalPublications.length>=maxPublications||r.additionalPublications.some(p=>!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)||p.id==='primary'||Object.values(p).some(v=>typeof v!=='string'))))throw new Error('The backup contains invalid publication entries. Nothing was imported.');
    const papers=publicationEntries(r);
    if(new Set(papers.map(p=>p.id)).size!==papers.length || (r.category!=='publication'&&r.images.length>3) || (r.category==='publication' && (r.images.some(i=>!papers.some(p=>p.id===imagePublicationId(i)))||papers.some(p=>r.images.filter(i=>imagePublicationId(i)===p.id).length>3))))throw new Error('The backup contains invalid publication images. Nothing was imported.');
    if(existing.has(r.id))continue;
    let totalImageBytes=0;
    for(const img of r.images){if(typeof img.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(img.id)||!['image/jpeg','image/png','image/webp'].includes(img.type)||!new RegExp(`^data:${img.type};base64,[A-Za-z0-9+/=]+$`).test(img.dataUrl))throw new Error('The backup contains an unsupported image. Nothing was imported.');const b=dataUrlBytes(img.dataUrl);totalImageBytes+=b.length;img.size=b.length;if(b.length>config.maxImageBytes||!validImageBytes(b,img.type))throw new Error('The backup contains an invalid or oversized image. Nothing was imported.');}
    if(totalImageBytes>maxSubmissionImageBytes)throw new Error('A submission exceeds the 30 MB image limit. Nothing was imported.');
    records.push({...emptySubmission(),...r,history:Array.isArray(r.history)?r.history:[]});existing.add(r.id);
  }
  await localImport(records);state.records=await listSubmissions();settings();toast(`${records.length} records imported. Existing IDs were skipped.`);
}

async function handleClick(event){
  if(event.target.closest('.skip-link')){event.preventDefault();document.querySelector('#main')?.focus();return;}
  const stepButton=event.target.closest('[data-step]');if(stepButton){state.step=Number(stepButton.dataset.step);state.errors={};renderForm();return;}
  const catButton=event.target.closest('[data-category]');if(catButton){state.form.category=catButton.dataset.category;state.errors={};state.dirty=true;renderForm();scheduleSave();return;}
  const tab=event.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;state.selected.clear();dashboard();return;}
  const paperRemove=event.target.closest('[data-remove-publication]');if(paperRemove){const id=paperRemove.dataset.removePublication;const index=(state.form.additionalPublications||[]).findIndex(p=>p.id===id);if(index<0)return;state.removedPublication={paper:state.form.additionalPublications[index],index,images:state.form.images.filter(i=>imagePublicationId(i)===id)};removePublication(state.form,id);state.errors={};state.dirty=true;renderForm();scheduleSave();document.querySelector('[data-action=undo-publication]')?.focus();return;}
  const remove=event.target.closest('[data-remove-image]');if(remove){state.form.images.splice(Number(remove.dataset.removeImage),1);state.dirty=true;renderForm();scheduleSave();return;}
  const dropzone=event.target.closest('[data-upload-publication]');if(dropzone){state.uploadPublicationId=dropzone.dataset.uploadPublication;document.querySelector('#image-input').click();return;}
  const action=event.target.closest('[data-action]')?.dataset.action;
  switch(action){
    case'help':openDialog('Using the news portal',`<p><strong>Submit news.</strong> Students, faculty, and staff can send publications, grants, milestones, and other news. Enter your name and research group; no account is needed.</p><p><strong>Save a draft.</strong> Return using this browser to finish it. Draft access lasts up to 30 days; clearing cookies removes your access.</p><p><strong>Office review.</strong> Authorized staff enter the office password to read submissions, view images, add notes, and download Excel files. Submitted records are private to the office.</p><p>No submission or review emails are sent. Keep the reference shown after submitting.</p><button class="button primary" data-action="close-dialog">Close</button>`);break;
    case'refresh-inbox':{const version=accessVersion;const rows=await listSubmissions();if(version!==accessVersion)return;state.records=rows;dashboard();toast('Inbox refreshed.');break;}
    case'recover-preview':{const count=await recoverBrowserPreview();state.records=await listSubmissions();settings();toast(`${count} earlier preview records imported. Existing records were kept.`);break;}
    case'sign-out':await signOut();break;
    case'change-office-password':passwordChangeDialog();break;
    case'request-password-change':{
      const button=dialog.querySelector('[data-action="request-password-change"]');button.disabled=true;
      try{await requestOfficePasswordChange();openDialog('Check the administrator’s email','<p>A one-use password-change link has been sent. It expires in 20 minutes. The current password has not changed.</p><button class="button primary" data-action="close-dialog">Done</button>');}
      finally{button.disabled=false;}
      break;
    }
    case'close-dialog':dialog.close();break;
    case'new':clearTimeout(state.saveTimer);await state.saveQueue.catch(()=>{});state.form=emptySubmission();state.removedPublication=null;if(location.hash==='#submit'){state.step=0;state.errors={};renderForm();}else routeTo('submit');break;
    case'add-publication':if(state.busy||publicationEntries(state.form).length>=maxPublications)return;state.form.additionalPublications ||= [];state.form.additionalPublications.push(emptyPublication());state.dirty=true;state.errors={};renderForm();scheduleSave();document.querySelector(`#field-additionalPublications-${state.form.additionalPublications.length-1}-paperTitle`)?.focus();break;
    case'undo-publication':if(!state.removedPublication)return;{const {paper,index,images}=state.removedPublication;if(publicationEntries(state.form).length>=maxPublications)throw new Error('Remove a publication before restoring this one.');state.form.additionalPublications.splice(index,0,paper);state.form.images.push(...images);state.removedPublication=null;state.dirty=true;state.errors={};renderForm();scheduleSave();}break;
    case'previous':state.step--;state.errors={};renderForm();window.scrollTo(0,0);break;
    case'save-draft':await persistDraft();break;
    case'clear-selection':state.selected.clear();renderTable();break;
    case'reset-filters':state.search='';state.filterCategory='all';state.filterStatus='all';dashboard();break;
    case'export':exportDialog(state.selected.size?filteredRecords().filter(r=>state.selected.has(r.id)):filteredRecords());break;
    case'export-story':exportDialog([state.records.find(r=>r.id===state.detailId)]);break;
    case'download-excel':await performExport();break;
    case'download-package':await performExport(true);break;
    case'update-status':await updateStatus();break;
    case'backup':await backup();break;
    case'import':document.querySelector('#backup-input').click();break;
  }
}
document.addEventListener('click',event=>handleClick(event).catch(err=>toast(errorMessage(err),true)));
document.addEventListener('submit',event=>{if(event.target.id==='news-form'){event.preventDefault();advance().catch(err=>toast(errorMessage(err),true));}else if(event.target.id==='office-form'){event.preventDefault();submitOffice(event.target).catch(err=>toast(errorMessage(err),true));}else if(event.target.id==='office-reset-form'){event.preventDefault();submitPasswordReset(event.target).catch(err=>toast(errorMessage(err),true));}});
document.addEventListener('input',event=>{
  const target=event.target;
  if(target.id==='search'){state.search=target.value;state.selected.clear();renderTable();return;}
  if(target.closest('#news-form')&&target.name&&!['radio','checkbox'].includes(target.type)){getFormValue(target.name,target.value);delete state.errors[target.name];scheduleSave();}
});
document.addEventListener('change',async event=>{try{
  const t=event.target;
  if(t.id==='category-filter'||t.id==='status-filter'){state[t.id==='category-filter'?'filterCategory':'filterStatus']=t.value;state.selected.clear();renderTable();}
  if(t.dataset.select){t.checked?state.selected.add(t.dataset.select):state.selected.delete(t.dataset.select);renderTable();}
  if(t.id==='select-all'){for(const r of filteredRecords())t.checked?state.selected.add(r.id):state.selected.delete(r.id);renderTable();}
  if(t.id==='image-input')await addImages([...t.files],state.uploadPublicationId||'primary');
  if(t.id==='show-samples'){state.showSamples=t.checked;localStorage.setItem('newsroom-show-samples',String(t.checked));settings();}
  if(t.id==='backup-input')await importBackup(t.files[0]);
  if(t.closest('#news-form')&&t.type==='checkbox'){getFormValue(t.name,t.checked);scheduleSave();}
  if(t.closest('#news-form')&&t.type==='radio'){getFormValue(t.name,t.value);renderForm();scheduleSave();}
  if(t.closest('#news-form')&&t.tagName==='SELECT'){getFormValue(t.name,t.value);scheduleSave();}
}catch(err){toast(errorMessage(err),true);}});
document.addEventListener('dragover',event=>{const zone=event.target.closest('[data-upload-publication]');if(zone){event.preventDefault();zone.classList.add('dragging');}});
document.addEventListener('dragleave',event=>{event.target.closest('[data-upload-publication]')?.classList.remove('dragging');});
document.addEventListener('drop',event=>{const zone=event.target.closest('[data-upload-publication]');if(zone){event.preventDefault();addImages([...event.dataTransfer.files],zone.dataset.uploadPublication).catch(err=>toast(errorMessage(err),true));}});
document.addEventListener('keydown',event=>{if(event.target.matches('[data-upload-publication]')&&['Enter',' '].includes(event.key)){event.preventDefault();state.uploadPublicationId=event.target.dataset.uploadPublication;document.querySelector('#image-input').click();}});
window.addEventListener('hashchange',()=>renderRoute().catch(err=>toast(errorMessage(err),true)));
window.addEventListener('office-locked',()=>forceOfficeLock());
window.addEventListener('storage',event=>{if(event.key==='newsroom-office-locked'&&isEditor())forceOfficeLock();});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});

async function start(){
  if(config.mode==='google'){
    if(!config.googleClientId || !config.googleScriptUrl)throw new Error('Google mode needs a configured client ID and Apps Script deployment URL. See the setup guide.');
    await renderRoute();
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onload=()=>{
      google.accounts.id.initialize({client_id:config.googleClientId,callback:async response=>{try{
        resetWorkspace();session.token=response.credential;session.expiresAt=Date.now()+50*60*1000;
        const result=await googleRequest('session');Object.assign(session,result.user);
        state.records=await listSubmissions();await renderRoute();
      }catch(err){Object.assign(session,{token:'',role:'contributor',sub:'',email:'',name:'',expiresAt:0});resetWorkspace();renderSignIn();toast(errorMessage(err),true);}}});
      const signInButton=document.querySelector('#google-signin');if(signInButton)google.accounts.id.renderButton(signInButton,{theme:'outline',size:'large'});
    };script.onerror=()=>toast('Google sign-in could not load. Check your connection and try again.',true);document.head.append(script);
  }else{await initialize();scheduleOfficeLock();state.records=await listSubmissions();if(session.restoredDraftId&&location.hash==='#submit')history.replaceState(null,'',`#edit/${session.restoredDraftId}`);await renderRoute();if(session.migrationWarning)toast(session.migrationWarning,true);}
}
start().catch(err=>{app.innerHTML=`<main class="startup-error"><h1>The workspace couldn’t open.</h1><p>${e(errorMessage(err))}</p><p>Check that the portal server is running, then reload.</p><button class="button primary" onclick="location.reload()">Reload</button></main>`;});
