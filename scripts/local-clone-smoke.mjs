// Verify real local Auth/RLS/workspace routing without resetting passwords,
// creating dummy users or sending email. All access is fixed to local Supabase.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {APP_PORT,PROJECT_ID,cleanEnvironment,assertLocalUrl,assertLoopbackBindings} from './local-supabase-lib.mjs';

const state=JSON.parse(await readFile(new URL('../.local/clone-state.json',import.meta.url),'utf8'));
if(state.mode!=='production-snapshot')throw new Error('A verified activated local clone is required');
const env=cleanEnvironment();
const info=JSON.parse(execFileSync('supabase',['status','--workdir','.local','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assertLocalUrl(info.API_URL);
const inspected=JSON.parse(execFileSync('docker',['inspect',`supabase_db_${PROJECT_ID}`],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(inspected[0].Config.Labels['com.supabase.cli.project']!==PROJECT_ID)throw new Error('Wrong local Docker project');
assertLoopbackBindings(inspected);
const admin=createClient(info.API_URL,info.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar=new Map();
const user=createServerClient(info.API_URL,info.ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{for(const {name,value} of values)jar.set(name,value);}}});
const origin=`http://127.0.0.1:${APP_PORT}`;
let originalProfile,modified=false,session;
const fail=message=>{throw new Error(message);};
async function request(route,options={}) {
  const response=await fetch(origin+route,{...options,redirect:'manual',headers:{Origin:origin,Cookie:[...jar].map(([name,value])=>`${name}=${encodeURIComponent(value)}`).join('; '),...(options.headers || {})},signal:AbortSignal.timeout(60000)});
  for(const cookie of response.headers.getSetCookie()) {
    const match=cookie.match(/^([^=]+)=([^;]*)/);if(match)jar.set(match[1],decodeURIComponent(match[2]));
  }
  return response;
}
try {
  const profile=await admin.from('profiles').select('id,active_workspace_id').eq('role','owner').limit(1).single();
  if(profile.error)fail('No existing owner profile available for local verification');
  originalProfile=profile.data;
  const account=await admin.auth.admin.getUserById(profile.data.id);
  if(account.error || !account.data.user.email)fail('Cannot read existing local owner Auth account');
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:account.data.user.email});
  if(link.error)fail(`Local Auth link generation failed: ${link.error.message}`);
  const login=await user.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
  if(login.error)fail(`Local Auth verification failed: ${login.error.message}`);
  session=login.data.session;
  const bootstrapResponse=await request('/api/workspaces');
  if(bootstrapResponse.status!==200)fail(`Workspace bootstrap HTTP ${bootstrapResponse.status}`);
  const bootstrap=await bootstrapResponse.json();
  if(!bootstrap.isPlatformOwner || bootstrap.workspaces.length!==2)fail('Existing owner workspace access does not match expected source workspaces');
  const results=[];
  for(const workspace of bootstrap.workspaces) {
    const switched=await request('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:workspace.id})});
    modified=true;
    if(switched.status!==200)fail(`Workspace switching HTTP ${switched.status}`);
    const value=await switched.json();
    if(value.activeWorkspace.id!==workspace.id)fail('Workspace switch did not select the requested workspace');
    const brands=await user.from('brands').select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id);
    if(brands.error)fail('Authenticated local RLS/brands query failed');
    const dashboard=await request('/dashboard');
    if(dashboard.status!==200)fail(`Real dashboard HTTP ${dashboard.status}`);
    const page=await dashboard.text();
    if(page.includes('Internal Server Error'))fail('Dashboard rendering failed');
    let growth;
    if(workspace.settings?.growth_execution_enabled===true) {
      const response=await request('/dashboard/growth-work?tab=overview');
      const html=await response.text();
      if(response.status!==200 || !html.includes('Growth Execution') || html.includes('Internal Server Error'))fail('Growth route did not render successfully');
      const records=await user.from('growth_records').select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id);
      if(records.error)fail(`Authenticated Growth RLS failed: ${records.error.message}`);
      growth={rendered:true,records:records.count};
    }
    results.push({workspace:workspace.slug,workspaceSwitch:true,authenticatedBrands:brands.count,realDashboard:true,growth});
  }
  console.log(JSON.stringify({healthy:true,app:origin,existingOwnerAuth:true,workspaces:results,passwordReset:false,dummyUsersCreated:0,productionWrites:0},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally {
  if(modified && originalProfile) {
    const restored=await admin.from('profiles').update({active_workspace_id:originalProfile.active_workspace_id}).eq('id',originalProfile.id);
    if(restored.error){console.error('Could not restore the local owner workspace preference');process.exitCode=1;}
  }
  if(session)await user.auth.signOut({scope:'local'});
}
