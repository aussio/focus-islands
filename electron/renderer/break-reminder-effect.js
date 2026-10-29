const host = document.getElementById('effect');
if (new URLSearchParams(location.search).get('effect') === 'clock') {
  const clock = document.createElement('img');
  clock.className = 'clock';
  clock.src = 'alarm-clock.svg';
  clock.alt = '';
  host.append(clock);
} else {
  const palette = ['#6d9b72', '#b4d39f', '#f3d56a', '#f3a978', '#8abfc9', '#e9e2a4'];
  const count = Math.min(240, Math.max(90, Math.round(innerWidth * innerHeight / 7000)));
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index++) {
    const piece = document.createElement('span');
    piece.className = 'piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.top = `${Math.random() * 65 - 25}%`;
    piece.style.setProperty('--size', `${8 + Math.floor(Math.random() * 3) * 4}px`);
    piece.style.setProperty('--color', palette[index % palette.length]);
    piece.style.setProperty('--duration', `${2.2 + Math.random() * 1.2}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.6}s`);
    piece.style.setProperty('--drift', `${Math.round(Math.random() * 200 - 100)}px`);
    piece.style.setProperty('--turn', `${Math.round(Math.random() * 5 + 2) * 90}deg`);
    fragment.append(piece);
  }

  host.append(fragment);
}
