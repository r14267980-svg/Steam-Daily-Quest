require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Session & Passport setup for Steam OpenID
app.use(session({
  secret: process.env.SESSION_SECRET || 'super-secret-steam-quest-key',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: `${BASE_URL}/auth/steam/return`,
    realm: `${BASE_URL}/`,
    apiKey: STEAM_API_KEY
  },
  (identifier, profile, done) => {
    process.nextTick(() => done(null, profile));
  }
));

// Auth Routes
app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// Helper: Deterministic daily number from SteamID + YYYY-MM-DD
function getDailySeed(steamId, offset = 0) {
  const today = new Date().toISOString().split('T')[0];
  const str = `${steamId}-${today}-${offset}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Fallback challenges if a game has no Steam achievements
const genericChallenges = [
  "Play for at least 30 minutes without checking a guide or wiki.",
  "Complete one main story mission, level, or full multiplayer match.",
  "Try a weapon, character, or playstyle you normally ignore.",
  "Play on one difficulty level higher than your usual comfort zone.",
  "Explore an area of the map you haven't visited in a while."
];

// API Route: Get Daily Game & Challenge
app.get('/api/daily-quest', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const steamId = req.user.id;
  const rerollOffset = parseInt(req.query.reroll || '0', 10);

  try {
    // 1. Fetch Owned Games
    const gamesUrl = `https://steampowered.com{STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
    const gamesRes = await fetch(gamesUrl);
    const gamesData = await gamesRes.json();

    const games = gamesData.response?.games;
    if (!games || games.length === 0) {
      return res.status(400).json({
        error: 'No games found. Make sure your Steam Profile "Game details" are set to Public!'
      });
    }

    // 2. Pick a game using daily seed
    const seed = getDailySeed(steamId, rerollOffset);
    const chosenGame = games[seed % games.length];
    const headerImage = `https://steamstatic.com{chosenGame.appid}/header.jpg`;

    // 3. Fetch Player Achievements & Game Schema
    let challenge = {
      type: 'Custom Quest',
      title: 'Explorer’s Trial',
      description: genericChallenges[seed % genericChallenges.length],
      icon: null
    };

    const achUrl = `https://steampowered.com{chosenGame.appid}&key=${STEAM_API_KEY}&steamid=${steamId}`;
    const schemaUrl = `https://steampowered.com{STEAM_API_KEY}&appid=${chosenGame.appid}`;

    const [achRes, schemaRes] = await Promise.all([fetch(achUrl), fetch(schemaUrl)]);
    const achData = await achRes.json();
    const schemaData = await schemaRes.json();

    const playerAchs = achData.playerstats?.achievements || [];
    const schemaAchs = schemaData.game?.availableGameStats?.achievements || [];

    // Filter for uncompleted achievements
    const lockedAchs = playerAchs.filter(a => a.achieved === 0);

    if (lockedAchs.length > 0 && schemaAchs.length > 0) {
      const targetAch = lockedAchs[seed % lockedAchs.length];
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
      user: {
        name: req.user.displayName,
        avatar: req.user.photos?.[2]?.value || ''
      },
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
