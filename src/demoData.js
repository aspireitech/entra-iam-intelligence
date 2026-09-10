// Static sample data for "Demo mode" - lets someone see the full dashboard with
// no Microsoft Entra sign-in at all, e.g. when Entra/Graph is down, before an app
// registration exists, or just to preview the product. Shaped identically to
// entraAuth.js's getTenantSnapshot() return value (same field names) so every
// page that reads `data.*` renders exactly as it would against a real tenant -
// nothing here is "demo-only" UI, it's the same components fed fabricated numbers.
// Nothing in this file makes a network call.

const now=Date.now();
const daysAgo=n=>new Date(now-n*86400000).toISOString();
const daysFromNow=n=>new Date(now+n*86400000).toISOString();

function range(n){return Array.from({length:n},(_,i)=>i);}

const FIRST_NAMES=['Alex','Jordan','Taylor','Morgan','Casey','Riley','Sam','Jamie','Drew','Avery','Cameron','Reese','Skyler','Quinn','Rowan','Charlie'];
const LAST_NAMES=['Nguyen','Patel','Garcia','Smith','Kim','Johnson','Chen','Brown','Davis','Rossi','Müller','Andersen','Silva','Kowalski','Haddad','Novak'];
function personName(i){return `${FIRST_NAMES[i%FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i/FIRST_NAMES.length)%LAST_NAMES.length]}`;}
function upn(i){return `${personName(i).toLowerCase().replace(' ','.')}@contoso-demo.onmicrosoft.com`;}

function buildUsers(){
  const total=248;
  const mfaMissingCount=38;
  const staleCount=19;
  const withoutManagerCount=14;
  const guestCount=17;
  const list=range(total).map(i=>({
    id:`demo-user-${i}`,name:personName(i),upn:upn(i),
    enabled:i%37!==0,
    lastSignIn:i%7===0?null:daysAgo(i%120),
  }));
  const mfaMissingUsers=range(mfaMissingCount).map(i=>({id:`demo-user-${i}`,name:personName(i),upn:upn(i)}));
  const staleUserList=range(staleCount).map(i=>{const idx=total-1-i;return {id:`demo-user-${idx}`,name:personName(idx),upn:upn(idx),lastSignIn:daysAgo(90+i*3)};});
  const usersWithoutManagerList=range(withoutManagerCount).map(i=>{const idx=140+i;return {id:`demo-user-${idx}`,name:personName(idx),upn:upn(idx)};});
  const guestList=range(guestCount).map(i=>({id:`demo-guest-${i}`,name:`${personName(i+50)} (Guest)`,upn:`guest${i}_partnerco.com#EXT#@contoso-demo.onmicrosoft.com`,enabled:true,lastSignIn:i%5===0?null:daysAgo(i*10)}));
  return {total,mfaMissingCount,staleCount,withoutManagerCount,list,mfaMissingUsers,staleUserList,usersWithoutManagerList,guestList};
}

function buildGroups(){
  const types=[['Security',20],['Microsoft 365',12],['Mail-Enabled Security',5],['Distribution',5]];
  let i=0;const groupList=[];
  for(const [type,count] of types){
    for(let n=0;n<count;n++){
      const dynamic=type!=='Distribution'&&i%7===0;
      groupList.push({
        id:`demo-group-${i}`,
        name:`${type==='Microsoft 365'?'Team':type==='Distribution'?'DL':type==='Mail-Enabled Security'?'MES':'SG'} - ${['Finance','Engineering','Sales','HR','IT Ops','Marketing','Legal','Support','Design','Product'][i%10]} ${Math.floor(i/10)+1}`,
        type,
        dynamic,
        onPremSynced:i%3===0,
        membershipRule:dynamic?`(user.department -eq "${['Finance','Engineering','Sales'][i%3]}")`:null,
      });
      i++;
    }
  }
  return groupList;
}

function buildDevices(){
  // Deliberately mirrors a common real-world shape: most devices report no
  // compliance state at all (not enrolled in Intune/another MDM) rather than an
  // explicit pass/fail - that's the "Unknown" bucket the Devices page now charts.
  const OS=[['Windows','10.0.19045'],['Windows','10.0.22631'],['macOS','14.5'],['iOS','17.5'],['Android','14']];
  return range(13).map(i=>{
    const [os,osVersion]=OS[i%OS.length];
    const compliant=i===0?true:i===1?false:null;
    return {id:`demo-device-${i}`,name:`${os==='Windows'?'DESKTOP':os==='macOS'?'MBP':os==='iOS'?'iPhone':'PIXEL'}-${1000+i}`,os,osVersion,trustType:i%2===0?'Azure AD joined':'Hybrid Azure AD joined',compliant,enabled:true,lastSignIn:daysAgo(i*4)};
  });
}

