/* Chemistry Newsroom: optional Google Apps Script backend.
 * Password-change emails only, explicitly requested by the user.
 * No submission emails, paid APIs, billing integrations, or automatic upgrades.
 * Deployment is a separate manual step. Read SETUP.md first.
 */
var NEWSROOM_STATUSES = ['Draft','Submitted','In review','Changes requested','Approved','Published','Archived'];
var NEWSROOM_CATEGORIES = {
  publication:['paperTitle','authors','venue','publicationStatus'],grant:['projectTitle','funder','investigator','awardStatus'],milestone:['student','milestone','program','advisor'],award:['recipient','award','organization'],talk:['presenter','talkTitle','host','presentationType'],outreach:['activity','organizers','audience'],media:['featured','outlet','coverageTitle'],event:['announcementType','people'],other:['people']
};
function doGet() { return json_({ok:true,service:'Chemistry Newsroom',version:1,submissionEmailEnabled:false,passwordChangeEmailEnabled:true}); }
function doPost(event) {
  try {
    if (!event || !event.postData || event.postData.contents.length > 45000000) throw new Error('Invalid or oversized request.');
    var body = JSON.parse(event.postData.contents);
    var settings = settings_();
    var user = verifyToken_(body.token,settings);
    rateLimit_(user);
    if(body.action==='officeChallenge')return json_({ok:true,...officeChallenge_(user)});
    if(body.action==='officeUnlock')return json_({ok:true,...unlockOffice_(user,body.proof)});
    if(body.action==='officeLock'){lockOffice_(user,body.officeToken);return json_({ok:true});}
    if(body.action==='officeResetRequest'){requestOfficeReset_(user);return json_({ok:true});}
    if(body.action==='officeResetChallenge')return json_({ok:true,...officeResetChallenge_(user,body.resetToken)});
    if(body.action==='officeResetComplete'){completeOfficeReset_(user,body.resetToken,body.proof);return json_({ok:true});}
    user=officeSession_(user,body.officeToken);
    if (body.action === 'session') return json_({ok:true,user:user});
    if (body.action === 'list') return json_({ok:true,records:readRecords_(settings).filter(function(row){return canRead_(row,user);}).map(function(row){return recordForUser_(row,user);})});
    if (body.action === 'images') {
      var record = readRecords_(settings).find(function(row){return row.id===body.id;});
      if (!record || !canRead_(record,user)) throw new Error('This story is not available to your account.');
      var folder=DriveApp.getFolderById(settings.folder);
      var images=record.images.map(function(image){
        var file=DriveApp.getFileById(image.fileId);assertInFolder_(file,folder);
        return Object.assign({},image,{dataUrl:'data:'+image.type+';base64,'+Utilities.base64Encode(file.getBlob().getBytes())});
      });
      return json_({ok:true,images:images});
    }
    if (body.action === 'save') return json_({ok:true,record:saveRecord_(body.record,user,settings)});
    throw new Error('Unknown action.');
  } catch (error) { return json_({ok:false,error:publicError_(error)}); }
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function settings_(){
  var p=PropertiesService.getScriptProperties();
  var settings={clientId:p.getProperty('GOOGLE_CLIENT_ID'),sheet:p.getProperty('SHEET_ID'),folder:p.getProperty('DRIVE_FOLDER_ID'),editors:csv_(p.getProperty('EDITOR_EMAILS')),contributors:csv_(p.getProperty('CONTRIBUTOR_EMAILS')),domains:csv_(p.getProperty('ALLOWED_DOMAINS'))};
  if(!settings.clientId||!settings.sheet||!settings.folder||!settings.editors.length)throw new Error('The department workspace has not been configured.');
  return settings;
}
function csv_(value){return String(value||'').split(',').map(function(s){return s.trim().toLowerCase();}).filter(Boolean);}
function officePassword_(){
  var p=PropertiesService.getScriptProperties(),salt=p.getProperty('OFFICE_PASSWORD_SALT'),verifier=p.getProperty('OFFICE_PASSWORD_VERIFIER');
  if(!/^[a-f0-9]{48}$/.test(salt||'')||!/^[a-f0-9]{64}$/.test(verifier||''))throw new Error('Ask the administrator to configure the office password.');
  return {salt:salt,iterations:600000,verifier:verifier};
}
function officeChallenge_(user){
  if(user.role!=='editor')throw new Error('Only approved office accounts can unlock the inbox.');
  var c=officePassword_();return {configured:true,salt:c.salt,iterations:c.iterations};
}
function hashOfficeProof_(proof){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,proof,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function equalOfficeHash_(a,b){var diff=a.length^b.length;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0;}
function unlockOffice_(user,proof){
  if(user.role!=='editor')throw new Error('Only approved office accounts can unlock the inbox.');
  var c=officePassword_(),cache=CacheService.getScriptCache(),key='office-attempts:'+user.sub,lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('Please try again.');
  try{
    var attempts=Number(cache.get(key)||0);
    if(attempts>=5)throw new Error('Too many attempts. Try again in 5 minutes.');
    if(typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof)||!equalOfficeHash_(hashOfficeProof_(proof),c.verifier)){
      cache.put(key,String(attempts+1),300);throw new Error('Incorrect office password.');
    }
    cache.remove(key);
    var token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''),expiresAt=Math.min(Date.now()+1800000,user.expiresAt);
    cache.put('office-session:'+token,JSON.stringify({sub:user.sub,expiresAt:expiresAt,verifier:c.verifier}),1800);
    return {officeToken:token,user:Object.assign({},user,{officeEligible:true,officeExpiresAt:expiresAt})};
  }finally{lock.releaseLock();}
}
function officeSession_(user,token){
  var result=Object.assign({},user,{officeEligible:user.role==='editor',role:'contributor',officeExpiresAt:0});
  if(!result.officeEligible||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return result;
  var stored=CacheService.getScriptCache().get('office-session:'+token);
  if(stored){var entry=JSON.parse(stored);if(entry.sub===user.sub&&entry.expiresAt>Date.now()&&entry.verifier===officePassword_().verifier){result.role='editor';result.officeExpiresAt=entry.expiresAt;}}
  return result;
}
function lockOffice_(user,token){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return;
  var cache=CacheService.getScriptCache(),stored=cache.get('office-session:'+token);
  if(stored&&JSON.parse(stored).sub===user.sub)cache.remove('office-session:'+token);
}
function officeResetSettings_(){
  var p=PropertiesService.getScriptProperties(),email=String(p.getProperty('OFFICE_RESET_EMAIL')||'').trim().toLowerCase(),url=p.getProperty('PORTAL_URL');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^https:\/\/[^\s#]+$/.test(url||''))throw new Error('Password-change email has not been configured by the administrator.');
  return {email:email,url:url};
}
function requestOfficeReset_(user){
  if(user.role!=='editor')throw new Error('Only approved office accounts can request a password change.');
  var c=officePassword_(),settings=officeResetSettings_(),cache=CacheService.getScriptCache(),p=PropertiesService.getScriptProperties(),lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('Please try again.');
  try{
    if(cache.get('office-reset-cooldown'))throw new Error('A password-change email was requested recently. Wait 10 minutes before requesting another.');
    if(MailApp.getRemainingDailyQuota()<1)throw new Error('Password-change email is unavailable today. Try again later.');
    var token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''),key=hashOfficeProof_(token),salt=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').slice(0,48);
    var entry={salt:salt,expiresAt:Date.now()+1200000,verifier:c.verifier};
    cache.put('office-reset:'+key,JSON.stringify(entry),1200);p.setProperty('OFFICE_RESET_CURRENT',key);
    try{
      // Recipient and destination come only from private administrator settings.
      // Never use a browser-provided email address or redirect URL.
      MailApp.sendEmail({to:settings.email,subject:'Chemistry Newsroom: change office password',body:'A password change was requested for the Chemistry Newsroom office.\n\nSign in with this Google account and open this one-use link within 20 minutes:\n'+settings.url+'#office-reset/'+token+'\n\nIf you did not request this, ignore the email. The password has not changed.'});
    }catch(error){cache.remove('office-reset:'+key);p.deleteProperty('OFFICE_RESET_CURRENT');throw new Error('The password-change email could not be sent. Try again later.');}
    cache.put('office-reset-cooldown','1',600);
  }finally{lock.releaseLock();}
}
function officeResetEntry_(user,token){
  var settings=officeResetSettings_(),p=PropertiesService.getScriptProperties();
  if(user.role!=='editor'||user.email!==settings.email)throw new Error('Sign in with the administrator’s Google account to change the password.');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new Error('This password-change link is invalid or expired.');
  var key=hashOfficeProof_(token),raw=CacheService.getScriptCache().get('office-reset:'+key);
  if(!raw||p.getProperty('OFFICE_RESET_CURRENT')!==key)throw new Error('This password-change link is invalid or expired.');
  var entry=JSON.parse(raw);
  if(entry.expiresAt<=Date.now()||entry.verifier!==officePassword_().verifier)throw new Error('This password-change link is invalid or expired.');
  return {key:key,salt:entry.salt};
}
function officeResetChallenge_(user,token){var entry=officeResetEntry_(user,token);return {salt:entry.salt,iterations:600000};}
function completeOfficeReset_(user,token,proof){
  var lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Please try again.');
  try{
    var entry=officeResetEntry_(user,token);
    if(typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof))throw new Error('Enter a valid new password.');
    PropertiesService.getScriptProperties().setProperties({OFFICE_PASSWORD_SALT:entry.salt,OFFICE_PASSWORD_VERIFIER:hashOfficeProof_(proof)});
    CacheService.getScriptCache().remove('office-reset:'+entry.key);PropertiesService.getScriptProperties().deleteProperty('OFFICE_RESET_CURRENT');
  }finally{lock.releaseLock();}
}
function verifyToken_(token,settings){
  if(typeof token!=='string'||token.length>8000||!token)throw new Error('Sign in with your approved Google account.');
  // Google verifies the signed ID token. Never accept browser-decoded identity claims.
  var response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(token),{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Your Google session is invalid or expired. Sign in again.');
  var claims=JSON.parse(response.getContentText());
  if(claims.aud!==settings.clientId||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||Number(claims.exp)*1000<=Date.now()||![true,'true'].includes(claims.email_verified)||!claims.sub)throw new Error('Your Google session is invalid or expired. Sign in again.');
  var email=String(claims.email||'').toLowerCase();
  var editor=settings.editors.includes(email);
  // A domain grant requires Google's hosted-domain claim, not just an email suffix.
  if(!editor&&!settings.contributors.includes(email)&&!settings.domains.includes(String(claims.hd||'').toLowerCase()))throw new Error('This Google account is not on the department’s access list.');
  return {email:email,name:String(claims.name||email),sub:String(claims.sub),role:editor?'editor':'contributor',expiresAt:Number(claims.exp)*1000};
}
function canRead_(row,user){return user.role==='editor'||(user.role==='contributor'&&Boolean(user.sub)&&row.status==='Draft'&&row.ownerSub===user.sub);}
function recordForUser_(row,user){
  if(user.role==='editor')return row;
  if(row.status!=='Draft')return {id:row.id,reference:row.reference,status:row.status};
  return Object.assign({},row,{editorNotes:'',original:null,history:[]});
}
function rateLimit_(user){
  var cache=CacheService.getScriptCache(),key='rate:'+user.sub,count=Number(cache.get(key)||0);
  if(count>=60)throw new Error('Too many requests. Please wait a minute and try again.');
  cache.put(key,String(count+1),60);
}
function recordsSheet_(settings){
  var ss=SpreadsheetApp.openById(settings.sheet),sheet=ss.getSheetByName('Newsroom');
  if(!sheet)throw new Error('Run setupNewsroom in Apps Script before using this workspace.');
  return sheet;
}
function setupNewsroom(){
  // Run once, manually, as the owner. Creates a tab only in the configured spreadsheet.
  var settings=settings_(),ss=SpreadsheetApp.openById(settings.sheet),sheet=ss.getSheetByName('Newsroom');
  if(!sheet)sheet=ss.insertSheet('Newsroom');
  if(sheet.getLastRow()===0){sheet.appendRow(['ID','Owner email','Reference','Headline','Category','Status','Updated at','Record JSON']);sheet.setFrozenRows(1);sheet.getRange(1,1,1,8).setBackground('#193b34').setFontColor('#ffffff').setFontWeight('bold');}
  DriveApp.getFolderById(settings.folder).getName(); // Validate the specified folder without sharing it.
}
function readRecords_(settings){
  var sheet=recordsSheet_(settings);if(sheet.getLastRow()<2)return [];
  return sheet.getRange(2,8,sheet.getLastRow()-1,1).getValues().map(function(row){return JSON.parse(row[0]);});
}
function cleanString_(value,max,field){if(typeof value!=='string')value='';if(value.length>max)throw new Error(field+' is too long.');return value;}
function publicationRecords_(r){return r.category==='publication'?[Object.assign({},r.details,{id:'primary'})].concat(r.additionalPublications||[]):[];}
function validateRecord_(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid submission.');
  if(typeof input.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id))throw new Error('Invalid submission ID.');
  if(!NEWSROOM_STATUSES.includes(input.status)||!Object.prototype.hasOwnProperty.call(NEWSROOM_CATEGORIES,input.category))throw new Error('Invalid category or status.');
  var result={id:input.id,status:input.status,category:input.category,details:{},images:[],permission:input.permission===true,release:input.release,embargo:cleanString_(input.embargo,40,'Embargo'),sample:false};
  [['headline',180],['summary',6000],['submitter',200],['email',254],['group',300],['newsDate',30],['link',2000],['notes',6000],['editorNotes',6000],['publishedUrl',2000]].forEach(function(field){result[field[0]]=cleanString_(input[field[0]],field[1],field[0]);});
  if(!input.details||typeof input.details!=='object'||Array.isArray(input.details))throw new Error('Invalid category details.');
  Object.keys(input.details).forEach(function(key){if(!/^[a-zA-Z][a-zA-Z0-9]{0,50}$/.test(key)||['constructor','prototype','__proto__'].includes(key))throw new Error('Invalid field name.');result.details[key]=cleanString_(input.details[key],key==='abstract'?20000:['officeComments','moreInformation'].includes(key)?6000:2000,key);});
  if(input.additionalPublications!==undefined && (!Array.isArray(input.additionalPublications)||input.additionalPublications.length>9))throw new Error('Use up to ten publications per submission.');
  result.additionalPublications=(input.additionalPublications||[]).map(function(paper){
    if(!paper||typeof paper.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(paper.id)||paper.id==='primary')throw new Error('Invalid publication ID.');
    var clean={id:paper.id};
    ['paperTitle','authors','venue','publicationStatus','doi','abstract','publicationDate','officeComments','moreInformation'].forEach(function(key){clean[key]=cleanString_(paper[key],key==='abstract'?20000:['officeComments','moreInformation'].includes(key)?6000:2000,key);});
    return clean;
  });
  if(new Set(result.additionalPublications.map(function(p){return p.id;})).size!==result.additionalPublications.length)throw new Error('Duplicate publication IDs.');
  if(!['ready','embargo','contact'].includes(result.release))throw new Error('Choose a release preference.');
  var papers=publicationRecords_(result);
  if(!Array.isArray(input.images)||input.images.length>(papers.length?papers.length*3:3))throw new Error('At most three images per publication or news item are allowed.');
  input.images.forEach(function(image){
    if(!image||typeof image.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(image.id)||!['image/jpeg','image/png','image/webp'].includes(image.type))throw new Error('Unsupported image.');
    var img={id:image.id,type:image.type,name:cleanString_(image.name,255,'Filename'),caption:cleanString_(image.caption,1000,'Caption'),credit:cleanString_(image.credit,500,'Credit'),alt:cleanString_(image.alt,1000,'Alternative text'),rights:image.rights,size:Number(image.size)};
    if(result.category==='publication'){
      img.publicationId=image.publicationId||'primary';
      if(!papers.some(function(p){return p.id===img.publicationId;}))throw new Error('An image refers to a missing publication.');
    }
    if(!['cleared','pending'].includes(img.rights))throw new Error('Specify image permission.');
    if(!Number.isFinite(img.size)||img.size<1||img.size>10*1024*1024)throw new Error('Each image must be no larger than 10 MB.');
    if(image.dataUrl!==undefined){if(typeof image.dataUrl!=='string'||image.dataUrl.length>14500000||!image.dataUrl.startsWith('data:'+image.type+';base64,'))throw new Error('Invalid image data.');img.dataUrl=image.dataUrl;}
    result.images.push(img);
  });
  if(new Set(result.images.map(function(i){return i.id;})).size!==result.images.length)throw new Error('Duplicate image IDs.');
  if(result.images.reduce(function(total,i){return total+i.size;},0)>30*1024*1024)throw new Error('Keep all images in one submission within 30 MB.');
  if(papers.some(function(p){return result.images.filter(function(i){return i.publicationId===p.id;}).length>3;}))throw new Error('At most three images per publication are allowed.');
  [result.link,result.publishedUrl,result.details.coverageLink,result.details.registration].filter(Boolean).forEach(function(url){if(!/^https?:\/\/[^\s]+$/i.test(url))throw new Error('Use a valid http:// or https:// link.');});
  if(result.status!=='Draft'){
    ['headline','summary','submitter','group','newsDate'].forEach(function(key){if(!result[key].trim())throw new Error('Complete the '+key+' field.');});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(result.newsDate)||isNaN(Date.parse(result.newsDate)))throw new Error('Choose a valid news date.');
    NEWSROOM_CATEGORIES[result.category].forEach(function(key){if(!result.details[key]||!result.details[key].trim())throw new Error('Complete the '+key+' field.');});
    papers.forEach(function(paper,index){
      NEWSROOM_CATEGORIES.publication.forEach(function(key){if(!paper[key]||!paper[key].trim())throw new Error('Complete '+key+' for publication '+(index+1)+'.');});
      if(paper.publicationDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(paper.publicationDate)||isNaN(Date.parse(paper.publicationDate))))throw new Error('Choose a valid publication date.');
    });
    if(!result.permission)throw new Error('Confirm the accuracy and permission statement.');
    result.images.forEach(function(i){if(!i.caption.trim()||!i.credit.trim()||!i.alt.trim())throw new Error('Each image needs a caption, credit, and alternative text.');});
    if(result.release==='embargo'&&(!result.embargo||isNaN(Date.parse(result.embargo))))throw new Error('Choose a valid embargo time.');
  }
  return result;
}
function isReleased_(r){return (r.release==='ready'||(r.release==='embargo'&&Date.parse(r.embargo)<=Date.now()))&&r.images.every(function(i){return i.rights==='cleared';});}
function saveRecord_(input,user,settings){
  var r=validateRecord_(input),lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw new Error('Another story is being saved. Please try again.');
  try{
    var sheet=recordsSheet_(settings),rows=readRecords_(settings),index=rows.findIndex(function(row){return row.id===r.id;}),old=index>=0?rows[index]:null;
    if(old&&!canRead_(old,user))throw new Error('This story is not available to your account.');
    if(old&&Number(input.version)!==Number(old.version))throw new Error('This story was updated elsewhere. Reload the workspace before editing it again.');
    if(!old&&!['Draft','Submitted'].includes(r.status))throw new Error('New stories must begin as drafts or submissions.');
    if(user.role!=='editor'){
      if(!['Draft','Submitted'].includes(r.status))throw new Error('Only an editor can change review status.');
      if(old&&old.status!=='Draft'&&r.status==='Draft')throw new Error('Submit your corrections for editorial review.');
      r.editorNotes=old?old.editorNotes:'';r.publishedUrl=old?old.publishedUrl:'';
    }
    if(r.status==='Changes requested'&&!r.editorNotes.trim())throw new Error('Describe the requested changes in the editor note.');
    if(r.status==='Published'&&!isReleased_(r))throw new Error('Resolve release restrictions before recording publication.');
    r.ownerSub=old?old.ownerSub:user.sub;r.ownerEmail=old?old.ownerEmail:user.email;
    r.email=old?old.email:user.email; // A contributor cannot impersonate another account.
    r.createdAt=old?old.createdAt:new Date().toISOString();r.updatedAt=new Date().toISOString();r.reference=old?old.reference:'CN-'+new Date().getFullYear()+'-'+r.id.slice(0,6).toUpperCase();r.version=old?Number(old.version)+1:1;
    r.publishedAt=r.status==='Published'?(old&&old.publishedAt||r.updatedAt):(old&&old.publishedAt||'');
    r.original=old&&old.original?old.original:old&&old.status!=='Draft'?{headline:old.headline,summary:old.summary,details:old.details,additionalPublications:old.additionalPublications||[]}:null;
    r.history=(old&&old.history||[]).concat([{status:r.status,at:r.updatedAt,actor:user.name,note:r.editorNotes!==((old&&old.editorNotes)||'')?r.editorNotes:''}]).slice(-150);
    // Validate the metadata size before uploads. Sheets cells have finite capacity.
    if(JSON.stringify(r).replace(/data:[^,]+;base64,[A-Za-z0-9+/=]+/g,'').length>45000)throw new Error('This record is too large for the free spreadsheet store. Shorten its text.');
    var folder=DriveApp.getFolderById(settings.folder);
    var previousImages=old&&old.images||[];
    r.images=r.images.map(function(image){
      var previous=previousImages.find(function(i){return i.id===image.id;});
      if(previous){
        // Image IDs are immutable. Existing bytes are retained; metadata can change.
        image.fileId=previous.fileId;image.type=previous.type;image.size=previous.size;image.name=previous.name;delete image.dataUrl;return image;
      }
      if(!image.dataUrl)throw new Error('New images must include their file data.');
      var bytes=Utilities.base64Decode(image.dataUrl.split(',')[1]);
      if(bytes.length>10*1024*1024||!imageSignature_(bytes,image.type))throw new Error('Invalid or oversized image.');
      var name=r.id+'_'+image.id;
      // A deterministic filename lets a retry reuse an upload after an interrupted save.
      var existing=folder.getFilesByName(name),file=existing.hasNext()?existing.next():folder.createFile(Utilities.newBlob(bytes,image.type,name));
      image.fileId=file.getId();image.size=bytes.length;delete image.dataUrl;return image;
    });
    if(r.images.reduce(function(total,image){return total+image.size;},0)>30*1024*1024)throw new Error('Keep all images in one submission within 30 MB.');
    var serialized=JSON.stringify(r);if(serialized.length>49000)throw new Error('This record is too large for one spreadsheet cell.');
    var values=[r.id,r.ownerEmail,r.reference,r.headline,r.category,r.status,r.updatedAt,serialized].map(sheetText_);
    sheet.getRange(index>=0?index+2:sheet.getLastRow()+1,1,1,8).setValues([values]);SpreadsheetApp.flush();return recordForUser_(r,user);
  }finally{lock.releaseLock();}
}
function imageSignature_(raw,type){var b=raw.map(function(n){return n&255;});if(type==='image/png')return b.length>8&&[137,80,78,71,13,10,26,10].every(function(n,i){return b[i]===n;});if(type==='image/jpeg')return b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;if(type==='image/webp')return b.length>12&&String.fromCharCode.apply(null,b.slice(0,4))==='RIFF'&&String.fromCharCode.apply(null,b.slice(8,12))==='WEBP';return false;}
function sheetText_(value){var text=String(value==null?'':value);return /^[=+@\-\t\r]/.test(text)?"'"+text:text;}
function assertInFolder_(file,folder){var parents=file.getParents(),found=false;while(parents.hasNext())if(parents.next().getId()===folder.getId())found=true;if(!found)throw new Error('Image not available.');}
function publicError_(error){var message=String(error&&error.message||'Request failed.');if(/quota|limit exceeded|too many times|storage/i.test(message))return 'The free Google service limit was reached. Nothing will be upgraded or charged. Try later or free storage in the configured account.';return message.slice(0,250);}
