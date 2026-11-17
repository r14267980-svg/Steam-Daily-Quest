require('dotenv').config();
const express = require('express');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');
const https = require('https');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || 'https://onrender.com').replace(/\/$/, '');
const STEAM_API_KEY = (process.env.STEAM_API_KEY || '').trim();
const STEAM_API_HOST = ['https://api', 'steampowered', 'com'].join('.');
const STEAM_CDN_HOST = ['https://shared', 'akamai', 'steamstatic', 'com'].join('.');

app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());

passport.use(new SteamStrategy({
    returnURL: BASE_URL + '/auth/steam/return',
    realm: BASE_URL + '/',
    apiKey: STEAM_API_KEY,
    stateless: true
  },
  function(identifier, profile, done) {
    return done(null, profile);
  }
));

function fetchSteamJson(url, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 3;
  return new Promise(function(resolve, reject) {
    https.get(url, { family: 4, headers: { 'User-Agent': 'SteamDailyQuest/1.0' } }, function(res) {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
        return resolve(fetchSteamJson(res.headers.location, redirectsLeft - 1));
      }
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('HTTP ' + res.statusCode));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Invalid JSON from Steam'));
        }
      });
    }).on('error', reject);
  });
}

app.get('/auth/steam', passport.authenticate('steam', { session: false }));

app.get('/auth/steam/return', function(req, res, next) {
  passport.authenticate('steam', { session: false }, function(err, user) {
    if (err || !user) {
      console.error('Steam login error:', err);
      return res.redirect('/?error=login_failed');
    }
    const name = encodeURIComponent(user.displayName || 'Steam Player');
    const avatar = encodeURIComponent((user.photos && user.photos.at(-1) && user.photos.at(-1).value) || '');
    return res.redirect('/?steamid=' + user.id + '&name=' + name + '&avatar=' + avatar);
  })(req, res, next);
});

function getDailySeed(steamId, offset) {
  const today = new Date().toISOString().slice(0, 10);
  const str = steamId + '-' + today + '-' + offset;
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

app.get('/api/daily-quest', async function(req, res) {
  const steamId = req.query.steamid;
  if (!steamId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const rerollOffset = parseInt(req.query.reroll || '0', 10);

  try {
    const gamesUrl = new URL(STEAM_API_HOST + '/IPlayerService/GetOwnedGames/v0001/');
    gamesUrl.searchParams.set('key', STEAM_API_KEY);
    gamesUrl.searchParams.set('steamid', steamId);
    gamesUrl.searchParams.set('include_appinfo', '1');
    gamesUrl.searchParams.set('include_played_free_games', '1');
    gamesUrl.searchParams.set('format', 'json');

    const gamesData = await fetchSteamJson(gamesUrl.toString());
    const games = gamesData.response && gamesData.response.games;

    if (!games || games.length === 0) {
      return res.status(400).json({
        error: 'No games found. Make sure your Steam Profile "Game details" are set to Public!'
      });
    }

    const seed = getDailySeed(steamId, rerollOffset);
    const chosenGame = games.at(seed % games.length);
    const headerImage = STEAM_CDN_HOST + '/store_item_assets/steam/apps/' + chosenGame.appid + '/header.jpg';

    let challenge = {
      type: 'Custom Quest',
      title: 'Explorer’s Trial',
      description: genericChallenges.at(seed % genericChallenges.length),
      icon: null
    };

    try {
      const achUrl = new URL(STEAM_API_HOST + '/ISteamUserStats/GetPlayerAchievements/v0001/');
      achUrl.searchParams.set('appid', chosenGame.appid);
      achUrl.searchParams.set('key', STEAM_API_KEY);
      achUrl.searchParams.set('steamid', steamId);

      const schemaUrl = new URL(STEAM_API_HOST + '/ISteamUserStats/GetSchemaForGame/v2/');
      schemaUrl.searchParams.set('key', STEAM_API_KEY);
      schemaUrl.searchParams.set('appid', chosenGame.appid);

      const [achData, schemaData] = await Promise.all([
        fetchSteamJson(achUrl.toString()),
        fetchSteamJson(schemaUrl.toString())
      ]);

      const playerAchs = (achData.playerstats && achData.playerstats.achievements) || [];
      const schemaAchs = (schemaData.game && schemaData.game.availableGameStats && schemaData.game.availableGameStats.achievements) || [];
      const lockedAchs = playerAchs.filter(function(a) { return a.achieved === 0; });

      if (lockedAchs.length > 0 && schemaAchs.length > 0) {
        const targetAch = lockedAchs.at(seed % lockedAchs.length);
        const details = schemaAchs.find(function(s) { return s.name === targetAch.apiname; });

        if (details) {
          challenge = {
            type: 'Steam Achievement',
            title: details.displayName,
            description: details.description || 'Hidden Steam Achievement — unlock it in-game to reveal its secret!',
            icon: details.icon
          };
        }
      }
    } catch (achErr) {
      console.log('Using custom quest fallback.');
    }

    res.json({
      game: {
        appid: chosenGame.appid,
        name: chosenGame.name,
        playtimeHours: Math.round((chosenGame.playtime_forever || 0) / 60),
        headerImage: headerImage
      },
      challenge: challenge,
      totalGames: games.length
    });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Steam API error: ' + err.message });
  }
});

app.listen(PORT, function() {
  console.log('Server running on ' + BASE_URL);
});
