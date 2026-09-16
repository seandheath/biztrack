// Update an existing root worker; never register a broad worker for new visitors.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration('/').then(registration => {
    if (registration && new URL(registration.scope).pathname === '/') return registration.update();
  }).catch(console.warn);
}
if (location.pathname === '/' && new URLSearchParams(location.search).has('shared')) {
  location.replace('/beta/share/');
}
