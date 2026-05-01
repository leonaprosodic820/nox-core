#!/usr/bin/env node
'use strict';
const http = require('http');
const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(os.homedir(), '.prometheus-cli.json');
const BASE_URL = process.env.PROMETHEUS_URL || 'http://localhost:7777';

const C = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', cyan:'\x1b[38;5;51m', blue:'\x1b[38;5;27m',
  purple:'\x1b[38;5;171m', green:'\x1b[38;5;82m', yellow:'\x1b[38;5;220m', red:'\x1b[38;5;196m',
  orange:'\x1b[38;5;208m', gray:'\x1b[38;5;240m', white:'\x1b[38;5;255m' };
const cc = (c, t) => c + t + C.reset;

function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { return { sessionId: 'cli-' + os.hostname(), mode: 'chat', history: [] }; } }
function saveConfig(cfg) { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch(e) {} }

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = new URL(url); const lib = p.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname:p.hostname, port:p.port||7777, path:p.pathname+(p.search||''), method:opts.method||'GET',
      headers:{'Content-Type':'application/json',...(opts.headers||{})}, timeout:opts.timeout||60000 },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d})); });
    req.on('error',reject); req.on('timeout',()=>{req.destroy();reject(new Error('Timeout'));});
    if(opts.body)req.write(opts.body); req.end();
  });
}

async function checkServer() { try { const r=await fetch(BASE_URL+'/health',{timeout:3000}); return JSON.parse(r.body).healthy===true; } catch(e){return false;} }

function printLogo() {
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(cc(C.cyan,`
  ██████╗ ██████╗  ██████╗ ███╗   ███╗███████╗████████╗██╗  ██╗███████╗██╗   ██╗███████╗
  ██╔══██╗██╔══██╗██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝██║  ██║██╔════╝██║   ██║██╔════╝
  ██████╔╝██████╔╝██║   ██║██╔████╔██║█████╗     ██║   ███████║█████╗  ██║   ██║███████╗
  ██╔═══╝ ██╔══██╗██║   ██║██║╚██╔╝██║██╔══╝     ██║   ██╔══██║██╔══╝  ██║   ██║╚════██║
  ██║     ██║  ██║╚██████╔╝██║ ╚═╝ ██║███████╗   ██║   ██║  ██║███████╗╚██████╔╝███████║
  ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝`));
  console.log(cc(C.gray,'  ─────────────────────────────────────────────────────────────────────────────────────\n'));
  console.log('  '+cc(C.white,'v10.0')+cc(C.gray,' · Claude Opus 4.7 · ')+cc(C.green,'⚡ Intelligence Autonome')+cc(C.gray,' · ')+cc(C.cyan,BASE_URL));
  console.log(cc(C.gray,'  ─────────────────────────────────────────────────────────────────────────────────────\n'));
}

function printHelp() {
  console.log(cc(C.cyan,'\n  Commandes :'));
  [['/mode chat|command|mission','Changer de mode'],['/status','État système'],['/analyze','Optimiser le Mac'],
   ['/memory','Mémoire PROMETHEUS'],['/causal','Prédictions causales'],['/icloud','Status iCloud'],
   ['/backup','Backup iCloud'],['/session <nom>','Changer session'],['/history','Historique'],
   ['/clear','Effacer écran'],['/help','Cette aide'],['/exit','Quitter'],
   ['PROMETHEUS STOP TOUT','Kill switch']].forEach(([c,d])=>console.log('  '+cc(C.yellow,c.padEnd(30))+cc(C.gray,d)));
  console.log('');
}

