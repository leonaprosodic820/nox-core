const fs = require('fs');
const path = require('path');

describe('UI Files', () => {
  const publicDir = path.join(__dirname, '..', 'public');

  test('index.html exists and contains Claude Relay title', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('Claude Relay');
    expect(html).toContain('screen-home');
    expect(html).toContain('screen-session');
  });

  test('index.html links to styles.css', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('styles.css');
  });

  test('index.html links to app.js', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('app.js');
  });

  test('styles.css exists and contains CSS variables', () => {
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf-8');
    expect(css).toContain('--bg-primary');
    expect(css).toContain('--accent-blue');
    expect(css).toContain('--accent-green');
  });

  test('styles.css contains glassmorphism styles', () => {
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf-8');
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('blur');
  });

  test('styles.css contains animations', () => {
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf-8');
    expect(css).toContain('@keyframes fadeIn');
    expect(css).toContain('@keyframes slideUp');
    expect(css).toContain('@keyframes shake');
  });

  test('styles.css contains responsive breakpoint', () => {
    const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf-8');
    expect(css).toContain('@media');
    expect(css).toContain('900px');
  });

  test('app.js exists and contains state object', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('const state');
    expect(js).toContain('currentSessionId');
    expect(js).toContain('instances');
  });

  test('app.js contains WebSocket reconnection logic', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('connectWS');
    expect(js).toContain('wsReconnectAttempts');
    expect(js).toContain('wsMaxReconnect');
  });

  test('app.js contains instance management functions', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('addInstancePanel');
    expect(js).toContain('removeInstancePanel');
    expect(js).toContain('generateInstanceColor');
  });

  test('app.js contains clipboard function', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('copyToClipboard');
  });

  test('index.html contains instance modal', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('modal-new-instance');
    expect(html).toContain('modal-project-name');
    expect(html).toContain('modal-cli-number');
  });

  test('index.html contains sidebar structure', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('instances-sidebar');
    expect(html).toContain('instances-grid');
    expect(html).toContain('sidebar');
  });

  test('index.html contains history section', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    expect(html).toContain('history-list');
    expect(html).toContain('Historique');
  });

  test('app.js contains relative timestamp updater', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('updateRelativeTimestamps');
  });

  test('app.js contains dispatchWSEvent function', () => {
    const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
    expect(js).toContain('dispatchWSEvent');
    expect(js).toContain('instance_registered');
    expect(js).toContain('instance_removed');
  });
});
