import './sites-env.mjs';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2);const read=(flag,fallback)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1]??fallback;};
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip',read('--host','127.0.0.1'),'--port',read('--port','5173'),'--inspector-port','0'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));
