// Runs before the production stylesheet. Keep the preference key in sync with ThemeService.
(() => {
  let preference;
  try {
    preference = localStorage.getItem('arturia.theme');
  } catch {
    // Storage can be unavailable even when the app can run.
  }
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme =
    preference === 'light' || preference === 'dark' ? preference : system;
})();
