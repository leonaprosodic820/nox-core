const sharp = require('sharp');

class StreamManager {
  constructor() {
    this.streams = new Map();
    this.broadcastFn = null;
    this.masterInterval = null;
    this.frameCache = new Map();
    this.stats = { totalFramesSent:0, totalBytesSent:0, startTime:Date.now() };
  }

  init(broadcastFn) { this.broadcastFn = broadcastFn; }

  startMasterLoop(intervalMs=500) {
    if (this.masterInterval) return;
    this.masterInterval = setInterval(async () => {
      if (this.streams.size === 0) return;
      try {
        const vision = require('./vision-engine');
        const cap = await vision.captureScreen({quality:'native', format:'png', cursor:true});
        const qualities = new Set(Array.from(this.streams.values()).map(s => s.quality));

        for (const q of qualities) {
          const preset = vision.QUALITY_PRESETS[q] || vision.QUALITY_PRESETS.medium;
          let proc = sharp(cap.buffer);
          if (preset.width) proc = proc.resize(preset.width, null, {fit:'inside', withoutEnlargement:true});
          const jpegBuf = await proc.jpeg({quality:preset.jpeg, progressive:true}).toBuffer();
          this.frameCache.set(q, { buffer:jpegBuf, base64:jpegBuf.toString('base64'), timestamp:Date.now(), size:jpegBuf.length });
        }

        this.streams.forEach((cfg, clientId) => {
          const frame = this.frameCache.get(cfg.quality);
          if (!frame || !this.broadcastFn) return;
          this.broadcastFn({ event:'screen_frame', clientId, imageBase64:frame.base64, timestamp:frame.timestamp, size:frame.size, quality:cfg.quality });
          this.stats.totalFramesSent++;
          this.stats.totalBytesSent += frame.size;
        });
      } catch {}
    }, intervalMs);
  }

  stopMasterLoop() { if (this.masterInterval) { clearInterval(this.masterInterval); this.masterInterval = null; } }

  addClient(clientId, options={}) {
    const { quality='medium', fps=10, source='screen' } = options;
    this.streams.set(clientId, {quality, fps, source, connectedAt:Date.now()});
    this.startMasterLoop(Math.max(200, Math.floor(1000/fps)));
    return {clientId, quality, fps, source};
  }

  removeClient(clientId) {
    this.streams.delete(clientId);
    if (this.streams.size === 0) this.stopMasterLoop();
  }

  updateClientQuality(clientId, quality) {
    const s = this.streams.get(clientId);
    if (s) s.quality = quality;
  }

  getStats() {
    const uptime = (Date.now() - this.stats.startTime) / 1000;
    return {
      activeClients:this.streams.size, totalFramesSent:this.stats.totalFramesSent,
      totalBytesSent:this.stats.totalBytesSent, avgBytesPerSecond:Math.round(this.stats.totalBytesSent/uptime),
      uptime, clients:Array.from(this.streams.entries()).map(([id,cfg]) => ({clientId:id,...cfg}))
    };
  }
}

module.exports = new StreamManager();
