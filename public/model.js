export const categories = [
  { id:'publication', name:'Research publication', short:'Publication', icon:'book', tone:'blue', fields:[['paperTitle','Full paper title',true],['authors','Authors',true],['venue','Journal or publication venue',true],['publicationStatus','Publication status',true,'select',['Published','Online first','Accepted','Preprint']],['doi','DOI or publication URL',false],['abstract','Abstract',false,'textarea'],['officeComments','Comments to the office',false,'textarea'],['moreInformation','More information',false,'textarea']] },
  { id:'grant', name:'Grant & funding', short:'Grant', icon:'award', tone:'gold', fields:[['projectTitle','Project title',true],['funder','Funding organization',true],['investigator','Principal investigator',true],['awardStatus','Award status',true,'select',['Awarded','Announced','Renewed']],['amount','Award amount',false,'number'],['currency','Currency',false,'select',['USD','EUR','GBP','CAD','Other']],['amountPermission','May the amount be published?',false,'select',['Not specified','Yes','No']],['collaborators','Co-investigators / collaborators',false],['projectDates','Project dates',false]] },
  { id:'milestone', name:'Student milestone', short:'Student milestone', icon:'cap', tone:'purple', fields:[['student','Student name',true],['milestone','Milestone',true,'select',['Degree completed','Successful defense','Commencement','Other achievement']],['program','Degree / program',true],['advisor','Faculty adviser',true],['thesis','Thesis or dissertation title',false],['destination','Next destination',false]] },
  { id:'award', name:'Award & recognition', short:'Award', icon:'star', tone:'gold', fields:[['recipient','Recipient',true],['award','Award name',true],['organization','Awarding organization',true],['significance','Why this recognition matters',false,'textarea']] },
  { id:'talk', name:'Conference & invited talk', short:'Presentation', icon:'mic', tone:'rose', fields:[['presenter','Presenter',true],['talkTitle','Presentation title',true],['host','Meeting or host',true],['presentationType','Presentation type',true,'select',['Invited talk','Contributed talk','Poster','Keynote','Other']],['location','Location',false]] },
  { id:'outreach', name:'Outreach & engagement', short:'Outreach', icon:'people', tone:'green', fields:[['activity','Activity title',true],['organizers','Organizers',true],['audience','Audience',true],['partners','Community partners',false],['impact','Impact / attendance',false]] },
  { id:'media', name:'Media coverage', short:'Media', icon:'globe', tone:'blue', fields:[['featured','Person or research featured',true],['outlet','Media outlet',true],['coverageTitle','Coverage headline',true],['coverageLink','Coverage URL',false,'url']] },
  { id:'event', name:'Department announcement', short:'Announcement', icon:'calendar', tone:'green', fields:[['announcementType','Announcement type',true,'select',['Event','Appointment','Department update','Other']],['people','People involved',true],['location','Location',false],['eventTime','Time and timezone',false],['registration','Registration URL',false,'url']] },
  { id:'other', name:'Other news', short:'Other', icon:'spark', tone:'neutral', fields:[['people','People involved',true],['context','Additional context',false,'textarea']] },
];
export const statuses = ['Draft','Submitted','In review','Changes requested','Approved','Published','Archived'];
export const category = id => categories.find(c => c.id === id) || categories.at(-1);
export const uid = () => crypto.randomUUID();
export const maxPublications = 10;
export const maxSubmissionImageBytes = 30 * 1024 * 1024;
export function emptyPublication() {
  return {id:uid(),paperTitle:'',authors:'',venue:'',publicationStatus:'',doi:'',abstract:'',publicationDate:'',officeComments:'',moreInformation:''};
}
export function publicationDetailFields(publicationOnly=false) {
  return category('publication').fields.filter(([key])=>!publicationOnly||key!=='officeComments');
}
// Existing single-paper records remain valid; their details are the first paper.
export function publicationEntries(s) {
  return s.category==='publication' ? [{...s.details,id:'primary'},...(s.additionalPublications || [])] : [];
}
export const imagePublicationId = image => image.publicationId || 'primary';
export function removePublication(s,id) {
  if(id==='primary')return;
  s.additionalPublications=(s.additionalPublications || []).filter(p=>p.id!==id);
  s.images=s.images.filter(image=>imagePublicationId(image)!==id);
}
export function emptySubmission() {
  return {id:uid(),reference:'',status:'Draft',category:'publication',headline:'',summary:'',newsDate:'',submitter:'',email:'',group:'',link:'',details:{},images:[],release:'ready',embargo:'',notes:'',permission:false,channels:['Newsletter','Department website'],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[],editorNotes:'',publishedUrl:'',publishedAt:'',sample:false};
}
export function validateSubmission(s, step = null) {
  const errors = {};
  const required=(key,value,label)=>{if(!String(value || '').trim())errors[key]=`${label} is required.`;};
  if (step === null || step === 0) {
    if (!categories.some(c=>c.id===s.category)) errors.category='Choose a news category.';
    required('submitter',s.submitter,'Your name'); required('group',s.group,'Research group');
  }
  if (step === null || step === 1) {
    required('headline',s.headline,'Headline'); required('summary',s.summary,'Summary'); required('newsDate',s.newsDate,'News date');
    if(s.newsDate && (!/^\d{4}-\d{2}-\d{2}$/.test(s.newsDate) || Number.isNaN(Date.parse(s.newsDate))))errors.newsDate='Choose a valid news date.';
    if(s.headline?.length>180) errors.headline='Keep the headline under 180 characters.';
    if(s.summary?.length>6000) errors.summary='Keep the summary under 6,000 characters.';
    for(const [key,label,needed,type] of category(s.category).fields) {
      if(needed)required(`details.${key}`,s.details?.[key],label);
      if(type==='url' && s.details?.[key] && !safeUrl(s.details[key]))errors[`details.${key}`]='Use a complete https:// or http:// URL.';
    }
    if(s.category==='publication') {
      const publications=publicationEntries(s);
      if(publications.length>maxPublications)errors.publications=`Use up to ${maxPublications} publications per submission.`;
      const ids=publications.map(p=>p.id);
      if(ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(ids).size!==ids.length)errors.publications='Publication identifiers must be unique.';
      publications.forEach((paper,index)=>{
        const prefix=index===0?'details':`additionalPublications.${index-1}`;
        for(const [key,label,needed] of category('publication').fields)if(needed)required(`${prefix}.${key}`,paper[key],label);
        for(const key of ['officeComments','moreInformation'])if(paper[key]?.length>6000)errors[`${prefix}.${key}`]='Keep this field under 6,000 characters.';
        if(paper.publicationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(paper.publicationDate)||Number.isNaN(Date.parse(paper.publicationDate))))errors[`${prefix}.publicationDate`]='Choose a valid publication date.';
      });
    }
    if(s.link && !safeUrl(s.link))errors.link='Use a complete https:// or http:// URL.';
  }
  if(step === null || step === 2) {
    if(!['ready','embargo','contact'].includes(s.release))errors.release='Choose a release preference.';
    if(s.release==='embargo' && (!s.embargo || Number.isNaN(new Date(s.embargo).getTime())))errors.embargo='Choose an embargo date and time.';
    const papers=publicationEntries(s);
    if(s.category!=='publication' && s.images?.length>3)errors.images='You can upload up to three images.';
    if(papers.some(p=>(s.images || []).filter(i=>imagePublicationId(i)===p.id).length>3))errors.images='You can upload up to three images per publication.';
    if((s.images || []).reduce((total,i)=>total+(Number(i.size)||0),0)>maxSubmissionImageBytes)errors.images='Keep all images in one submission within 30 MB.';
    (s.images || []).forEach((image,i)=>{
      if(s.category==='publication' && !papers.some(p=>p.id===imagePublicationId(image)))errors.images='An image is assigned to a publication that is no longer in this submission.';
      for(const [key,label] of [['caption','Caption'],['credit','Credit'],['alt','Alternative text']])if(!image[key]?.trim())errors[`image.${i}.${key}`]=`${label} is required for this image.`;
      if(!['cleared','pending'].includes(image.rights))errors[`image.${i}.rights`]='Choose the image permission status.';
    });
  }
  if((step === null || step === 3) && !s.permission)errors.permission='Confirm the accuracy and permission statement before submitting.';
  return errors;
}
export function releaseEligible(s, now = Date.now()) {
  return ['Approved','Published'].includes(s.status) && (s.release==='ready' || (s.release==='embargo' && s.embargo && Date.parse(s.embargo)<=now)) && (s.images || []).every(i=>i.rights==='cleared');
}
export function releaseLabel(s) {
  if(s.release==='contact')return 'Contact before release';
  if(s.release==='embargo' && Date.parse(s.embargo)>Date.now())return 'Embargoed';
  if((s.images || []).some(i=>i.rights!=='cleared'))return 'Image permission pending';
  return 'Ready for consideration';
}
export function safeUrl(value) {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function escapeHtml(v) {return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function demoSubmissions() {
  const day = n => {const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);};
  const examples=[
    ['publication','A new catalyst brings greener chemistry a step closer','Morgan Research Group','Dr. Alex Morgan','Submitted',2,'A reusable catalyst offers a more energy-efficient route to making useful organic molecules. The research team demonstrated improved selectivity under mild conditions, opening possibilities for more sustainable chemical synthesis.',{paperTitle:'Selective catalysis under mild conditions: a reusable molecular approach',authors:'A. Morgan, J. Patel, S. Kim',venue:'Example Journal of Chemistry',publicationStatus:'Published',abstract:'This fictional example demonstrates how a technical abstract is stored alongside a public-facing summary.'}],
    ['grant','New funding advances research in clean-energy materials','Chen Research Group','Dr. Taylor Chen','In review',3,'A newly awarded research grant will support a collaborative investigation of materials for next-generation energy storage and provide training opportunities for graduate researchers.',{projectTitle:'Molecular design for sustainable energy storage',funder:'Example Research Foundation',investigator:'Taylor Chen',awardStatus:'Awarded',amount:'450000',currency:'USD',amountPermission:'Yes'}],
    ['milestone','Celebrating a new PhD in analytical chemistry','Rivera Research Group','Dr. Sam Rivera','Approved',4,'Jordan Ellis has completed a doctoral degree in analytical chemistry. Their dissertation explored new approaches to detecting trace contaminants in water.',{student:'Jordan Ellis',milestone:'Degree completed',program:'PhD, Analytical Chemistry',advisor:'Sam Rivera',thesis:'New approaches to trace contaminant analysis'}],
    ['award','Recognizing excellence in undergraduate mentorship','Department of Chemistry','Dr. Casey Lee','Submitted',5,'The department celebrates a faculty mentoring award recognizing sustained support for undergraduate research, inclusive laboratory experiences, and student development.',{recipient:'Casey Lee',award:'Excellence in Mentoring',organization:'Example University'}],
    ['outreach','Opening the lab doors to the next generation','Chemistry Outreach Team','Dr. Jamie Brooks','Published',7,'Local students explored the science of color, materials, and energy during a hands-on chemistry workshop led by faculty and graduate student volunteers.',{activity:'Discover Chemistry Day',organizers:'Chemistry Outreach Team',audience:'Local secondary-school students',impact:'Hands-on activities and conversations with researchers'}],
    ['publication','Mapping molecular interactions in solution','Patel Research Group','Dr. Robin Patel','Draft',1,'An upcoming research story about molecular interactions and new spectroscopy methods.',{paperTitle:'Molecular interactions in complex solutions',authors:'R. Patel and colleagues',venue:'Example Chemistry Letters',publicationStatus:'Accepted'}],
  ];
  return examples.map((e,i)=>({...emptySubmission(),id:`demo-${i+1}`,reference:`DEMO-${String(i+1).padStart(3,'0')}`,category:e[0],headline:e[1],group:e[2],submitter:e[3],email:`example${i+1}@example.edu`,status:e[4],createdAt:day(e[5])+'T12:00:00.000Z',updatedAt:day(e[5])+'T12:00:00.000Z',newsDate:day(e[5]),summary:e[6],details:e[7],permission:true,sample:true,history:[{status:e[4],at:day(e[5])+'T12:00:00.000Z',actor:'Sample editor'}]}));
}