function buildApplications(){
  const total=57;
  const buckets=[['active',31,0],['31-90',10,45],['91-180',9,120],['180+',7,260]];
  const appDetails=[];let idx=0;
  for(const [bucket,count,baseDays] of buckets){
    for(let n=0;n<count;n++){
      appDetails.push({appId:`demo-app-${idx}`,name:`${['Internal Portal','Payroll Sync','CRM Connector','Reporting Bot','CI/CD Runner','Legacy Ticketing','Vendor Integration','Data Pipeline','Support Widget','Mobile Backend'][idx%10]} ${Math.floor(idx/10)+1}`,bucket,days:bucket==='active'?n:baseDays+n});
      idx++;
    }
  }
  // A handful of credentials, including a few already expired so the Expired
  // Secrets/Expired Certs KPIs on the Applications page have something to show.
  const credentialItems=[
    {name:appDetails[0].name,appId:appDetails[0].appId,type:'secret',daysRemaining:-14,expiresAt:daysAgo(14)},
    {name:appDetails[2].name,appId:appDetails[2].appId,type:'secret',daysRemaining:-3,expiresAt:daysAgo(3)},
    {name:appDetails[5].name,appId:appDetails[5].appId,type:'certificate',daysRemaining:-40,expiresAt:daysAgo(40)},
    {name:appDetails[7].name,appId:appDetails[7].appId,type:'secret',daysRemaining:5,expiresAt:daysFromNow(5)},
    {name:appDetails[9].name,appId:appDetails[9].appId,type:'certificate',daysRemaining:12,expiresAt:daysFromNow(12)},
    {name:appDetails[11].name,appId:appDetails[11].appId,type:'secret',daysRemaining:27,expiresAt:daysFromNow(27)},
    {name:appDetails[13].name,appId:appDetails[13].appId,type:'secret',daysRemaining:60,expiresAt:daysFromNow(60)},
    {name:appDetails[15].name,appId:appDetails[15].appId,type:'certificate',daysRemaining:180,expiresAt:daysFromNow(180)},
  ].sort((a,b)=>a.daysRemaining-b.daysRemaining);
  return {
    total,
    appDetails,
    appActivity:{active30:31,inactive31to90:10,inactive91to180:9,inactive180:7},
    inactiveApps:appDetails.filter(a=>a.bucket!=='active').sort((a,b)=>b.days-a.days).slice(0,10),
    credentialItems,
    expiredSecrets:credentialItems.filter(c=>c.daysRemaining<0&&c.type==='secret').length,
    expiredCerts:credentialItems.filter(c=>c.daysRemaining<0&&c.type==='certificate').length,
    expiringSoon:credentialItems.filter(c=>c.daysRemaining<=30).length,
  };
}

