#!/usr/bin/env python3
"""Install staging configuration only; production service and release stay intact."""
import pathlib,shutil,subprocess,datetime
source=pathlib.Path('/opt/roove-staging/config')
config=pathlib.Path('/etc/roove-staging');config.mkdir(mode=0o700,exist_ok=True)
for name in ['app.env','network-guard.mjs']:
 shutil.copyfile(source/name,config/name);(config/name).chmod(0o600 if name=='app.env' else 0o644)
# The service user must read its guard; it cannot read root-only environment files.
config.chmod(0o755)
service=pathlib.Path('/etc/systemd/system/roove-bi-staging.service')
backup=pathlib.Path('/opt/roove-staging/backups/host-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S'));backup.mkdir(mode=0o700)
shutil.copyfile(service,backup/'roove-bi-staging.service')
shutil.copyfile(source/'roove-bi-staging.service',service)
nginx=pathlib.Path('/etc/nginx/sites-enabled/roove-bi-staging').resolve()
shutil.copyfile(nginx,backup/'nginx.conf')
text=nginx.read_text()
already_routed = 'location /supabase/auth/v1/' in text
locations=''
for path,upstream in [('auth','172.30.88.3:9999'),('rest','172.30.88.4:3000'),('storage','172.30.88.5:5000')]:
 locations+=f'''    location /supabase/{path}/v1/ {{
        proxy_pass http://{upstream}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120;
        proxy_buffering off;
    }}
'''
locations+='    location /supabase/ { return 404; }\n\n'
if already_routed:
 for old,new in [('127.0.0.1:55431','172.30.88.3:9999'),('127.0.0.1:55432','172.30.88.4:3000'),('127.0.0.1:55433','172.30.88.5:5000')]: text=text.replace(old,new)
else: text=text.replace('    location / {',locations+'    location / {',1)
nginx.write_text(text)
if subprocess.run(['nginx','-t']).returncode:
 shutil.copyfile(backup/'nginx.conf',nginx);shutil.copyfile(backup/'roove-bi-staging.service',service)
 raise SystemExit('Configuration invalid; original files restored.')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','reload','nginx'],check=True)
print('Staging API routing prepared. Staging app service has not been restarted.')
