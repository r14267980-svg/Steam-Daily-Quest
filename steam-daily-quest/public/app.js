let rerollCount = 0;
let currentQuestData = null;
let audioCtx = null;

function playTick() {
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.03);
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.03);
  } catch (e) {}
}

const params = new URLSearchParams(window.location.search);
if (params.get('steamid')) {
  localStorage.setItem('steam_user', JSON.stringify({
    id: params.get('steamid'),
    name: params.get('name') || 'Steam Player',
    avatar: params.get('avatar') || ''
  }));
  window.history.replaceState({}, document.title, '/');
}

document.getElementById('logout-btn').addEventListener('click', function() {
  localStorage.removeItem('steam_user');
  window.location.reload();
});

function buildWheel(reelGames) {
  const track = document.getElementById('wheel-track');
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  track.innerHTML = '';

  reelGames.forEach(function(g, idx) {
    const card = document.createElement('div');
    card.className = 'wheel-item';
    card.dataset.index = idx;
    card.innerHTML = '<img src="' + g.headerImage + '" alt="" /><div class="wheel-item-label">' + g.name + '</div>';
    track.appendChild(card);
  });
}

function startSpin() {
  if (!currentQuestData) return;
  const spinBtn = document.getElementById('spin-btn');
  const track = document.getElementById('wheel-track');
  const viewport = document.getElementById('wheel-viewport');
  spinBtn.disabled = true;
  spinBtn.textContent = 'SPINNING...';

  const step = 232;
  const winIndex = 21;
  const jitter = Math.floor(Math.random() * 70) - 35;
  const targetOffset = (viewport.offsetWidth / 2) - (winIndex * step + 110) + jitter;

  let lastTickIndex = -1;
  const startTime = performance.now();

  function tickLoop(now) {
    if (now - startTime >= 4200) return;
    const currentX = new DOMMatrixReadOnly(window.getComputedStyle(track).transform).m41;
    const currentCard = Math.floor(((viewport.offsetWidth / 2) - currentX) / step);
    if (currentCard !== lastTickIndex) {
      lastTickIndex = currentCard;
      playTick();
    }
    requestAnimationFrame(tickLoop);
  }

  requestAnimationFrame(function() {
    track.style.transition = 'transform 4.2s cubic-bezier(0.08, 0.85, 0.18, 1)';
    track.style.transform = 'translateX(' + targetOffset + 'px)';
    requestAnimationFrame(tickLoop);
  });

  setTimeout(function() {
    const winCard = track.querySelector('[data-index="21"]');
    if (winCard) winCard.classList.add('winner-glow');

    setTimeout(function() {
      showQuestResult(currentQuestData);
      spinBtn.disabled = false;
      spinBtn.textContent = "SPIN FOR TODAY'S QUEST";
    }, 900);
  }, 4250);
}

function showQuestResult(data) {
  document.getElementById('game-img').src = data.game.headerImage;
  document.getElementById('game-title').textContent = data.game.name;
  document.getElementById('game-meta').textContent = data.game.playtimeHours + ' hrs on record • Selected from ' + data.totalGames + ' games';
  document.getElementById('launch-btn').href = 'steam://run/' + data.game.appid;
  document.getElementById('challenge-type').textContent = data.challenge.type;
  document.getElementById('challenge-title').textContent = data.challenge.title;
  document.getElementById('challenge-desc').textContent = data.challenge.description;

  const iconEl = document.getElementById('ach-icon');
  if (data.challenge.icon) {
    iconEl.src = data.challenge.icon;
    iconEl.classList.remove('hidden');
  } else {
    iconEl.classList.add('hidden');
  }

  const todayKey = 'quest-done-' + new Date().toISOString().slice(0, 10) + '-' + data.game.appid;
  updateCompleteButton(localStorage.getItem(todayKey) === 'true', todayKey);

  document.getElementById('wheel-view').classList.add('hidden');
  document.getElementById('quest-view').classList.remove('hidden');
}

async function loadQuest(autoSpin) {
  const loginView = document.getElementById('login-view');
  const loadingView = document.getElementById('loading-view');
  const wheelView = document.getElementById('wheel-view');
  const questView = document.getElementById('quest-view');
  const errorView = document.getElementById('error-view');

  const savedUser = JSON.parse(localStorage.getItem('steam_user') || 'null');
  if (!savedUser || !savedUser.id) {
    loadingView.classList.add('hidden');
    loginView.classList.remove('hidden');
    return;
  }

  document.getElementById('user-pill').classList.remove('hidden');
  document.getElementById('user-name').textContent = savedUser.name;
  if (savedUser.avatar) document.getElementById('user-avatar').src = savedUser.avatar;

  loginView.classList.add('hidden');
  errorView.classList.add('hidden');
  questView.classList.add('hidden');
  wheelView.classList.add('hidden');
  loadingView.classList.remove('hidden');

  try {
    const res = await fetch('/api/daily-quest?steamid=' + savedUser.id + '&reroll=' + rerollCount);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    currentQuestData = data;
    document.getElementById('wheel-subtitle').textContent = 'Loaded ' + data.totalGames + ' games from your Steam library';
    buildWheel(data.reelGames);

    loadingView.classList.add('hidden');
    wheelView.classList.remove('hidden');

    if (autoSpin) startSpin();
  } catch (err) {
    loadingView.classList.add('hidden');
    errorView.textContent = err.message;
    errorView.classList.remove('hidden');
  }
}

function updateCompleteButton(isDone, storageKey) {
  const btn = document.getElementById('complete-btn');
  btn.textContent = isDone ? '★ Quest Completed!' : '✓ Mark Completed';
  btn.classList.toggle('done', isDone);
  btn.onclick = function() {
    const next = !btn.classList.contains('done');
    localStorage.setItem(storageKey, next);
    updateCompleteButton(next, storageKey);
  };
}

document.getElementById('spin-btn').addEventListener('click', startSpin);
document.getElementById('reroll-btn').addEventListener('click', function() {
  rerollCount++;
  loadQuest(true);
});

loadQuest(false);
