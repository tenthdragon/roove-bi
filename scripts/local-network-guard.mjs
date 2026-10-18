// Preloaded only by dev:local. Preserve copied integration settings, but refuse
// network calls to third-party or production hosts from the local app process.
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';

export function assertLocalRequest(input,options) {
  let url;
  if(typeof input==='string' || input instanceof URL) url=new URL(input);
  else if(input?.url) url=new URL(input.url);
  else {
    const config=input || options || {};
    const host=config.hostname || config.host || 'localhost';
    url=new URL(`${config.protocol || 'http:'}//${host}${config.port?`:${config.port}`:''}`);
  }
  if(!['http:','https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
    throw new Error('Local mode blocks external network requests (including production integrations).');
  }
  return url;
}

if(process.env.ROOVE_LOCAL_DEV==='1') {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=function(input,options) {
    try {assertLocalRequest(input,options);} catch(error) {return Promise.reject(error);}
    return originalFetch.call(this,input,options);
  };
  for(const module of [http,https]) {
    for(const name of ['request','get']) {
      const original=module[name];
      module[name]=function(input,...args) {
        const options=typeof args[0]==='object'?args[0]:undefined;
        // URL input plus options may override its hostname; validate both.
        assertLocalRequest(input,options);
        if(options?.hostname || options?.host) assertLocalRequest(options);
        return original.call(this,input,...args);
      };
    }
  }
  syncBuiltinESMExports();
}
