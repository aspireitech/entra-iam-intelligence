// Demo mode lets the dashboard render with no Microsoft Entra sign-in at all -
// useful when Entra/Graph is unreachable, before an app registration exists, or
// just to preview the product. sessionStorage (not localStorage) so it clears
// itself when the tab closes rather than silently persisting demo data forever.
const DEMO_KEY='iam_demo_mode';
export const isDemoMode=()=>{try{return sessionStorage.getItem(DEMO_KEY)==='true';}catch{return false;}};
export function enterDemoMode(){try{sessionStorage.setItem(DEMO_KEY,'true');}catch{/* ignore private-mode/quota errors - demo still renders for this page load */}}
export function exitDemoMode(){try{sessionStorage.removeItem(DEMO_KEY);}catch{/* ignore */}window.location.reload();}
