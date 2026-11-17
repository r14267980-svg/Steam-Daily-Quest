require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STEAM_API_KEY = process.env.STEAM_API_KEY;

app.use(session({
  secret: process.env.SESSION_SECRET || 'super-secret-steam-quest-key',
  resave: true,
  saveUninitialized: true,
  proxy: true,
  cookie: {
    secure: 'auto',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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

// Auth Routes with error logging
app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return', (req, res, next) => {
  passport.authenticate('steam', (err, user, info) => {
    if (err) {
      console.error('Steam Auth Error:', err);
      return res.redirect('/?auth_error=steam_error');
    }
    if (!user) {
      console.error('Steam Auth Failed:', info);
      return res.redirect('/?auth_error=no_user');
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Session Login Error:', loginErr);
        return res.redirect('/?auth_error=session_error');
      }
      return res.redirect('/');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

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

const genericChallenges = [
  "Play for at least 30 minutes without checking a guide or wiki.",
  "Complete one main story mission, level, or full multiplayer match.",
  "Try a weapon, character, or playstyle you normally ignore.",
  "Play on one difficulty level higher than your usual comfort zone.",
  "Explore an area of the map you haven't visited in a while."
];

app.get('/api/daily-quest', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const steamId = req.user.id;
  const rerollOffset = parseInt(req.query.reroll || '0', 10);

  try {
    const gamesUrl = `https://steampowered.com{STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
    const gamesRes = await fetch(gamesUrl);
    const gamesData = await gamesRes.json();

    const games = gamesData.response?.games;
    if (!games || games.length === 0) {
      return res.status(400).json({
        error: 'No games found. Make sure your Steam Profile "Game details" are set to Public!'
      });
    }

    const seed = getDailySeed(steamId, rerollOffset);
    const chosenGame = games[seed % games.length];
    const headerImage = `https://steamstatic.com{chosenGame.appid}/header.jpg`;

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
        avatar: req.user.photos?.[0]?.value || ''
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
