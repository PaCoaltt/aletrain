// Visible failure if the app's module graph cannot load. No hidden blank map.
import('./app.js?v=5').catch(error => {
  console.error('AleTrain application failed to start', error);
  const status = document.querySelector('#mapStatus');
  if (status) status.hidden = false;
});
