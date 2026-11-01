/* Runs before first paint so the stored/preferred theme never flashes. */
(function () {
  try {
    var stored = localStorage.getItem('otp-shield-theme');
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
