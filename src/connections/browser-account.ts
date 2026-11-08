import type { BrowserAccountIdentity } from '../workspace/model.js';
import { AppError } from '../workspace/util.js';

function valid(value: unknown): value is BrowserAccountIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(',') === 'email,source,userId' && v.source === 'chatgpt-session' &&
    typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= 200 && !/[\s\u0000-\u001f\u007f]/.test(v.userId) &&
    typeof v.email === 'string' && v.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email);
}
export function validateAccountIdentity(value: unknown, url: string): BrowserAccountIdentity {
  let target: URL; try { target = new URL(url); } catch { throw new AppError('browser_account_identity_invalid'); }
  if (target.origin !== 'https://chatgpt.com' || target.username || target.password || !valid(value)) throw new AppError('browser_account_identity_invalid');
  return { source: value.source, userId: value.userId, email: value.email };
}
export function sameAccountIdentity(a: unknown, b: unknown): boolean {
  return valid(a) && valid(b) && a.userId === b.userId && a.email === b.email;
}

// Runs only inside the selected Chrome page. No cookie, token or full response
// is returned to MCP/the app. This observed web path is not a public API contract.
export function accountIdentityScript(): string {
  return `const readAccount=async()=>{
    if(location.origin!=='https://chatgpt.com')return null;
    const endpoint='https://chatgpt.com/api/auth/session';
    try{
      const response=await fetch(endpoint,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});
      if(!response.ok||response.redirected||response.url!==endpoint||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
      const value=await response.json(),u=value?.user;
      if(!u||typeof u.id!=='string'||!u.id.length||u.id.length>200||/[\\s\\u0000-\\u001f\\u007f]/.test(u.id)||
        typeof u.email!=='string'||u.email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(u.email))return null;
      return {source:'chatgpt-session',userId:u.id,email:u.email};
    }catch{return null;}
  };`;
}
export function accountMatchScript(): string {
  return `const account=await readAccount();const accountVerified=!!account&&account.userId===b.accountIdentity.userId&&account.email===b.accountIdentity.email;`;
}
