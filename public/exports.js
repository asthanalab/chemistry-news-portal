import { category, categories, releaseEligible, publicationEntries, publicationDetailFields, imagePublicationId } from './model.js';
const encoder=new TextEncoder();
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function join(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function header(size){const bytes=new Uint8Array(size);return [bytes,new DataView(bytes.buffer)];}
export function zipFiles(files) {
  const parts=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    const path=encoder.encode(name),data=typeof content==='string'?encoder.encode(content):content,crc=crc32(data);
    const [h,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);
    parts.push(h,path,data);
    const [c,w]=header(46);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,path.length,true);w.setUint32(42,offset,true);central.push(c,path);offset+=h.length+path.length+data.length;
  }
  const directory=join(central),[end,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,Object.keys(files).length,true);v.setUint16(10,Object.keys(files).length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
  return join([...parts,directory,end]);
}
export const xml=s=>String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function column(i){let name='';for(i++;i>0;i=Math.floor((i-1)/26))name=String.fromCharCode(65+(i-1)%26)+name;return name;}
function sheetXml(rows){
  const width=rows[0].length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({length:width},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${i===0?20:i===2 || i===3?46:28}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,r)=>`<row r="${r+1}"${r===0?' ht="28" customHeight="1"':''}>${row.map((v,c)=>{if(String(v??'').length>32767)throw new Error('An export field exceeds Excel’s cell limit. Shorten the field before exporting.');return `<c r="${column(c)}${r+1}" s="${r===0?1:2}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${column(width-1)}${Math.max(rows.length,1)}"/></worksheet>`;
}
export function workbookSheets(records,{publicationOnly=false}={}) {
  const selected=publicationOnly?records.filter(r=>releaseEligible(r)):records;
  const master=[['Submission ID','Category','Headline','Summary','Research group','News date','Status','Submitted at','Release preference','Embargo until','Image count','Sample data',...(publicationOnly?[]:['Submitter','Contact email','Private note','Editor note'])],...selected.map(r=>[r.reference,category(r.category).name,r.headline,r.summary,r.group,r.newsDate,r.status,r.createdAt,r.release,r.embargo,r.images.length,r.sample?'Fictional example':'',...(publicationOnly?[]:[r.submitter,r.email,r.notes,r.editorNotes])])];
  const sheets=[{name:'All News',rows:master}];
  for(const cat of categories){
    const subset=selected.filter(r=>r.category===cat.id);if(!subset.length)continue;
    const fields=cat.id==='publication'?publicationDetailFields(publicationOnly):cat.fields;
    const rows=cat.id==='publication'
      ? [['Submission ID','Publication number','Publication ID',...fields.map(f=>f[1]),'Publication date'],...subset.flatMap(r=>publicationEntries(r).map((paper,index)=>[r.reference,index+1,paper.id,...fields.map(f=>paper[f[0]]||''),paper.publicationDate||'']))]
      : [['Submission ID',...cat.fields.map(f=>f[1])],...subset.map(r=>[r.reference,...cat.fields.map(f=>publicationOnly && r.category==='grant' && r.details.amountPermission!=='Yes' && ['amount','currency'].includes(f[0])?'Withheld':r.details[f[0]] || '')])];
    sheets.push({name:cat.short,rows});
  }
  sheets.push({name:'Media',rows:[['Submission ID','Image ID','Filename','Caption','Credit','Alternative text','Permission','Publication number','Publication ID','Paper title'],...selected.flatMap(r=>r.images.map(i=>{
    const papers=publicationEntries(r),index=papers.findIndex(p=>p.id===imagePublicationId(i));
    return [r.reference,i.id,i.name,i.caption,i.credit,i.alt,i.rights,index>=0?index+1:'',index>=0?papers[index].id:'',index>=0?papers[index].paperTitle:''];
  }))]});
  sheets.push({name:'Read me',rows:[['Property','Value'],['Prepared',new Date().toISOString()],['Export type',publicationOnly?'Approved, release-eligible publication copy':'Internal review — includes private contact details and notes'],['Images','Download a media package for image files. Match using submission ID and image ID.'],['Updates','This workbook is a snapshot. Changes here do not update the portal.'],['Sample records','Any row marked Fictional example is demonstration content, not departmental news.'],['Safety','All submitted values are stored as literal text, never spreadsheet formulas.']]});
  return sheets;
}
export function createWorkbook(records,options={}){
  const sheets=workbookSheets(records,options);
  const files={
    '[Content_Types].xml':`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF193B34"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
  sheets.forEach((s,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(s.rows));return zipFiles(files);
}
export function dataUrlBytes(url){const part=url.split(',')[1];const binary=atob(part);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export function download(data,name,type='application/octet-stream'){
  const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
