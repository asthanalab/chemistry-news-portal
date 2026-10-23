import {categories,category,statuses,publicationEntries,validateSubmission,safeUrl} from './public/model.js';
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
export function validatePortalRecord(input,old,trustedImages){
  if(!input||!identifier.test(input.id)||typeof input.id!=='string')throw fail('Invalid submission identifier.');
  if(!statuses.includes(input.status)||!categories.some(c=>c.id===input.category))throw fail('Invalid category or status.');
  const result={id:input.id,status:input.status,category:input.category,permission:input.permission===true,release:input.release,details:details(input.details,input.category)};
  for(const [key,max] of [['headline',180],['summary',6000],['submitter',200],['group',300],['newsDate',30],['link',2000],['notes',6000],['editorNotes',6000],['publishedUrl',2000],['embargo',40]])result[key]=text(input[key],max,key);
  if(!['ready','embargo','contact'].includes(result.release))throw fail('Choose a release preference.');
  if(input.additionalPublications!==undefined&&(!Array.isArray(input.additionalPublications)||input.additionalPublications.length>9))throw fail('Use up to ten publications.');
  result.additionalPublications=(input.additionalPublications||[]).map(p=>{
    if(!p||typeof p.id!=='string'||!identifier.test(p.id)||p.id==='primary')throw fail('Invalid publication identifier.');
    return {id:p.id,...details(p,'publication')};
  });
  if(new Set(result.additionalPublications.map(p=>p.id)).size!==result.additionalPublications.length)throw fail('Publication identifiers must be unique.');
  const papers=publicationEntries(result);
  if(!Array.isArray(input.images)||input.images.length>(papers.length?papers.length*3:3))throw fail('Use up to three images per publication or news item.');
  result.images=input.images.map(i=>{
    if(!i||typeof i.id!=='string'||!identifier.test(i.id)||!['image/jpeg','image/png','image/webp'].includes(i.type))throw fail('Unsupported image.');
    const image={id:i.id,type:i.type,publicationId:i.publicationId||'primary',rights:i.rights};
    for(const [key,max] of [['name',255],['caption',1000],['credit',500],['alt',1000]])image[key]=text(i[key],max,`Image ${key}`);
    if(!['cleared','pending'].includes(image.rights))throw fail('Choose the image permission status.');
    if(papers.length&&!papers.some(p=>p.id===image.publicationId))throw fail('An image refers to a missing publication.');
    if(trustedImages){
      const stored=trustedImages.get(i.id);
      if(!stored||stored.type!==i.type)throw fail('Upload the image before saving.');
      image.size=stored.size;return image;
    }
    const previous=old?.images?.find(p=>p.id===i.id&&p.type===i.type);
    image.dataUrl=i.dataUrl??previous?.dataUrl;
    const prefix=`data:${i.type};base64,`;
    if(typeof image.dataUrl!=='string'||image.dataUrl.length>14*MB||!image.dataUrl.startsWith(prefix)||!(/^[A-Za-z0-9+/]+={0,2}$/).test(image.dataUrl.slice(prefix.length)))throw fail('Invalid image data.');
    const bytes=Uint8Array.from(atob(image.dataUrl.slice(prefix.length)),c=>c.charCodeAt(0));image.size=bytes.length;
    const valid=validImageBytes(bytes,i.type);
    if(!valid||bytes.length>10*MB||bytes.length<12)throw fail('Each image must be a valid JPEG, PNG, or WebP up to 10 MB.');
    return image;
  });
  if(new Set(result.images.map(i=>i.id)).size!==result.images.length)throw fail('Image identifiers must be unique.');
  if(result.images.reduce((sum,i)=>sum+i.size,0)>30*MB)throw fail('Keep all images within 30 MB per submission.');
  if(papers.some(p=>result.images.filter(i=>i.publicationId===p.id).length>3))throw fail('Use up to three images per publication.');
  for(const url of [result.link,result.publishedUrl,result.details.coverageLink,result.details.registration])if(url&&!safeUrl(url))throw fail('Use a complete http:// or https:// link.');
  if(result.status!=='Draft'){
    const errors=validateSubmission(result);if(Object.keys(errors).length)throw fail(Object.values(errors)[0]);
  }
  return result;
}

export function validImageBytes(bytes,type){
  const ascii=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
  return bytes.length>=12&&(type==='image/png'?[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP');
}