export function buildDemoSnapshot(){
  const users=buildUsers();
  const groupList=buildGroups();
  const deviceList=buildDevices();
  const apps=buildApplications();
  const cloudOnlyGroups=groupList.filter(g=>!g.onPremSynced).length;
  const onPremSyncGroups=groupList.filter(g=>g.onPremSynced).length;
  const dynamicGroups=groupList.filter(g=>g.dynamic).length;
  const riskyUserList=range(4).map(i=>({id:`demo-user-${200+i}`,name:personName(200+i),riskLevel:i===0?'high':'medium',riskState:'atRisk',riskLastUpdated:daysAgo(i+1)}));
  const privilegedIds=range(9).map(i=>`demo-user-${i*20}`);
  const toxicCombinations=[
    {id:privilegedIds[0],name:personName(0),flags:['No MFA','Risky sign-in (ID Protection)'],nonHuman:false},
    {id:privilegedIds[3],name:personName(60),flags:['Stale 90+ days'],nonHuman:false},
    {id:'demo-sp-1',name:'Legacy Deployment Automation',flags:['No MFA'],nonHuman:true},
  ];
  const privilegedServicePrincipals=[{id:'demo-sp-1',name:'Legacy Deployment Automation',appId:'demo-app-1',type:'Application'},{id:'demo-sp-2',name:'Nightly Backup Service',appId:'demo-app-2',type:'ManagedIdentity'}];
  const signInTrend=range(7).map(i=>({date:new Date(now-(6-i)*86400000).toISOString().slice(0,10),total:1200+Math.round(Math.sin(i)*180)+i*30}));
  const recentSignIns=range(8).map(i=>({id:`demo-signin-${i}`,createdDateTime:daysAgo(i*0.3),userDisplayName:personName(i),userPrincipalName:upn(i),appDisplayName:['Microsoft 365','Salesforce','Internal Portal','GitHub Enterprise'][i%4],isInteractive:true,status:{errorCode:i===3?50126:0},riskLevelAggregated:i===1?'medium':'none'}));
  const ownerlessApps=range(6).map(i=>({name:apps.appDetails[i*5].name,appId:apps.appDetails[i*5].appId}));

  return {
    source:'entra',dataSource:'demo',
    organization:{id:'11111111-2222-3333-4444-555555555555',displayName:'Contoso Demo Tenant (Sample Data)',verifiedDomains:[{name:'contoso-demo.onmicrosoft.com'}]},
    applications:apps.total,users:users.total,groups:groupList.length,devices:deviceList.length,
    signIns7d:1840,riskySignIns7d:6,
    groupsAvailable:true,groupList,cloudOnlyGroups,onPremSyncGroups,dynamicGroups,
    appActivity:apps.appActivity,appPopulation:apps.total,inactiveApps:apps.inactiveApps,appDetails:apps.appDetails,
    appActivityAvailable:true,appActivityReason:null,
    recentSignIns,signInTrend,signInsAvailable:true,signInsReason:null,failedSignIns7d:31,
    usageAnalytics:{
      available:true,reason:null,windowDays:7,totalSignIns:1840,truncated:false,
      apps:[{name:'Microsoft 365',value:612},{name:'Salesforce',value:388},{name:'Internal Portal',value:301},{name:'GitHub Enterprise',value:244},{name:'Zoom',value:180},{name:'Slack',value:115}],
      resources:[{name:'Microsoft Graph',value:940},{name:'Office 365 Exchange Online',value:520},{name:'SharePoint Online',value:210},{name:'Azure Storage',value:98},{name:'Windows Azure Service Management API',value:72}],
      users:range(6).map(i=>({name:personName(i),value:120-i*14})),
    },
    mfa:{registered:users.total-users.mfaMissingCount,missing:users.mfaMissingCount,observed:users.total,missingUsers:users.mfaMissingUsers},
    staleUsers:users.staleCount,staleUserList:users.staleUserList,
    userActivityAvailable:true,userActivityList:users.list,
    usersWithoutManager:users.withoutManagerCount,usersWithoutManagerList:users.usersWithoutManagerList,
    toxicCombinations,toxicCombinationsAvailable:true,toxicCombinationsCount:toxicCombinations.length,
    riskyUsers:riskyUserList.length,riskyUsersAvailable:true,riskyUsersReason:null,riskyUserList,
    privilegedUsers:privilegedIds.length,privilegedUsersAvailable:true,
    conditionalAccessPolicies:8,conditionalAccessAvailable:true,
    conditionalAccessPolicyList:range(8).map(i=>({id:`demo-ca-${i}`,name:['Require MFA for admins','Block legacy authentication','Require MFA for all users','Require compliant device','Session controls for guests','Block risky sign-ins','Require MFA for Azure mgmt','Named locations - trusted IPs'][i],state:i===7?'disabled':'enabled',requiresMfa:i!==1&&i!==7,targetsAllUsers:i===2,excludedUserCount:i===0?2:0})),
    mfaCoverageAllUsers:false,
    privilegedAccess:{available:true,activeCount:privilegedIds.length,eligibleCount:14,eligibleNotActive:range(5).map(i=>({id:`demo-user-${300+i}`,name:personName(300+i)})),activeNotEligible:range(3).map(i=>({id:privilegedIds[i],name:personName(i*20)})),activeList:privilegedIds.map(id=>({id,name:personName(Number(id.split('-')[2]))})),eligibleList:range(14).map(i=>({id:`demo-user-${310+i}`,name:personName(310+i)}))},
    guests:{available:true,total:users.guestCount,memberCount:users.total-users.guestCount,staleCount:4,list:users.guestList},
    legacyAuth:{available:true,signIns7d:3,signIns30d:11,reason:null,sample:range(3).map(i=>({id:`demo-legacy-${i}`,user:personName(i+9),app:'Exchange Online',clientAppUsed:'IMAP4',createdDateTime:daysAgo(i+1),success:i!==0}))},
    onboarding:{
      users:{last24h:1,last7d:4,last30d:12,last6mo:47},
      guests:{last24h:0,last7d:1,last30d:3,last6mo:9},
      devices:{last24h:2,last7d:6,last30d:19,last6mo:63},
      groups:{last24h:0,last7d:2,last30d:5,last6mo:22},
      applications:{last24h:0,last7d:1,last30d:3,last6mo:14},
    },
    credentialExpiry:{available:true,items:apps.credentialItems,expiringSoon:apps.expiringSoon,expiringWithin90:apps.credentialItems.filter(c=>c.daysRemaining>30&&c.daysRemaining<=90).length,expiredSecrets:apps.expiredSecrets,expiredCerts:apps.expiredCerts},
    applicationList:apps.appDetails.map(a=>({id:a.appId,appId:a.appId,name:a.name})),
    deviceList,
    healthScore:72,healthInputs:{},healthContributors:[{key:'mfa',label:'MFA Adoption',score:78},{key:'stale',label:'Stale Accounts',score:66},{key:'privileged',label:'Privileged Access',score:70},{key:'credentials',label:'Credential Hygiene',score:58}],healthExcludedSignals:[],
    permissions:[{name:'User.Read.All',status:'granted',detail:'Demo data - not a live permission check'},{name:'Application.Read.All',status:'granted',detail:'Demo data'},{name:'Group.Read.All',status:'granted',detail:'Demo data'},{name:'Device.Read.All',status:'granted',detail:'Demo data'},{name:'AuditLog.Read.All',status:'granted',detail:'Demo data'}],
    securityPermissionReady:true,
    nonHumanIdentities:{available:true,totalServicePrincipals:612,managedIdentities:22,appRegistrations:apps.total,credentialBearing:44,ownerlessCount:ownerlessApps.length,ownerlessApps,privilegedCount:privilegedServicePrincipals.length,privilegedList:privilegedServicePrincipals},
    collectedAt:new Date().toISOString(),
    coreQueryFailures:[],
  };
}
