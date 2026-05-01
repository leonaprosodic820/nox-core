const macCmd = require('./mac-commander');

let streamInterval = null;
let cameraInterval = null;
let currentQuality = 60;

function startScreen(broadcast, intervalMs = 2000, quality = 60) {
  stopScreen();
  currentQuality = quality;
  streamInterval = setInterval(() => {
    try {
      const buf = macCmd.takeScreenshot();
      broadcast({ event: 'screen_frame', imageBase64: buf.toString('base64'), timestamp: Date.now() });
    } catch {}
  }, intervalMs);
}

function stopScreen() {
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
}

function startCamera(broadcast, intervalMs = 2000) {
  stopCamera();
  cameraInterval = setInterval(() => {
    try {
      const buf = macCmd.camera.takePicture();
      broadcast({ event: 'camera_frame', imageBase64: buf.toString('base64'), timestamp: Date.now() });
    } catch {}
  }, intervalMs);
}

function stopCamera() {
  if (cameraInterval) { clearInterval(cameraInterval); cameraInterval = null; }
}

function setQuality(q) { currentQuality = Math.max(10, Math.min(100, q)); }
function isScreenStreaming() { return !!streamInterval; }
function isCameraStreaming() { return !!cameraInterval; }

module.exports = { startScreen, stopScreen, startCamera, stopCamera, setQuality, isScreenStreaming, isCameraStreaming };
