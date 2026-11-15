/* Royal Flush table interior enhancement.
 * Include after the existing inline game script in public/index.html.
 * Rendering and poker actions continue to be driven by the existing WebSocket client.
 */
(() => {
  'use strict';

  const seats = document.getElementById('seats');
  if (!seats) return;

  function decorateSeats() {
    seats.querySelectorAll('.seat').forEach((seat, index) => {
      seat.dataset.tableSeat = String(index);

      // Five-star row like the supplied mobile-table reference.
      if (!seat.querySelector('.seat-stars')) {
        const stars = document.createElement('div');
        stars.className = 'seat-stars';
        stars.setAttribute('aria-hidden', 'true');
        stars.textContent = '★★★★★';
        const avatar = seat.querySelector('.avatar');
        if (avatar) avatar.insertAdjacentElement('afterend', stars);
      }

      // Mark the current player's seat (render() places them at s0).
      seat.classList.toggle('local-player', seat.classList.contains('s0'));
    });
  }

  decorateSeats();
  const observer = new MutationObserver(decorateSeats);
  observer.observe(seats, { childList: true, subtree: true });
})();
