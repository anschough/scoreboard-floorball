// Delad utloggning. Kopplar alla element med [data-logout] till /api/logout
// och skickar sedan användaren till login-sidan.
(function () {
  function wireLogout(el) {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch {
        /* ignorera nätverksfel – vi skickar till login ändå */
      }
      location.href = '/login.html';
    });
  }
  document.querySelectorAll('[data-logout]').forEach(wireLogout);
})();
