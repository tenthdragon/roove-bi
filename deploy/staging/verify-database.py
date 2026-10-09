#!/usr/bin/env python3
import pathlib,json,subprocess
base=pathlib.Path('/opt/roove-staging')
baseline=json.loads((base/'baseline.json').read_text())
def quote(s): return '"'+s.replace('"','""')+'"'
parts=[]
for key in baseline:
 schema,name=key.split('.',1)
 parts.append("SELECT '"+key+"' AS name,count(*) AS total FROM "+quote(schema)+'.'+quote(name))
sql='SELECT json_object_agg(name,total) FROM ('+' UNION ALL '.join(parts)+') q;'
cmd=['docker','exec','roove-staging-db-1','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U supabase_admin -d roove_staging -At -c "$1"','staging',sql]
actual=json.loads(subprocess.run(cmd,text=True,capture_output=True,check=True).stdout)
differences={k:{'local':v,'staging':actual.get(k)} for k,v in baseline.items() if actual.get(k)!=v}
report={'verifiedTables':len(baseline),'countDifferences':differences}
(base/'verification.json').write_text(json.dumps(report,indent=2)+'\n');(base/'verification.json').chmod(0o600)
print(json.dumps(report))
if differences: raise SystemExit(1)
