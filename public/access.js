// The built-in server enforces these rules using signed contributor cookies and
// office password sessions. A role supplied by the browser never grants access.
export const isOffice = user => user?.role === 'editor';
export function canReadRecord(record,user) {
  return isOffice(user) || (user?.role==='contributor' && Boolean(user.sub) && record.status==='Draft' && record.ownerSub===user.sub);
}
export function recordForUser(record,user) {
  if(isOffice(user))return record;
  if(record.status!=='Draft')return {id:record.id,reference:record.reference,status:record.status};
  return {...record,editorNotes:'',original:null,history:[]};
}
export function officeRoute(route) {
  return ['dashboard','archive','settings','story'].includes(route);
}
