// Local login: a break-glass path for viewing the *last real, actually-collected*
// snapshot from this device when Microsoft sign-in itself isn't working (Entra
// down, network blocked, broken consent, etc.) - distinct from Demo mode
// (src/demoMode.js, src/demoData.js), which is always fabricated sample data and
// never claims to be real. This is real (if stale) tenant data, clearly labeled as
// such, gated by a locally-configured password.
//
// Threat model, stated plainly: this is a client-side password check against a
// hash baked into the built JS at deploy time (VITE_LOCAL_LOGIN_PASSWORD_HASH).
// Anyone with browser devtools access to this origin can inspect the hash and
// brute-force it offline, or read the cached snapshot directly out of
// localStorage without the password at all. It is NOT a substitute for real
// authentication or a security boundary against a determined local attacker -
// it exists purely to avoid a blank screen during an outage/demo, for a device
// an admin already controls. Don't rely on it to gate anything an unauthenticated
// person on this machine shouldn't see.
const LOCAL_LOGIN_KEY='iam_local_login_mode';

export function isLocalLoginConfigured(){
  return Boolean(import.meta.env.VITE_LOCAL_LOGIN_PASSWORD_HASH);
}

export async function verifyLocalPassword(password){
  const expected=(import.meta.env.VITE_LOCAL_LOGIN_PASSWORD_HASH||'').trim().toLowerCase();
  if(!expected||!password)return false;
  const bytes=new TextEncoder().encode(password);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return hex===expected;
}

export const isLocalLoginMode=()=>{try{return sessionStorage.getItem(LOCAL_LOGIN_KEY)==='true';}catch{return false;}};
export function enterLocalLoginMode(){try{sessionStorage.setItem(LOCAL_LOGIN_KEY,'true');}catch{/* ignore private-mode/quota errors - mode still applies for this page load */}}
export function exitLocalLoginMode(){try{sessionStorage.removeItem(LOCAL_LOGIN_KEY);}catch{/* ignore */}window.location.reload();}
