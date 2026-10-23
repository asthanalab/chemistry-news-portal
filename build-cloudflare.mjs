import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
const config=await readFile('public/config.js','utf8');
await writeFile('dist/config.js',config.replace("mode: 'server'","mode: 'cloudflare'"));
await writeFile('dist/_headers',[
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  X-Frame-Options: DENY',
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
  '  Cache-Control: no-cache', ''
].join('\n'));
console.log('Prepared static assets in dist. No private data is included.');
