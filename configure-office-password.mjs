// Run once: node configure-office-password.mjs
// Generates a password and writes only its salted verifier outside public/.
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makeCredential,writeCredential} from './office-auth.mjs';
const password=randomBytes(18).toString('base64url');
const path=fileURLToPath(new URL('./.local/office-password.json',import.meta.url));
await writeCredential(path,makeCredential(password));
console.log(JSON.stringify({password,credentialPath:path}));
