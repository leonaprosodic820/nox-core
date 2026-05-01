const notifier = require('node-notifier');
const path = require('path');

const ICON = path.join(__dirname, 'assets', 'relay-icon.png');

const SOUNDS = {
  success: 'Glass',
  error: 'Basso',
  warning: 'Sosumi',
  info: 'Tink',
  startup: 'Hero'
};

function notify({ title, message, instanceLabel, sound, timeout }) {
  const soundName = typeof sound === 'string' && SOUNDS[sound] ? SOUNDS[sound] : (sound || SOUNDS.info);
  notifier.notify({
    title: title || '\uD83D\uDD25 PROMETHEUS',
    subtitle: instanceLabel || '',
    message: message || '',
    icon: ICON,
    sound: soundName,
    timeout: timeout || 5,
    contentImage: undefined
  });
}

module.exports = { notify, SOUNDS };
