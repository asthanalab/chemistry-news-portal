// Compress oversized supported images locally. Original files never leave the
// contributor's device; the server independently enforces the final 10 MiB cap.
export async function prepareImage(file,limit=10*1048576){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use JPG, PNG, or WebP.');
  if(file.size<=limit)return {file,compressed:false};
  if(file.size>50*1048576)throw new Error('This image is too large to resize safely here. Resize it below 50 MB first; the uploaded copy must be below 10 MB.');
  let bitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw new Error('This image could not be read. Choose another JPG, PNG, or WebP.');}
  try{
    if(bitmap.width*bitmap.height>120000000)throw new Error('This image has very large dimensions. Resize it before uploading.');
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context)throw new Error('This browser cannot compress images. Choose a file below 10 MB.');
    for(let edge=4096;edge>=1024;edge=Math.floor(edge*.75)){
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      // Prefer lossless PNG for figures; use WebP only if PNG is still too large.
      const formats=file.type==='image/png'?[['image/png',1],['image/webp',.92],['image/webp',.82]]:[['image/webp',.92],['image/webp',.82],['image/webp',.72]];
      for(const [type,quality] of formats){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,quality));
        if(blob&&blob.size<=limit){
          const extension=blob.type==='image/png'?'png':blob.type==='image/jpeg'?'jpg':'webp';
          return {file:new File([blob],file.name.replace(/\.[^.]+$/,'')+'.'+extension,{type:blob.type}),compressed:true};
        }
      }
    }
    throw new Error('This image could not be reduced below 10 MB. Please choose a smaller copy.');
  }finally{bitmap.close();}
}
