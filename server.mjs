import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createOfficeAuth} from './office-auth.mjs';
import {createPortalStore} from './portal-store.mjs';
const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json' };
const port = Number(process.env.PORT || 4173);
const officeAuth=await createOfficeAuth({credentialPath:fileURLToPath(new URL('./.local/office-password.json',import.meta.url))});
const portal=await createPortalStore({directory:fileURLToPath(new URL('./.local/',import.meta.url)),officeAuth});
createServer(async (req, res) => {
  try {
    if(await portal.handle(req,res))return;
    if(await officeAuth.handle(req,res))return;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root.replace(/\/$/, '') + sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain' }); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Chemistry Newsroom preview: http://127.0.0.1:${port}`));
