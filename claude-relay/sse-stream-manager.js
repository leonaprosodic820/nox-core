'use strict';
const EventEmitter = require('events');

class SSEStreamManager extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
  }
  create(sessionId, res) {
    const stream = { sessionId, res, startedAt: Date.now(), tokenCount: 0 };
    this.activeStreams.set(sessionId, stream);
    res.on('close', () => this.end(sessionId));
    return stream;
  }
  sendToken(sessionId, token) {
    const s = this.activeStreams.get(sessionId);
    if (!s || s.res.writableEnded) return false;
    s.tokenCount++;
    s.res.write('data: ' + JSON.stringify({ type: 'token', text: token }) + '\n\n');
    return true;
  }
  sendAction(sessionId, action) {
    const s = this.activeStreams.get(sessionId);
    if (!s || s.res.writableEnded) return false;
    s.res.write('data: ' + JSON.stringify({ type: 'action', text: action }) + '\n\n');
    return true;
  }
  end(sessionId, data = {}) {
    const s = this.activeStreams.get(sessionId);
    if (!s) return;
    if (!s.res.writableEnded) {
      s.res.write('data: ' + JSON.stringify({ type: 'done', ...data }) + '\n\n');
      s.res.end();
    }
    this.activeStreams.delete(sessionId);
    this.emit('ended', { sessionId, ...data });
  }
  sendError(sessionId, error) {
    const s = this.activeStreams.get(sessionId);
    if (!s || s.res.writableEnded) return;
    s.res.write('data: ' + JSON.stringify({ type: 'error', text: error }) + '\n\n');
    this.end(sessionId);
  }
  getStats() {
    return {
      active: this.activeStreams.size,
      streams: [...this.activeStreams.entries()].map(([id, s]) => ({
        sessionId: id,
        elapsed: Math.round((Date.now() - s.startedAt) / 1000),
        tokens: s.tokenCount,
      })),
    };
  }
}
module.exports = new SSEStreamManager();