function formatResponse(text) {
  return text.replace(/^### (.+)$/gm,cc(C.cyan,'$1')).replace(/^## (.+)$/gm,cc(C.blue,'$1'))
    .replace(/^# (.+)$/gm,cc(C.purple,'$1')).replace(/\*\*(.+?)\*\*/g,cc(C.bold,'$1'))
    .replace(/`([^`]+)`/g,cc(C.green,'`$1`')).replace(/^[\-\*] (.+)$/gm,cc(C.gray,'  • ')+'$1')
    .replace(/```(\w*)\n([\s\S]+?)```/g,(_,lang,code)=>'\n'+cc(C.gray,'  ┌─ '+(lang||'code'))+'\n'+code.split('\n').map(l=>cc(C.gray,'  │ ')+cc(C.green,l)).join('\n')+'\n'+cc(C.gray,'  └─────')+'\n')
    .split('\n').map(l=>'  '+l).join('\n');
}

async function sendMessage(message, cfg) {
  const start = Date.now();
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let fi=0;
  const spinner = setInterval(()=>process.stdout.write('\r  '+cc(C.cyan,frames[fi++%frames.length])+cc(C.gray,' PROMETHEUS réfléchit...')),80);

  try {
    const r = await fetch(BASE_URL+'/prometheus/chat',{method:'POST',body:JSON.stringify({message,sessionId:cfg.sessionId,mode:cfg.mode}),timeout:90000});
    clearInterval(spinner); process.stdout.write('\r\x1b[K');
    const d = JSON.parse(r.body); const ms = Date.now()-start;
    if(d.error){console.log('\n'+cc(C.red,'  ❌ '+d.error)+'\n');return;}
    console.log('\n  '+cc(C.purple,'⚡ PROMETHEUS')+cc(C.gray,' · '+new Date().toLocaleTimeString('fr-FR')+' · '+ms+'ms')+'\n');
    console.log(formatResponse(d.response)+'\n');
    cfg.history=cfg.history||[];cfg.history.push({ts:new Date().toISOString(),user:message.slice(0,80),prom:(d.response||'').slice(0,200)});
    if(cfg.history.length>50)cfg.history.shift(); saveConfig(cfg);
  } catch(e) { clearInterval(spinner);process.stdout.write('\r\x1b[K');
    console.log('\n'+cc(C.red,'  ❌ '+e.message)+'\n');
    if(e.message.includes('ECONNREFUSED'))console.log(cc(C.yellow,'  Serveur hors ligne. Lancer: cd ~/claude-relay && pm2 start all\n'));
  }
}

async function handleCommand(cmd, cfg) {
  const [command,...args] = cmd.slice(1).split(' ');
  switch(command.toLowerCase()) {
    case 'mode': { const m=args[0]||'chat'; if(!['chat','command','mission'].includes(m)){console.log(cc(C.red,'  Modes: chat, command, mission\n'));break;} cfg.mode=m;saveConfig(cfg);console.log('\n  '+cc(C.cyan,'Mode → '+m.toUpperCase())+'\n');break; }
    case 'status': { try{const r=await fetch(BASE_URL+'/monitor/full',{timeout:8000});const d=JSON.parse(r.body);console.log('\n'+cc(C.cyan,'  ── Système ──'));console.log(cc(C.gray,'  CPU: ')+cc(C.white,d.cpu||'?'));console.log(cc(C.gray,'  RAM: ')+cc(C.white,d.ram||'?'));console.log(cc(C.gray,'  Battery: ')+cc(C.white,d.battery||'?'));console.log(cc(C.gray,'  Uptime: ')+cc(C.white,(d.uptime||'?')+'s')+'\n');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'analyze': { console.log(cc(C.yellow,'\n  🔍 Analyse Mac...\n'));try{const r=await fetch(BASE_URL+'/optimize/analyze',{timeout:15000});const d=JSON.parse(r.body);console.log(cc(C.gray,'  Disque: ')+cc(C.white,d.storage?.usedPct||'?'));console.log(cc(C.gray,'  Caches: ')+cc(C.white,d.storage?.caches?.userCache||'?'));console.log(cc(C.gray,'  Corbeille: ')+cc(C.white,d.storage?.caches?.trash||'?'));if(d.issues?.length){console.log('\n'+cc(C.cyan,'  Recommandations:'));d.issues.forEach(i=>{const col={SAFE:'green',CAUTION:'yellow',WARN:'orange',CRITICAL:'red'}[i.type]||'white';console.log('  '+cc(C[col],'['+i.type+'] ')+i.title);});}console.log(cc(C.green,'\n  Économies: '+d.potentialSavings)+'\n');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'memory': { try{const r=await fetch(BASE_URL+'/episodic/stats',{timeout:5000});const d=JSON.parse(r.body);console.log('\n'+cc(C.cyan,'  ── Mémoire ──'));console.log(cc(C.gray,'  Épisodes: ')+cc(C.white,d.total||'0'));console.log(cc(C.gray,'  ChromaDB: ')+cc(d.chromadb?.available?C.green:C.red,d.chromadb?.available?'● Actif':'○ Fallback')+'\n');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'causal': { console.log(cc(C.yellow,'\n  🔮 Prédictions...\n'));try{const r=await fetch(BASE_URL+'/causal/stats',{timeout:5000});const d=JSON.parse(r.body);console.log(cc(C.gray,'  Events: ')+cc(C.white,d.events||'0'));console.log(cc(C.gray,'  Relations: ')+cc(C.white,d.relations||'0'));console.log(cc(C.gray,'  Patterns: ')+cc(C.white,d.patterns||'0')+'\n');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'icloud': { try{const r=await fetch(BASE_URL+'/icloud/status',{timeout:5000});const d=JSON.parse(r.body);console.log('\n'+cc(C.cyan,'  ── iCloud ──'));console.log(cc(C.gray,'  Dispo: ')+cc(d.available?C.green:C.red,d.available?'✅':'❌'));if(d.available){console.log(cc(C.gray,'  Taille: ')+cc(C.white,d.prometheusSize||'0'));console.log(cc(C.gray,'  Backups: ')+cc(C.white,d.backupsCount||'0'));}console.log('');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'backup': { console.log(cc(C.yellow,'\n  💾 Backup iCloud...\n'));try{const r=await fetch(BASE_URL+'/icloud/backup',{method:'POST',body:'{}',timeout:60000});const d=JSON.parse(r.body);console.log(d.success?cc(C.green,'  ✅ Backup OK — '+(d.backupDir||'')):cc(C.red,'  ❌ '+(d.reason||'Erreur')));console.log('');}catch(e){console.log(cc(C.red,'  '+e.message+'\n'));}break; }
    case 'session': { cfg.sessionId=args.join(' ').trim()||cfg.sessionId;saveConfig(cfg);console.log('\n  '+cc(C.cyan,'Session → ')+cc(C.white,cfg.sessionId)+'\n');break; }
    case 'history': { const h=cfg.history||[];if(!h.length){console.log(cc(C.gray,'\n  Vide.\n'));break;}console.log('\n'+cc(C.cyan,'  ── Historique ──\n'));h.slice(-10).forEach(e=>{console.log(cc(C.gray,'  '+e.ts?.slice(11,19))+' '+cc(C.yellow,'Vous: ')+e.user?.slice(0,60));console.log(cc(C.gray,'           ')+cc(C.purple,'⚡: ')+e.prom?.slice(0,80)+'\n');});break; }
    case 'clear': { process.stdout.write('\x1b[2J\x1b[H');console.log(cc(C.cyan,'  ⚡ PROMETHEUS')+cc(C.gray,' · ')+cc(C.white,cfg.sessionId)+cc(C.gray,' · ')+cc(C.yellow,cfg.mode.toUpperCase())+'\n');break; }
    case 'help': { printHelp();break; }
    case 'exit': case 'quit': { console.log(cc(C.gray,'\n  Au revoir. ⚡\n'));process.exit(0); }
    default: console.log(cc(C.red,'\n  Commande inconnue: /'+command+'\n  /help pour la liste.\n'));
  }
}

async function interactiveMode(cfg) {
  printLogo();
  process.stdout.write(cc(C.gray,'  Connexion...'));
  if(!await checkServer()){process.stdout.write('\r\x1b[K');console.log(cc(C.red,'  ❌ Serveur hors ligne!\n')+cc(C.yellow,'  cd ~/claude-relay && pm2 start all\n'));process.exit(1);}
  process.stdout.write('\r\x1b[K');
  console.log(cc(C.green,'  ✅ Connecté')+cc(C.gray,' · Session: '+cfg.sessionId+' · Mode: '+cfg.mode.toUpperCase()+'\n  /help pour les commandes\n'));

  const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true,historySize:100});
  const icons={chat:'💬',command:'⚡',mission:'🚀'};
  function prompt(){rl.setPrompt(C.cyan+(icons[cfg.mode]||'💬')+' › '+C.reset);rl.prompt();}
  prompt();

  rl.on('line',async line=>{
    const input=line.trim();if(!input){prompt();return;}
    if(/PROMETHEUS STOP TOUT|KILL PROMETHEUS|ARRÊT D'URGENCE/i.test(input)){console.log(cc(C.red,'\n  🔴 KILL SWITCH\n'));try{await fetch(BASE_URL+'/sovereignty/kill',{method:'POST',body:'{}'});}catch(e){}process.exit(0);}
    if(input.startsWith('/'))await handleCommand(input,cfg);else await sendMessage(input,cfg);
    prompt();
  });
  rl.on('close',()=>{console.log(cc(C.gray,'\n  Au revoir. ⚡\n'));process.exit(0);});
  rl.on('SIGINT',()=>{console.log(cc(C.gray,'\n'));rl.close();});
}

async function main(){
  const args=process.argv.slice(2);const cfg=loadConfig();
  if(args.includes('--help')||args.includes('-h')){console.log(cc(C.cyan,'\nPROMETHEUS CLI\n'));console.log('  prometheus                Mode interactif');console.log('  prometheus "message"      Message direct');console.log('  prometheus --status       Status système');console.log('  prometheus --mode <mode>  Démarrer en mode');console.log('  prometheus --session <id> Session spécifique\n');process.exit(0);}
  const mi=args.indexOf('--mode');if(mi!==-1&&args[mi+1])cfg.mode=args[mi+1];
  const si=args.indexOf('--session');if(si!==-1&&args[si+1])cfg.sessionId=args[si+1];
  if(args.includes('--status')){await handleCommand('/status',cfg);process.exit(0);}
  const msg=args.filter(a=>!a.startsWith('--')).join(' ').trim();
  if(msg){if(!await checkServer()){console.log(cc(C.red,'❌ Serveur hors ligne'));process.exit(1);}await sendMessage(msg,cfg);process.exit(0);}
  await interactiveMode(cfg);
}
main().catch(e=>{console.error(cc(C.red,'Erreur: '+e.message));process.exit(1);});
