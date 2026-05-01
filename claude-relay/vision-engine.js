'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

class VisionEngine extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.interval = null;
    this.intervalMs = 5000;
    this.lastAnalysis = null;
    this.history = [];
    this.anomalies = [];
    this.frameCount = 0;
    this.lastHash = '';
    this.dir = fs.existsSync('/Volumes/RAMDisk') ? '/Volumes/RAMDisk' : os.tmpdir();
  }

  capture() {
    const fp = path.join(this.dir, `pv_${Date.now()}.png`);
    try {
      execSync(`screencapture -x -C "${fp}"`, { stdio: 'ignore', timeout: 5000 });
      if (!fs.existsSync(fp)) return null;
      const buf = fs.readFileSync(fp);
      const b64 = buf.toString('base64');
      const hash = require('crypto').createHash('md5').update(buf).digest('hex').slice(0, 12);
      try { fs.unlinkSync(fp); } catch (e) {}
      return { base64: b64, hash, size: buf.length, ts: Date.now() };
    } catch (e) { return null; }
  }

  async analyze(frame) {
    if (!frame) return null;
    if (frame.hash === this.lastHash) return { skipped: true, reason: 'no_change' };
    this.lastHash = frame.hash;

    try {
      const bridge = require('./claude-api-bridge');
      const imgPath = path.join(this.dir, `pa_${Date.now()}.png`);
      fs.writeFileSync(imgPath, Buffer.from(frame.base64, 'base64'));

      const prompt = `Analyse cette capture d'écran Mac. JSON compact:
{"apps":["visibles"],"notifications":[],"anomalies":[],"activity":"court","alert":false,"alert_reason":""}
Détecte: notifications, alertes sécurité, erreurs, processus suspects.`;

      const resp = await bridge.call(prompt, { maxTokens: 400, timeout: 30000, images: [imgPath] });
      try { fs.unlinkSync(imgPath); } catch (e) {}

      const text = typeof resp === 'string' ? resp : resp.content?.[0]?.text || JSON.stringify(resp);
      let analysis;
      try {
        const m = text.match(/\{[\s\S]*\}/);
        analysis = m ? JSON.parse(m[0]) : { activity: text.slice(0, 200), raw: true };
      } catch (e) { analysis = { activity: text.slice(0, 200), raw: true }; }

      analysis.ts = new Date().toISOString();
      analysis.frameId = this.frameCount;

      if (analysis.alert) {
        this.anomalies.push({ ts: analysis.ts, reason: analysis.alert_reason, details: analysis });
        if (this.anomalies.length > 50) this.anomalies.shift();
        this.emit('anomaly', analysis);
      }

      this.lastAnalysis = analysis;
      this.history.push({ ts: analysis.ts, activity: analysis.activity, alert: analysis.alert });
      if (this.history.length > 100) this.history.shift();
      this.emit('analysis', analysis);
      return analysis;
    } catch (e) { return { error: e.message, ts: new Date().toISOString() }; }
  }

  start(ms) {
    if (this.running) return { status: 'already_running' };
    this.intervalMs = ms || this.intervalMs;
    this.running = true;
    this.frameCount = 0;
    console.log(`[Vision] Started — every ${this.intervalMs / 1000}s`);
    this.emit('started', { intervalMs: this.intervalMs });

    const tick = async () => {
      if (!this.running) return;
      this.frameCount++;
      const frame = this.capture();
      if (frame) {
        const r = await this.analyze(frame);
        this.emit('frame', { frameId: this.frameCount, result: r });
      }
    };
    tick();
    this.interval = setInterval(tick, this.intervalMs);
    this.interval.unref();
    return { status: 'started', intervalMs: this.intervalMs };
  }

  stop() {
    this.running = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.emit('stopped');
    return { status: 'stopped', frames: this.frameCount };
  }

  getStatus() {
    return { running: this.running, intervalMs: this.intervalMs, frameCount: this.frameCount,
      lastAnalysis: this.lastAnalysis, anomalyCount: this.anomalies.length };
  }
  getAnomalies() { return this.anomalies.slice(-20); }
  getHistory() { return this.history.slice(-30); }

  async captureAndAnalyze() {
    const frame = this.capture();
    if (!frame) return { error: 'Screenshot failed' };
    this.frameCount++;
    return await this.analyze(frame);
  }

  captureOnly() {
    const frame = this.capture();
    return frame ? { base64: frame.base64, size: frame.size, ts: Date.now() } : { error: 'Failed' };
  }
}

module.exports = new VisionEngine();
