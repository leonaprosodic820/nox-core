const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let VIDEOS_DIR;
try { VIDEOS_DIR = require('./vision-engine').VIDEOS_DIR; } catch { VIDEOS_DIR = path.join(__dirname, 'downloads', 'videos'); }
fs.mkdirSync(VIDEOS_DIR, {recursive:true});

const activeRecordings = new Map();

async function startRecording(options={}) {
  const { sessionId=`rec-${Date.now()}`, fps=30, quality='high', withAudio=false, maxDuration=300, display=0, region=null } = options;
  if (activeRecordings.has(sessionId)) throw new Error(`Recording ${sessionId} already active`);

  const outputPath = path.join(VIDEOS_DIR, `recording-${Date.now()}.mp4`);
  const qMap = {
    low:{crf:'35',preset:'ultrafast',scale:'1280:-2'},
    medium:{crf:'28',preset:'fast',scale:'1920:-2'},
    high:{crf:'22',preset:'medium',scale:'2560:-2'},
    native:{crf:'18',preset:'slow',scale:null}
  };
  const q = qMap[quality] || qMap.high;

  const vf = [q.scale?`scale=${q.scale}`:null, region?`crop=${region.w}:${region.h}:${region.x}:${region.y}`:null, 'format=yuv420p'].filter(Boolean).join(',');

  const args = ['-y', '-f','avfoundation', '-framerate',String(fps), '-capture_cursor','0', '-i', withAudio?`${display}:0`:String(display), '-vf',vf, '-c:v','libx264', '-crf',q.crf, '-preset',q.preset, '-movflags','+faststart', '-t',String(maxDuration), outputPath];

  const proc = spawn('ffmpeg', args, {stdio:['ignore','pipe','pipe']});
  const rec = { process:proc, path:outputPath, sessionId, startTime:Date.now(), fps, quality, withAudio, status:'recording', pid:proc.pid };

  rec.autoStopTimer = setTimeout(() => stopRecording(sessionId).catch(()=>{}), maxDuration*1000);
  proc.on('close', code => { rec.status = code===0?'completed':'error'; rec.endTime=Date.now(); rec.duration=(rec.endTime-rec.startTime)/1000; });

  activeRecordings.set(sessionId, rec);
  return { sessionId, path:outputPath, startTime:rec.startTime, maxDuration, fps, quality };
}

async function stopRecording(sessionId) {
  const rec = activeRecordings.get(sessionId);
  if (!rec) throw new Error(`No recording ${sessionId}`);
  clearTimeout(rec.autoStopTimer);
  rec.process.kill('SIGINT');
  await new Promise(resolve => { const t=setTimeout(resolve,5000); rec.process.on('close',()=>{clearTimeout(t);resolve();}); });
  rec.status='completed'; rec.endTime=Date.now(); rec.duration=(rec.endTime-rec.startTime)/1000;
  rec.size = fs.existsSync(rec.path) ? fs.statSync(rec.path).size : 0;
  activeRecordings.delete(sessionId);
  return { sessionId, path:rec.path, filename:path.basename(rec.path), duration:rec.duration, size:rec.size, status:rec.status };
}

function getActiveRecordings() {
  return Array.from(activeRecordings.values()).map(r => ({ sessionId:r.sessionId, startTime:r.startTime, duration:(Date.now()-r.startTime)/1000, status:r.status, quality:r.quality, fps:r.fps }));
}

async function captureGif(options={}) {
  const { duration=5, fps=10, scale=640 } = options;
  const out = path.join(VIDEOS_DIR, `capture-${Date.now()}.gif`);
  const args = ['-y','-f','avfoundation','-framerate',String(fps),'-i','0','-t',String(duration),'-vf',`scale=${scale}:-1:flags=lanczos,fps=${fps}`,out];
  await new Promise((resolve,reject) => {
    const p = spawn('ffmpeg', args, {stdio:'ignore'});
    p.on('close', code => code===0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
  return { path:out, filename:path.basename(out), duration, size:fs.existsSync(out)?fs.statSync(out).size:0 };
}

async function captureTimelapse(options={}) {
  const { duration=60, interval=2, outputFps=24, quality='medium' } = options;
  const tmpDir = path.join(VIDEOS_DIR, `tl-${Date.now()}`);
  fs.mkdirSync(tmpDir, {recursive:true});
  const frames = Math.ceil(duration/interval);
  const vision = require('./vision-engine');
  for (let i=0; i<frames; i++) {
    const buf = (await vision.captureScreen({quality, format:'jpeg'})).buffer;
    fs.writeFileSync(path.join(tmpDir, `frame-${String(i).padStart(6,'0')}.jpg`), buf);
    if (i < frames-1) await new Promise(r => setTimeout(r, interval*1000));
  }
  const out = path.join(VIDEOS_DIR, `timelapse-${Date.now()}.mp4`);
  execSync(`ffmpeg -y -framerate ${outputFps} -pattern_type glob -i "${tmpDir}/frame-*.jpg" -c:v libx264 -crf 22 -preset fast -movflags +faststart "${out}"`, {timeout:60000});
  fs.rmSync(tmpDir, {recursive:true, force:true});
  return { path:out, filename:path.basename(out), frames, duration, outputFps, size:fs.existsSync(out)?fs.statSync(out).size:0 };
}

module.exports = { startRecording, stopRecording, getActiveRecordings, captureGif, captureTimelapse, activeRecordings };
