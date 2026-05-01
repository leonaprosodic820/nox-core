self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'PROMETHEUS', {
    body: data.body || '', icon: data.icon || '/prometheus-logo.svg',
    badge: '/prometheus-logo.svg', tag: data.tag || 'prometheus', vibrate: [200, 100, 200],
    actions: [{ action: 'open', title: 'Ouvrir' }, { action: 'dismiss', title: 'Ignorer' }],
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'open' || !event.action) event.waitUntil(clients.openWindow('https://cmd.omnixai.tech'));
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
