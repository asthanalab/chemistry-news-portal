// Derive a password proof in memory. Neither the password nor this proof is saved.
export async function passwordProof(password,{salt,iterations}){
  if(typeof password!=='string'||password.length<1||password.length>256)throw new Error('Enter your office password.');
  if(!/^[a-f0-9]{48}$/.test(salt)||iterations!==600000)throw new Error('Office password configuration is invalid.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/../g),h=>parseInt(h,16)),iterations,hash:'SHA-256'},key,256);
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
