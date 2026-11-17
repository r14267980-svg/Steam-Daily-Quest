require('dotenv').config();
const express = require('express');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `https://steam-daily-quest.onrender.com`).replace(/\/$/, '');
const STEAM_API_KEY = process.env.STEAM_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());

passport.use(new SteamStrategy({
    returnURL: `${BASE_URL}/auth/steam/return`,
    realm: `${BASE_URL}/`,
    apiKey: STEAM_API_KEY,
    stateless: true
  },
  (identifier, profile, done) => {
    return done(null, profile);
  }
));

app.get('/auth/steam', passport.authenticate('steam', { session: false }));

app.get('/auth/steam/return', (req, res, next) => {
  passport.authenticate('steam', { session: false }, (err, user) => {
    if (err || !user) {
      console.error('Steam login error:', err);
      return res.redirect('/?error=login_failed');
    }
    const name = encodeURIComponent(user.displayName || 'Steam Player');
    const avatar = encodeURIComponent((user.photos && user.photos.at(-1)?.value) || '');
    return res.redirect(`/?steamid=${user.id}&name=${name}&avatar=${avatar}`);
  })(req, res, next);
});

function getDailySeed(steamId, offset) {
  const today = new Date().toISOString().slice(0, 10);
  const str = `${steamId}-${today}-${offset}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const genericChallenges = [
  "Play for at least 30 minutes without checking a guide or wiki.",
  "Complete one main story mission, level, or full multiplayer match.",
  "Try a weapon, character, or playstyle you normally ignore.",
  "Play on one difficulty level higher than your usual comfort zone.",
  "Explore an area of the map you haven't visited in a while."
];

app.get('/api/daily-quest', async (req, res) => {
  const steamId = req.query.steamid;
  if (!steamId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const rerollOffset = parseInt(req.query.reroll || '0', 10);

  try {
    const gamesUrl = `https://steampowered.com{STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
    const gamesRes = await fetch(gamesUrl);
    const gamesData = await gamesRes.json();

    const games = gamesData.response && gamesData.response.games;
    if (!games || games.length === 0) {
      return res.status(400).json({
        error: 'No games found. Make sure your Steam Profile "Game details" are set to Public!'
      });
    }

    const seed = getDailySeed(steamId, rerollOffset);
    const chosenGame = games.at(seed % games.length);
    const headerImage = `https://steamstatic.com{chosenGame.appid}/header.jpg`;

    let challenge = {
      type: 'Custom Quest',
      title: 'Explorer’s Trial',
      description: genericChallenges.at(seed % genericChallenges.length),
      icon: null
    };

    const achUrl = `https://steampowered.com{chosenGame.appid}&key=${STEAM_API_KEY}&steamid=${steamId}`;
    const schemaUrl = `https://steampowered.com{STEAM_API_KEY}&appid=${chosenGame.appid}`;

    const [achRes, schemaRes] = await Promise.all([fetch(achUrl), fetch(schemaUrl)]);
    const achData = await achRes.json();
    const schemaData = await schemaRes.json();

    const playerAchs = (achData.playerstats && achData.playerstats.achievements) || [];
    const schemaAchs = (schemaData.game && schemaData.game.availableGameStats && schemaData.game.availableGameStats.achievements) || [];
    const lockedAchs = playerAchs.filter(a => a.achieved === 0);

    if (lockedAchs.length > 0 && schemaAchs.length > 0) {
      const targetAch = lockedAchs.at(seed % lockedAchs.length);
      const details = schemaAchs.find(s => s.name === targetAch.apiname);

      if (details) {
        challenge = {
          type: 'Steam Achievement',
          title: details.displayName,
          description: details.description || 'Hidden Steam Achievement — unlock it in-game to reveal its secret!',
          icon: details.icon
        };
      }
    }

    res.json({
      game: {
        appid: chosenGame.appid,
        name: chosenGame.name,
        playtimeHours: Math.round((chosenGame.playtime_forever || 0) / 60),
        headerImage
      },
      challenge,
      totalGames: games.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to connect to Steam servers.' });
  }
});

app.listen(PORT, () => console.log(`Server running on ${BASE_URL}`));
