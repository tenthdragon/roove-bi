import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
const env=Object.fromEntries((await readFile(process.argv[2] || '.local/staging/app.env','utf8')).split('\n').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const origin='https://staging-app.rti-hq.com',url=origin+'/supabase';
if(env.NEXT_PUBLIC_SUPABASE_URL!==url)throw new Error('Refusing non-staging API');
const admin=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar=new Map();
const user=createServerClient(url,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{for(const {name,value} of values)jar.set(name,value);}}});
const ok=(r,label)=>{if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data;};
async function request(route,options={}) {
 const r=await fetch(origin+route,{...options,redirect:'manual',headers:{Origin:origin,Cookie:[...jar].map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('; '),...options.headers},signal:AbortSignal.timeout(60000)});
 for(const cookie of r.headers.getSetCookie()){const m=cookie.match(/^([^=]+)=([^;]*)/);if(m)jar.set(m[1],decodeURIComponent(m[2]));}return r;
}
let profile,changed=false,session,bucket;
try {
 profile=ok(await admin.from('profiles').select('id,active_workspace_id').eq('role','owner').limit(1).single(),'Owner lookup');
 const account=ok(await admin.auth.admin.getUserById(profile.id),'Auth owner lookup').user;
 const link=ok(await admin.auth.admin.generateLink({type:'magiclink',email:account.email}),'Auth link');
 session=ok(await user.auth.verifyOtp({type:'magiclink',token_hash:link.properties.hashed_token}),'Auth login').session;
 ok(await user.auth.refreshSession(),'Auth refresh');
 const bootstrap=await request('/api/workspaces');if(bootstrap.status!==200)throw new Error(`Workspace bootstrap ${bootstrap.status}`);
 const data=await bootstrap.json();if(data.workspaces.length!==2)throw new Error('Workspace count mismatch');
 const results=[];
 for(const w of data.workspaces){
  const switched=await request('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:w.id})});changed=true;
  if(switched.status!==200)throw new Error(`Workspace switch ${switched.status}`);
  const brands=await user.from('brands').select('id',{head:true,count:'exact'}).eq('workspace_id',w.id);ok(brands,'Brands RLS');
  const daily=await user.from('daily_product_summary').select('date,net_sales').eq('workspace_id',w.id).order('date',{ascending:false}).limit(3);ok(daily,'BI read');
  const pages=['/dashboard','/dashboard/marketing','/dashboard/customers','/dashboard/brand-analysis'];if(w.settings?.growth_execution_enabled)pages.push('/dashboard/growth-work');
  for(const p of pages){const r=await request(p),html=await r.text();if(r.status!==200||html.includes('Internal Server Error'))throw new Error(`Page failed ${p}`);if(p.includes('growth')&&!html.includes('P0.1'))throw new Error('P0.1 plan missing');}
  results.push({workspace:w.slug,brands:brands.count,biSampleRows:daily.data.length,pages:pages.length,workspaceWriteVerified:true});
 }
 bucket='staging-smoke-'+Date.now();ok(await admin.storage.createBucket(bucket,{public:false}),'Storage bucket');
 const bytes=Buffer.from('staging smoke test');ok(await admin.storage.from(bucket).upload('probe.txt',bytes,{contentType:'text/plain'}),'Storage upload');
 const file=ok(await admin.storage.from(bucket).download('probe.txt'),'Storage download');if(await file.text()!=='staging smoke test')throw new Error('Storage content mismatch');
 ok(await admin.storage.from(bucket).remove(['probe.txt']),'Storage remove');ok(await admin.storage.deleteBucket(bucket),'Storage bucket remove');bucket=null;
 if(process.env.STAGING_BROWSER_COOKIES)await writeFile(process.env.STAGING_BROWSER_COOKIES,JSON.stringify([...jar].map(([name,value])=>({name,value:encodeURIComponent(value),domain:'staging-app.rti-hq.com',path:'/',secure:true,httpOnly:false,sameSite:'Lax'}))),{mode:0o600});
 console.log(JSON.stringify({healthy:true,existingOwnerAuth:true,sessionRefresh:true,storageRoundTrip:true,workspaces:results,productionWrites:0},null,2));
} finally {
 if(bucket){await admin.storage.from(bucket).remove(['probe.txt']);await admin.storage.deleteBucket(bucket);}
 if(changed&&profile)ok(await admin.from('profiles').update({active_workspace_id:profile.active_workspace_id}).eq('id',profile.id),'Restore workspace preference');
 if(session&&!process.env.STAGING_BROWSER_COOKIES)await user.auth.signOut({scope:'local'});
}
