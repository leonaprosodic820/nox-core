'use strict';
/**
 * PROMETHEUS WEB INTELLIGENCE v2.0
 * Complete web intelligence module with 60+ functions
 * All APIs are free/public - no authentication required (except demo keys)
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');

// ═══════════════════════════════════════════════════════════
// SECTION 1: CORE HTTP ENGINE v2.1
// ═══════════════════════════════════════════════════════════

// HTTP Keep-Alive agents — réutilisation des connexions TCP
const HTTP_AGENT = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 25, maxFreeSockets: 10 });
const HTTPS_AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 25, maxFreeSockets: 10 });

const CACHE = new Map();
const CACHE_TTL = 300000;
const IN_FLIGHT = new Map();

function cached(key, ttl, fn) {
  if (typeof ttl === 'function') { fn = ttl; ttl = CACHE_TTL; }
  const entry = CACHE.get(key);
  if (entry && Date.now() - entry.ts < (ttl || CACHE_TTL)) return Promise.resolve(entry.data);
  if (IN_FLIGHT.has(key)) return IN_FLIGHT.get(key);
  if (fn) {
    const p = fn().then(data => {
      CACHE.set(key, { data, ts: Date.now() });
      IN_FLIGHT.delete(key);
      return data;
    }).catch(e => { IN_FLIGHT.delete(key); throw e; });
    IN_FLIGHT.set(key, p);
    return p;
  }
  CACHE.delete(key);
  return Promise.resolve(null);
}

function setCache(key, data) {
  CACHE.set(key, { data, ts: Date.now() });
  return data;
}

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 8000;
    const method = options.method || 'GET';
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      agent: isHttps ? HTTPS_AGENT : HTTP_AGENT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, application/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        ...(options.headers || {})
      }
    };
    const req = mod.request(reqOpts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`;
        return fetchRaw(loc, options).then(resolve, reject);
      }
      const chunks = [];
      let stream = res;
      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers['content-encoding'] === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout ' + timeout + 'ms: ' + url.slice(0, 60))); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchJSON(url, options) {
  const res = await fetchRaw(url, options);
  try {
    return JSON.parse(res.body);
  } catch (e) {
    throw new Error(`JSON parse error from ${url}: ${res.body.slice(0, 200)}`);
  }
}

async function fetchText(url, options) {
  const res = await fetchRaw(url, options);
  return res.body;
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const tag = (name) => {
      const m = block.match(new RegExp(`<${name}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${name}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    items.push({
      title: tag('title'),
      description: tag('description').replace(/<[^>]+>/g, '').slice(0, 300),
      url: tag('link'),
      date: tag('pubDate'),
      author: tag('author') || tag('dc:creator')
    });
    if (items.length >= 20) break;
  }
  return items;
}

function parseXML(xml, tag) {
  const items = [];
  const regex = new RegExp(`<${tag}[\\s>]([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

function xmlVal(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// ═══════════════════════════════════════════════════════════
// SECTION 2: WEATHER
// ═══════════════════════════════════════════════════════════

async function getWeather(city) {
  const key = `weather:${city}`;
  return cached(key, 600000, async () => {
    const enc = encodeURIComponent(city);
    let result;
    try {
      const data = await fetchJSON(`https://wttr.in/${enc}?format=j1`);
      const cur = data.current_condition && data.current_condition[0];
      const forecast = (data.weather || []).slice(0, 5).map((d) => ({
        date: d.date,
        maxtemp_c: d.maxtempC,
        mintemp_c: d.mintempC,
        avg_temp_c: d.avgtempC,
        description: d.hourly && d.hourly[4] && d.hourly[4].weatherDesc && d.hourly[4].weatherDesc[0] ? d.hourly[4].weatherDesc[0].value : '',
        uv: d.uvIndex,
        humidity: d.hourly && d.hourly[4] ? d.hourly[4].humidity : null,
        rain_mm: d.hourly && d.hourly[4] ? d.hourly[4].precipMM : null
      }));
      result = {
        city,
        source: 'wttr.in',
        current: {
          temp_c: cur ? cur.temp_C : null,
          feels_like_c: cur ? cur.FeelsLikeC : null,
          humidity: cur ? cur.humidity : null,
          wind_kmh: cur ? cur.windspeedKmph : null,
          wind_dir: cur ? cur.winddir16Point : null,
          pressure_mb: cur ? cur.pressure : null,
          visibility_km: cur ? cur.visibility : null,
          uv_index: cur ? cur.uvIndex : null,
          cloud_cover: cur ? cur.cloudcover : null,
          description: cur && cur.weatherDesc && cur.weatherDesc[0] ? cur.weatherDesc[0].value : ''
        },
        forecast
      };
    } catch (_) {
      // Fallback to Open-Meteo
      try {
        const geo = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${enc}&count=1`);
        if (!geo.results || !geo.results[0]) throw new Error('City not found');
        const loc = geo.results[0];
        const weather = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`);
        const cw = weather.current_weather || {};
        result = {
          city,
          source: 'open-meteo',
          location: { lat: loc.latitude, lon: loc.longitude, country: loc.country },
          current: {
            temp_c: cw.temperature,
            wind_kmh: cw.windspeed,
            wind_dir: cw.winddirection,
            description: `WMO code ${cw.weathercode}`
          },
          forecast: (weather.daily?.time || []).slice(0, 5).map((t, i) => ({
            date: t,
            maxtemp_c: weather.daily.temperature_2m_max[i],
            mintemp_c: weather.daily.temperature_2m_min[i],
            precip_mm: weather.daily.precipitation_sum[i]
          }))
        };
      } catch (e2) {
        result = { city, error: e2.message };
      }
    }
    return result;
  });
}

async function compareWeather(cities) {
  const list = Array.isArray(cities) ? cities : cities.split(',').map(c => c.trim());
  const results = await Promise.allSettled(list.map(c => getWeather(c)));
  return {
    comparison: list.map((city, i) => ({
      city,
      data: results[i].status === 'fulfilled' ? results[i].value : { error: results[i].reason?.message }
    }))
  };
}

async function getWeatherAlerts(city) {
  try {
    const w = await getWeather(city);
    const alerts = [];
    if (w.current) {
      const temp = parseInt(w.current.temp_c);
      const wind = parseInt(w.current.wind_kmh);
      const humidity = parseInt(w.current.humidity);
      if (temp >= 35) alerts.push({ type: 'heat', severity: 'high', message: `Extreme heat: ${temp}C` });
      if (temp <= 0) alerts.push({ type: 'cold', severity: 'medium', message: `Freezing: ${temp}C` });
      if (temp <= -10) alerts.push({ type: 'extreme_cold', severity: 'high', message: `Extreme cold: ${temp}C` });
      if (wind >= 60) alerts.push({ type: 'wind', severity: 'high', message: `Strong winds: ${wind} km/h` });
      if (wind >= 90) alerts.push({ type: 'storm', severity: 'critical', message: `Storm winds: ${wind} km/h` });
      if (humidity >= 90) alerts.push({ type: 'humidity', severity: 'low', message: `Very high humidity: ${humidity}%` });
      const uv = parseInt(w.current.uv_index);
      if (uv >= 8) alerts.push({ type: 'uv', severity: 'high', message: `High UV index: ${uv}` });
    }
    return { city, alerts, weather: w.current };
  } catch (e) {
    return { city, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 3: SEARCH
// ═══════════════════════════════════════════════════════════

async function search(query) {
  const key = `search:${query}`;
  return cached(key, 600000, async () => {
    const enc = encodeURIComponent(query);
    const results = [];

    // DuckDuckGo
    try {
      const ddg = await fetchJSON(`https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1`);
      if (ddg.AbstractText) results.push({ source: 'duckduckgo', type: 'instant', title: ddg.Heading || query, text: ddg.AbstractText, url: ddg.AbstractURL || '' });
      if (ddg.RelatedTopics) {
        ddg.RelatedTopics.slice(0, 5).forEach((t) => {
          if (t.Text) results.push({ source: 'duckduckgo', type: 'related', title: t.FirstURL ? t.FirstURL.split('/').pop().replace(/_/g, ' ') : '', text: t.Text, url: t.FirstURL || '' });
        });
      }
      if (ddg.Infobox && ddg.Infobox.content) {
        results.push({ source: 'duckduckgo', type: 'infobox', data: ddg.Infobox.content.slice(0, 10) });
      }
    } catch (_) {}

    // Wikipedia FR
    try {
      const wiki = await fetchJSON(`https://fr.wikipedia.org/api/rest_v1/page/summary/${enc}`);
      if (wiki.extract) results.push({ source: 'wikipedia_fr', type: 'summary', title: wiki.title || query, text: wiki.extract, url: wiki.content_urls && wiki.content_urls.desktop ? wiki.content_urls.desktop.page : '', image: wiki.thumbnail ? wiki.thumbnail.source : null });
    } catch (_) {}

    // Wikipedia EN fallback
    if (!results.find(r => r.source === 'wikipedia_fr')) {
      try {
        const wiki = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`);
        if (wiki.extract) results.push({ source: 'wikipedia_en', type: 'summary', title: wiki.title || query, text: wiki.extract, url: wiki.content_urls && wiki.content_urls.desktop ? wiki.content_urls.desktop.page : '', image: wiki.thumbnail ? wiki.thumbnail.source : null });
      } catch (_) {}
    }

    // Wikidata
    try {
      const wd = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc}&language=en&format=json&limit=3`);
      if (wd.search) {
        wd.search.forEach(item => {
          results.push({ source: 'wikidata', type: 'entity', id: item.id, title: item.label, text: item.description || '', url: item.concepturi });
        });
      }
    } catch (_) {}

    // OpenLibrary
    try {
      const ol = await fetchJSON(`https://openlibrary.org/search.json?q=${enc}&limit=3`);
      if (ol.docs && ol.docs.length > 0) {
        ol.docs.slice(0, 3).forEach(book => {
          results.push({ source: 'openlibrary', type: 'book', title: book.title, author: book.author_name ? book.author_name[0] : '', year: book.first_publish_year, url: `https://openlibrary.org${book.key}` });
        });
      }
    } catch (_) {}

    return { query, result_count: results.length, results };
  });
}

async function searchImages(query) {
  const key = `images:${query}`;
  return cached(key, 600000, async () => {
    try {
      const enc = encodeURIComponent(query);
      const data = await fetchJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc}&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata&format=json`);
      const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
      return {
        query,
        images: pages.map(p => ({
          title: p.title,
          url: p.imageinfo && p.imageinfo[0] ? p.imageinfo[0].url : null,
          description: p.imageinfo && p.imageinfo[0] && p.imageinfo[0].extmetadata && p.imageinfo[0].extmetadata.ImageDescription ? p.imageinfo[0].extmetadata.ImageDescription.value.replace(/<[^>]+>/g, '').slice(0, 200) : ''
        })).filter(i => i.url)
      };
    } catch (e) {
      // Fallback 2 — Pixabay
      try {
        const enc = encodeURIComponent(query);
        const d = await fetchJSON(`https://pixabay.com/api/?key=20691576-4a8e92d75826b51a946fd571a&q=${enc}&image_type=photo&per_page=8`, { timeout: 5000 });
        return {
          query, source: 'Pixabay',
          images: (d.hits || []).map(h => ({
            title: h.tags,
            url: h.webformatURL || h.largeImageURL,
            description: h.tags
          }))
        };
      } catch (e2) {}
      return { query, error: 'All sources failed' };
    }
  });
}

async function searchAcademic(query) {
  const key = `academic:${query}`;
  return cached(key, 900000, async () => {
    const enc = encodeURIComponent(query);
    const results = [];

    // Arxiv
    try {
      const xml = await fetchText(`https://export.arxiv.org/api/query?search_query=all:${enc}&start=0&max_results=5`);
      const entries = parseXML(xml, 'entry');
      entries.forEach(entry => {
        results.push({
          source: 'arxiv',
          title: xmlVal(entry, 'title').replace(/\s+/g, ' '),
          summary: xmlVal(entry, 'summary').replace(/\s+/g, ' ').slice(0, 300),
          authors: (entry.match(/<name>([^<]+)<\/name>/g) || []).map(n => n.replace(/<\/?name>/g, '')).slice(0, 5),
          published: xmlVal(entry, 'published').slice(0, 10),
          url: xmlVal(entry, 'id')
        });
      });
    } catch (_) {}

    // PubMed
    try {
      const pm = await fetchJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc}&retmax=5&retmode=json`);
      const ids = pm.esearchresult && pm.esearchresult.idlist ? pm.esearchresult.idlist : [];
      if (ids.length > 0) {
        const details = await fetchJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`);
        ids.forEach(id => {
          const doc = details.result && details.result[id];
          if (doc) {
            results.push({
              source: 'pubmed',
              title: doc.title,
              authors: (doc.authors || []).slice(0, 5).map(a => a.name),
              journal: doc.fulljournalname || doc.source,
              date: doc.pubdate,
              url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
              pmid: id
            });
          }
        });
      }
    } catch (_) {}

    return { query, result_count: results.length, results };
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 4: SPORTS
// ═══════════════════════════════════════════════════════════

const LEAGUES = {
  ligue1: { sport: 'soccer/fra.1', name: 'Ligue 1' },
  ligue2: { sport: 'soccer/fra.2', name: 'Ligue 2' },
  premierleague: { sport: 'soccer/eng.1', name: 'Premier League' },
  championship: { sport: 'soccer/eng.2', name: 'Championship' },
  laliga: { sport: 'soccer/esp.1', name: 'La Liga' },
  seriea: { sport: 'soccer/ita.1', name: 'Serie A' },
  bundesliga: { sport: 'soccer/ger.1', name: 'Bundesliga' },
  eredivisie: { sport: 'soccer/ned.1', name: 'Eredivisie' },
  liganos: { sport: 'soccer/por.1', name: 'Liga Portugal' },
  ucl: { sport: 'soccer/uefa.champions', name: 'Champions League' },
  uel: { sport: 'soccer/uefa.europa', name: 'Europa League' },
  uecl: { sport: 'soccer/uefa.europa.conf', name: 'Conference League' },
  mls: { sport: 'soccer/usa.1', name: 'MLS' },
  nba: { sport: 'basketball/nba', name: 'NBA' },
  euroleague: { sport: 'basketball/eur.euroleague', name: 'Euroleague' },
  nfl: { sport: 'football/nfl', name: 'NFL' },
  nhl: { sport: 'hockey/nhl', name: 'NHL' },
  mlb: { sport: 'baseball/mlb', name: 'MLB' },
  f1: { sport: 'racing/f1', name: 'Formula 1' },
  motogp: { sport: 'racing/motogp', name: 'MotoGP' },
  tennis_atp: { sport: 'tennis/atp', name: 'ATP Tennis' },
  tennis_wta: { sport: 'tennis/wta', name: 'WTA Tennis' },
  rugby_top14: { sport: 'rugby/fra.top14', name: 'Top 14' },
  rugby_6nations: { sport: 'rugby/6nations', name: 'Six Nations' },
  ufc: { sport: 'mma/ufc', name: 'UFC' }
};

async function getSports(league) {
  const key = `sports:${league}`;
  return cached(key, 300000, async () => {
    const cfg = LEAGUES[league] || LEAGUES.ligue1;
    const path = cfg.sport;
    try {
      const data = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
      const events = (data.events || []).map((e) => {
        const comps = e.competitions && e.competitions[0];
        const teams = comps ? comps.competitors || [] : [];
        const home = teams.find((t) => t.homeAway === 'home') || teams[0] || {};
        const away = teams.find((t) => t.homeAway === 'away') || teams[1] || {};
        return {
          name: e.name,
          date: e.date,
          venue: comps && comps.venue ? comps.venue.fullName : null,
          home: { name: home.team ? home.team.displayName : '', score: home.score || '0', logo: home.team ? home.team.logo : null },
          away: { name: away.team ? away.team.displayName : '', score: away.score || '0', logo: away.team ? away.team.logo : null },
          status: comps && comps.status ? comps.status.type.description : '',
          clock: comps && comps.status ? comps.status.displayClock : null,
          period: comps && comps.status ? comps.status.period : null,
          broadcast: comps && comps.broadcasts && comps.broadcasts[0] ? comps.broadcasts[0].names : null
        };
      });
      return { league: cfg.name, event_count: events.length, events };
    } catch (e) {
      // Fallback 2 — TheSportsDB
      try {
        const today = new Date().toISOString().slice(0, 10);
        const sportMap = { ligue1: 'Soccer', premierleague: 'Soccer', laliga: 'Soccer', bundesliga: 'Soccer', seriea: 'Soccer', nba: 'Basketball', nfl: 'American_Football', nhl: 'Ice_Hockey', mlb: 'Baseball' };
        const sport = sportMap[league] || 'Soccer';
        const d = await fetchJSON(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${today}&s=${sport}`, { timeout: 5000 });
        const events = (d.events || []).slice(0, 20).map(ev => ({
          name: `${ev.strHomeTeam} vs ${ev.strAwayTeam}`,
          date: ev.dateEvent,
          venue: ev.strVenue,
          home: { name: ev.strHomeTeam, score: ev.intHomeScore || '0', logo: null },
          away: { name: ev.strAwayTeam, score: ev.intAwayScore || '0', logo: null },
          status: ev.strStatus || '',
          clock: null,
          period: null,
          broadcast: null
        }));
        return { league: cfg.name, source: 'TheSportsDB', event_count: events.length, events };
      } catch (e2) {}
      return { league: cfg.name, error: 'All sources failed' };
    }
  });
}

async function getStandings(league = 'ligue1') {
  const key = `standings:${league}`;
  return cached(key, 600000, async () => {
    const cfg = LEAGUES[league] || LEAGUES.ligue1;
    try {
      const d = await fetchJSON(`https://site.api.espn.com/apis/v2/sports/${cfg.sport}/standings`);
      const groups = d.children || [];
      const allEntries = [];
      groups.forEach(group => {
        const entries = group.standings?.entries || [];
        entries.forEach(e => {
          const s = n => e.stats?.find(x => x.name === n)?.value;
          allEntries.push({
            rank: s('rank'),
            team: e.team?.displayName,
            logo: e.team?.logos?.[0]?.href,
            wins: s('wins'),
            losses: s('losses'),
            draws: s('ties'),
            points: s('points'),
            gamesPlayed: s('gamesPlayed'),
            gf: s('pointsFor'),
            ga: s('pointsAgainst'),
            gd: s('pointDifferential'),
            group: group.name || null
          });
        });
      });
      return {
        league: cfg.name,
        standings: allEntries.sort((a, b) => (a.rank || 99) - (b.rank || 99))
      };
    } catch (e) {
      // Fallback 2 — TheSportsDB
      try {
        const leagueIds = { ligue1: '4334', premierleague: '4328', laliga: '4335', bundesliga: '4331', seriea: '4332' };
        const lid = leagueIds[league];
        if (lid) {
          const season = new Date().getFullYear() - 1 + '-' + new Date().getFullYear();
          const d = await fetchJSON(`https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${lid}&s=${season}`, { timeout: 5000 });
          const allEntries = (d.table || []).map(t => ({
            rank: parseInt(t.intRank),
            team: t.strTeam,
            logo: t.strTeamBadge,
            wins: parseInt(t.intWin),
            losses: parseInt(t.intLoss),
            draws: parseInt(t.intDraw),
            points: parseInt(t.intPoints),
            gamesPlayed: parseInt(t.intPlayed),
            gf: parseInt(t.intGoalsFor),
            ga: parseInt(t.intGoalsAgainst),
            gd: parseInt(t.intGoalDifference),
            group: null
          }));
          return { league: cfg.name, source: 'TheSportsDB', standings: allEntries };
        }
      } catch (e2) {}
      return { league: cfg.name, error: 'All sources failed' };
    }
  });
}

async function getPlayerStats(playerName) {
  try {
    const enc = encodeURIComponent(playerName);
    const data = await fetchJSON(`https://site.api.espn.com/apis/common/v3/search?query=${enc}&limit=5&type=player`);
    const items = data.items || data.results || [];
    return {
      query: playerName,
      players: items.slice(0, 5).map(p => ({
        name: p.displayName || p.name,
        team: p.team?.displayName,
        position: p.position,
        league: p.league?.name,
        url: p.link || p.$ref
      }))
    };
  } catch (e) {
    // Fallback 2 — TheSportsDB
    try {
      const enc = encodeURIComponent(playerName);
      const d = await fetchJSON(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${enc}`, { timeout: 5000 });
      return {
        query: playerName,
        source: 'TheSportsDB',
        players: (d.player || []).slice(0, 5).map(p => ({
          name: p.strPlayer,
          team: p.strTeam,
          position: p.strPosition,
          league: p.strLeague,
          url: null
        }))
      };
    } catch (e2) {}
    return { query: playerName, error: 'All sources failed' };
  }
}

async function getF1Calendar() {
  const key = 'f1:calendar';
  return cached(key, 86400000, async () => {
    try {
      const data = await fetchJSON('https://ergast.com/api/f1/current.json');
      const races = data.MRData?.RaceTable?.Races || [];
      return {
        season: data.MRData?.RaceTable?.season,
        races: races.map(r => ({
          round: r.round,
          name: r.raceName,
          circuit: r.Circuit?.circuitName,
          location: `${r.Circuit?.Location?.locality}, ${r.Circuit?.Location?.country}`,
          date: r.date,
          time: r.time
        }))
      };
    } catch (e) {
      // Fallback 2 — Jolpica
      try {
        const year = new Date().getFullYear();
        const d = await fetchJSON(`https://api.jolpi.ca/ergast/f1/${year}.json`, { timeout: 5000 });
        const races = d.MRData?.RaceTable?.Races || [];
        return {
          source: 'Jolpica',
          season: d.MRData?.RaceTable?.season,
          races: races.map(r => ({
            round: r.round,
            name: r.raceName,
            circuit: r.Circuit?.circuitName,
            location: `${r.Circuit?.Location?.locality}, ${r.Circuit?.Location?.country}`,
            date: r.date,
            time: r.time
          }))
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

async function getF1Standings() {
  const key = 'f1:standings';
  return cached(key, 600000, async () => {
    try {
      const [drivers, constructors] = await Promise.all([
        fetchJSON('https://ergast.com/api/f1/current/driverStandings.json'),
        fetchJSON('https://ergast.com/api/f1/current/constructorStandings.json')
      ]);
      const dl = drivers.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
      const cl = constructors.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
      return {
        drivers: dl.map(d => ({
          position: d.position,
          driver: `${d.Driver?.givenName} ${d.Driver?.familyName}`,
          team: d.Constructors?.[0]?.name,
          points: d.points,
          wins: d.wins
        })),
        constructors: cl.map(c => ({
          position: c.position,
          team: c.Constructor?.name,
          points: c.points,
          wins: c.wins
        }))
      };
    } catch (e) {
      // Fallback 2 — Jolpica
      try {
        const year = new Date().getFullYear();
        const [drivers, constructors] = await Promise.all([
          fetchJSON(`https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`, { timeout: 5000 }),
          fetchJSON(`https://api.jolpi.ca/ergast/f1/${year}/constructorStandings.json`, { timeout: 5000 })
        ]);
        const dl = drivers.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
        const cl = constructors.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
        return {
          source: 'Jolpica',
          drivers: dl.map(d => ({
            position: d.position,
            driver: `${d.Driver?.givenName} ${d.Driver?.familyName}`,
            team: d.Constructors?.[0]?.name,
            points: d.points,
            wins: d.wins
          })),
          constructors: cl.map(c => ({
            position: c.position,
            team: c.Constructor?.name,
            points: c.points,
            wins: c.wins
          }))
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 5: NEWS
// ═══════════════════════════════════════════════════════════

const NEWS_SOURCES = {
  // France
  monde: 'https://www.lemonde.fr/rss/une.xml',
  figaro: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',
  liberation: 'https://www.liberation.fr/arc/outboundfeeds/rss-collection/accueil-702/',
  france24_fr: 'https://www.france24.com/fr/rss',
  lequipe: 'https://dwh.lequipe.fr/api/edito/rss?path=/',
  eurosport: 'https://www.eurosport.fr/rss.xml',
  rmcsport: 'https://rmcsport.bfmtv.com/rss/news-24-7/',
  '01net': 'https://www.01net.com/rss/info/flux-rss/flux-toutes-les-actualites/',
  // International
  bbc_world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  bbc_tech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  bbc_science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  bbc_business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  reuters: 'https://www.reutersagency.com/feed/',
  guardian: 'https://www.theguardian.com/world/rss',
  nytimes: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
  cnn: 'http://rss.cnn.com/rss/edition.rss',
  aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  dw: 'https://rss.dw.com/rdf/rss-en-all',
  // Tech
  hn: 'https://hnrss.org/frontpage',
  hn_best: 'https://hnrss.org/best',
  techcrunch: 'https://techcrunch.com/feed/',
  verge: 'https://www.theverge.com/rss/index.xml',
  ars: 'https://feeds.arstechnica.com/arstechnica/index',
  wired: 'https://www.wired.com/feed/rss',
  // Science
  nature: 'https://www.nature.com/nature.rss',
  science: 'https://www.science.org/rss/news_current.xml',
  nasa_breaking: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  // Crypto / Finance
  coindesk: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  cointelegraph: 'https://cointelegraph.com/rss',
  // Gaming
  ign: 'https://feeds.feedburner.com/ign/all',
  // Security
  krebs: 'https://krebsonsecurity.com/feed/',
  bleeping: 'https://www.bleepingcomputer.com/feed/',
  hackernews_sec: 'https://feeds.feedburner.com/TheHackersNews'
};

async function getNews(source, opts = {}) {
  const key = `news:${source}:${opts.limit || 10}`;
  return cached(key, 180000, async () => {
    const fallbacks = {
      lequipe: ['eurosport','rmcsport'],
      aljazeera: ['bbc_world','reuters'],
    };
    const sourcesToTry = [source, ...(fallbacks[source] || [])];
    const limit = opts.limit || 10;
    const keyword = opts.keyword ? opts.keyword.toLowerCase() : null;

    for (const src of sourcesToTry) {
      const url = NEWS_SOURCES[src] || src;
      try {
        const xml = await fetchText(url, { timeout: 6000 });
        if (!xml || xml.length < 100) continue;
        const articles = parseRSS(xml);
        if (articles.length === 0) continue;
        let filtered = articles;
        if (keyword) {
          filtered = articles.filter(a => a.title.toLowerCase().includes(keyword) || a.description.toLowerCase().includes(keyword));
        }
        return { source: src, originalSource: source, url, article_count: filtered.length, articles: filtered.slice(0, limit) };
      } catch (e) { continue; }
    }
    return { source, error: 'Toutes les sources ont échoué', articles: [] };
  });
}

async function getMultiNews(sources, opts = {}) {
  const list = Array.isArray(sources) ? sources : sources.split(',').map(s => s.trim());
  const results = await Promise.allSettled(list.map(s => getNews(s, opts)));
  const allArticles = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.articles) {
      r.value.articles.forEach(a => {
        a.source = list[i];
        allArticles.push(a);
      });
    }
  });
  // Sort by date if available
  allArticles.sort((a, b) => {
    try { return new Date(b.date) - new Date(a.date); } catch (_) { return 0; }
  });
  return { sources: list, total_articles: allArticles.length, articles: allArticles.slice(0, opts.limit || 20) };
}

async function searchNews(query, opts = {}) {
  const sources = ['monde', 'bbc_world', 'guardian', 'reuters', 'hn'];
  return getMultiNews(sources, { ...opts, keyword: query });
}

// ═══════════════════════════════════════════════════════════
// SECTION 6: FINANCE
// ═══════════════════════════════════════════════════════════

async function getStock(symbol) {
  const key = `stock:${symbol}`;
  return cached(key, 300000, async () => {
    try {
      const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
      const meta = data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      if (!meta) return { symbol, error: 'No data' };
      const price = meta.regularMarketPrice;
      const prev = meta.previousClose || meta.chartPreviousClose;
      const change = price && prev ? +(price - prev).toFixed(2) : null;
      const changePct = price && prev ? +(((price - prev) / prev) * 100).toFixed(2) : null;
      const result0 = data.chart.result[0];
      const closes = result0.indicators?.quote?.[0]?.close || [];
      return {
        symbol,
        name: meta.shortName || meta.longName || symbol,
        currency: meta.currency,
        exchange: meta.exchangeName,
        price,
        previous_close: prev,
        change,
        change_pct: changePct,
        day_high: meta.regularMarketDayHigh,
        day_low: meta.regularMarketDayLow,
        volume: meta.regularMarketVolume,
        market_cap: meta.marketCap,
        fifty_two_week_high: meta.fiftyTwoWeekHigh,
        fifty_two_week_low: meta.fiftyTwoWeekLow,
        recent_closes: closes.slice(-5).map(c => c ? +c.toFixed(2) : null)
      };
    } catch (e) {
      // Fallback 2 — Stooq CSV
      try {
        const csv = await fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`, { timeout: 5000 });
        const lines = csv.trim().split('\n');
        if (lines.length >= 2) {
          const headers = lines[0].split(',');
          const vals = lines[1].split(',');
          const row = {};
          headers.forEach((h, i) => row[h.trim().toLowerCase()] = vals[i]?.trim());
          const price = parseFloat(row.close);
          const open = parseFloat(row.open);
          const change = price && open ? +(price - open).toFixed(2) : null;
          const changePct = price && open ? +(((price - open) / open) * 100).toFixed(2) : null;
          return {
            symbol, source: 'Stooq', name: symbol, currency: null, exchange: null,
            price, previous_close: open, change, change_pct: changePct,
            day_high: parseFloat(row.high) || null,
            day_low: parseFloat(row.low) || null,
            volume: parseInt(row.volume) || null,
            market_cap: null, fifty_two_week_high: null, fifty_two_week_low: null,
            recent_closes: [price]
          };
        }
      } catch (e2) {}
      return { symbol, error: 'All sources failed' };
    }
  });
}

// Alias for backward compat
const getStockPrice = getStock;

async function getMultipleStocks(symbols) {
  const list = Array.isArray(symbols) ? symbols : symbols.split(',').map(s => s.trim());
  const results = await Promise.allSettled(list.map(s => getStock(s)));
  return list.map((s, i) => ({
    symbol: s,
    data: results[i].status === 'fulfilled' ? results[i].value : { error: results[i].reason?.message }
  }));
}

async function getMarketIndices() {
  const syms = ['^FCHI', '^GSPC', '^DJI', '^IXIC', '^GDAXI', '^FTSE', '^N225', 'GC=F', 'SI=F', 'CL=F', 'BTC-USD', 'ETH-USD'];
  const names = {
    '^FCHI': 'CAC 40', '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'NASDAQ',
    '^GDAXI': 'DAX', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225',
    'GC=F': 'Gold', 'SI=F': 'Silver', 'CL=F': 'Crude Oil',
    'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum'
  };
  const results = await Promise.allSettled(syms.map(s => getStock(s)));
  return {
    indices: syms.map((s, i) => ({
      name: names[s] || s,
      symbol: s,
      data: results[i].status === 'fulfilled' ? results[i].value : null
    })).filter(i => i.data && !i.data.error)
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 7: CRYPTO
// ═══════════════════════════════════════════════════════════

const CRYPTO_IDS = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  ada: 'cardano', cardano: 'cardano',
  dot: 'polkadot', polkadot: 'polkadot',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  matic: 'matic-network', polygon: 'matic-network',
  link: 'chainlink', chainlink: 'chainlink',
  uni: 'uniswap', uniswap: 'uniswap',
  atom: 'cosmos', cosmos: 'cosmos',
  xrp: 'ripple', ripple: 'ripple',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  shib: 'shiba-inu',
  ltc: 'litecoin', litecoin: 'litecoin',
  bnb: 'binancecoin', binance: 'binancecoin',
  trx: 'tron', tron: 'tron',
  near: 'near', ton: 'the-open-network',
  apt: 'aptos', sui: 'sui'
};

async function getCrypto(coins) {
  const ids = Array.isArray(coins)
    ? coins.map(c => CRYPTO_IDS[c.toLowerCase()] || c).join(',')
    : (coins || 'bitcoin,ethereum').split(',').map(c => CRYPTO_IDS[c.trim().toLowerCase()] || c.trim()).join(',');
  const key = `crypto:${ids}`;
  return cached(key, 180000, async () => {
    try {
      const data = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`);
      return {
        coins: (data || []).map(c => ({
          name: c.name,
          symbol: c.symbol.toUpperCase(),
          price_usd: c.current_price,
          market_cap: c.market_cap,
          volume_24h: c.total_volume,
          change_1h: c.price_change_percentage_1h_in_currency,
          change_24h: c.price_change_percentage_24h,
          change_7d: c.price_change_percentage_7d_in_currency,
          rank: c.market_cap_rank,
          ath: c.ath,
          ath_date: c.ath_date ? c.ath_date.slice(0, 10) : null,
          circulating_supply: c.circulating_supply,
          total_supply: c.total_supply,
          image: c.image
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getCryptoDetail(coinId) {
  const id = CRYPTO_IDS[coinId.toLowerCase()] || coinId;
  const key = `crypto_detail:${id}`;
  return cached(key, 300000, async () => {
    try {
      const data = await fetchJSON(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=true&developer_data=true`);
      return {
        name: data.name,
        symbol: data.symbol?.toUpperCase(),
        description: data.description?.en?.slice(0, 500),
        links: { homepage: data.links?.homepage?.[0], github: data.links?.repos_url?.github?.[0], twitter: data.links?.twitter_screen_name, reddit: data.links?.subreddit_url },
        market_data: {
          price_usd: data.market_data?.current_price?.usd,
          price_eur: data.market_data?.current_price?.eur,
          market_cap: data.market_data?.market_cap?.usd,
          volume_24h: data.market_data?.total_volume?.usd,
          change_24h: data.market_data?.price_change_percentage_24h,
          change_7d: data.market_data?.price_change_percentage_7d,
          change_30d: data.market_data?.price_change_percentage_30d,
          ath: data.market_data?.ath?.usd,
          atl: data.market_data?.atl?.usd,
          circulating: data.market_data?.circulating_supply,
          max_supply: data.market_data?.max_supply
        },
        community: { twitter_followers: data.community_data?.twitter_followers, reddit_subscribers: data.community_data?.reddit_subscribers },
        developer: { stars: data.developer_data?.stars, forks: data.developer_data?.forks, commits_4w: data.developer_data?.commit_count_4_weeks },
        genesis_date: data.genesis_date,
        rank: data.market_cap_rank,
        categories: data.categories?.slice(0, 5)
      };
    } catch (e) {
      // Fallback 2 — CoinCap
      try {
        const d = await fetchJSON(`https://api.coincap.io/v2/assets/${id}`, { timeout: 5000 });
        const a = d.data || {};
        return {
          source: 'CoinCap',
          name: a.name,
          symbol: a.symbol,
          description: null,
          links: { homepage: a.explorer, github: null, twitter: null, reddit: null },
          market_data: {
            price_usd: parseFloat(a.priceUsd),
            price_eur: null,
            market_cap: parseFloat(a.marketCapUsd),
            volume_24h: parseFloat(a.volumeUsd24Hr),
            change_24h: parseFloat(a.changePercent24Hr),
            change_7d: null,
            change_30d: null,
            ath: null,
            atl: null,
            circulating: parseFloat(a.supply),
            max_supply: a.maxSupply ? parseFloat(a.maxSupply) : null
          },
          community: { twitter_followers: null, reddit_subscribers: null },
          developer: { stars: null, forks: null, commits_4w: null },
          genesis_date: null,
          rank: parseInt(a.rank),
          categories: null
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

async function getDefiProtocols() {
  const key = 'defi:protocols';
  return cached(key, 600000, async () => {
    try {
      const data = await fetchJSON('https://api.llama.fi/protocols');
      const top = (data || []).slice(0, 20);
      return {
        protocols: top.map(p => ({
          name: p.name,
          category: p.category,
          chain: p.chain,
          tvl: p.tvl,
          change_1d: p.change_1d,
          change_7d: p.change_7d,
          mcap_tvl: p.mcapTvl
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getGlobalCryptoStats() {
  const key = 'crypto:global';
  return cached(key, 300000, async () => {
    try {
      const d = await fetchJSON('https://api.coingecko.com/api/v3/global');
      const g = d.data || {};
      return {
        total_market_cap_usd: g.total_market_cap?.usd,
        total_volume_24h: g.total_volume?.usd,
        btc_dominance: g.market_cap_percentage?.btc ? g.market_cap_percentage.btc.toFixed(1) + '%' : null,
        eth_dominance: g.market_cap_percentage?.eth ? g.market_cap_percentage.eth.toFixed(1) + '%' : null,
        change_24h: g.market_cap_change_percentage_24h_usd ? g.market_cap_change_percentage_24h_usd.toFixed(2) + '%' : null,
        active_coins: g.active_cryptocurrencies,
        markets: g.markets,
        defi_market_cap: g.total_market_cap?.usd ? 'See DeFi protocols' : null
      };
    } catch (e) {
      // Fallback 2 — CoinCap
      try {
        const d = await fetchJSON('https://api.coincap.io/v2/assets?limit=100', { timeout: 5000 });
        const assets = d.data || [];
        let totalMcap = 0, totalVol = 0, btcMcap = 0, ethMcap = 0;
        assets.forEach(a => {
          const mc = parseFloat(a.marketCapUsd) || 0;
          totalMcap += mc;
          totalVol += parseFloat(a.volumeUsd24Hr) || 0;
          if (a.id === 'bitcoin') btcMcap = mc;
          if (a.id === 'ethereum') ethMcap = mc;
        });
        return {
          source: 'CoinCap',
          total_market_cap_usd: totalMcap,
          total_volume_24h: totalVol,
          btc_dominance: totalMcap ? ((btcMcap / totalMcap) * 100).toFixed(1) + '%' : null,
          eth_dominance: totalMcap ? ((ethMcap / totalMcap) * 100).toFixed(1) + '%' : null,
          change_24h: null,
          active_coins: assets.length,
          markets: null,
          defi_market_cap: null
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 8: FOREX
// ═══════════════════════════════════════════════════════════

async function getForex(base, targets) {
  const key = `forex:${base}:${targets}`;
  return cached(key, 300000, async () => {
    try {
      const data = await fetchJSON(`https://open.er-api.com/v6/latest/${encodeURIComponent(base || 'EUR')}`);
      const rates = {};
      const list = Array.isArray(targets) ? targets : (targets || 'USD,EUR,GBP,CHF,JPY,CAD,AUD').split(',');
      list.forEach((t) => {
        const code = t.trim().toUpperCase();
        if (data.rates && data.rates[code]) rates[code] = data.rates[code];
      });
      return {
        base: data.base_code || base,
        updated: data.time_last_update_utc,
        rates
      };
    } catch (e) {
      // Fallback 2 — Frankfurter (ECB)
      try {
        const b = encodeURIComponent(base || 'EUR');
        const list = Array.isArray(targets) ? targets : (targets || 'USD,EUR,GBP,CHF,JPY,CAD,AUD').split(',');
        const to = list.map(t => t.trim().toUpperCase()).join(',');
        const d = await fetchJSON(`https://api.frankfurter.app/latest?from=${b}&to=${to}`, { timeout: 5000 });
        return {
          base: d.base || base,
          source: 'Frankfurter',
          updated: d.date,
          rates: d.rates || {}
        };
      } catch (e2) {}
      return { base, error: 'All sources failed' };
    }
  });
}

async function getInflationData(country) {
  const key = `inflation:${country}`;
  return cached(key, 86400000, async () => {
    try {
      const enc = encodeURIComponent(country || 'France');
      const data = await fetchJSON(`https://api.worldbank.org/v2/country/${enc.slice(0, 3).toUpperCase()}/indicator/FP.CPI.TOTL.ZG?format=json&per_page=10&date=2015:2025`);
      if (data && data[1]) {
        return {
          country,
          indicator: 'CPI Inflation (%)',
          data: data[1].filter(d => d.value !== null).map(d => ({ year: d.date, value: +d.value.toFixed(2) }))
        };
      }
      return { country, error: 'No data available' };
    } catch (e) {
      return { country, error: e.message };
    }
  });
}

async function getEconomicIndicators(country) {
  const code = (country || 'FR').toUpperCase().slice(0, 3);
  const key = `econ:${code}`;
  return cached(key, 86400000, async () => {
    const indicators = {
      'NY.GDP.MKTP.CD': 'GDP (current US$)',
      'NY.GDP.PCAP.CD': 'GDP per capita (US$)',
      'SL.UEM.TOTL.ZS': 'Unemployment (%)',
      'FP.CPI.TOTL.ZG': 'Inflation (%)',
      'NE.TRD.GNFS.ZS': 'Trade (% of GDP)'
    };
    const results = {};
    await Promise.allSettled(Object.entries(indicators).map(async ([ind, name]) => {
      try {
        const data = await fetchJSON(`https://api.worldbank.org/v2/country/${code}/indicator/${ind}?format=json&per_page=5&date=2018:2024`);
        if (data && data[1]) {
          const values = data[1].filter(d => d.value !== null).map(d => ({ year: d.date, value: +d.value.toFixed(2) }));
          if (values.length > 0) results[name] = values;
        }
      } catch (_) {}
    }));
    return { country: code, indicators: results };
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 9: FLIGHTS
// ═══════════════════════════════════════════════════════════

async function getFlights(opts = {}) {
  const key = `flights:${JSON.stringify(opts)}`;
  return cached(key, 120000, async () => {
    try {
      let url = 'https://opensky-network.org/api/states/all';
      const params = [];
      if (opts.icao24) params.push(`icao24=${opts.icao24}`);
      if (params.length) url += '?' + params.join('&');
      const data = await fetchJSON(url, { timeout: 15000 });
      const states = (data.states || []).slice(0, opts.limit || 20);
      return {
        time: data.time,
        flights: states.map(s => ({
          icao24: s[0],
          callsign: s[1]?.trim(),
          origin_country: s[2],
          longitude: s[5],
          latitude: s[6],
          altitude_m: s[7],
          velocity_ms: s[9],
          heading: s[10],
          on_ground: s[8]
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getAirportInfo(code) {
  try {
    const search = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(code + ' airport')}&format=json&limit=1`);
    if (search[0]) {
      return {
        code,
        name: search[0].display_name,
        lat: search[0].lat,
        lon: search[0].lon,
        type: search[0].type
      };
    }
    return { code, error: 'Airport not found' };
  } catch (e) {
    return { code, error: e.message };
  }
}

async function getPublicTransit(city) {
  try {
    const enc = encodeURIComponent(city);
    const geo = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${enc}&format=json&limit=1`);
    if (!geo[0]) return { city, error: 'City not found' };
    const { lat, lon } = geo[0];
    const overpass = `https://overpass-api.de/api/interpreter?data=[out:json][timeout:10];node(around:2000,${lat},${lon})[railway=station];out body 10;`;
    const data = await fetchJSON(overpass, { timeout: 15000 });
    return {
      city,
      stations: (data.elements || []).map(e => ({
        name: e.tags?.name,
        type: e.tags?.station || e.tags?.railway,
        operator: e.tags?.operator,
        lat: e.lat,
        lon: e.lon
      }))
    };
  } catch (e) {
    return { city, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 10: ENTERTAINMENT
// ═══════════════════════════════════════════════════════════

const TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8';

async function getMovies(opts = {}) {
  const category = opts.category || 'trending';
  const lang = opts.lang || 'fr-FR';
  const key = `movies:${category}:${lang}`;
  return cached(key, 600000, async () => {
    try {
      let url;
      switch (category) {
        case 'popular': url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=${lang}`; break;
        case 'top_rated': url = `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_KEY}&language=${lang}`; break;
        case 'upcoming': url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_KEY}&language=${lang}`; break;
        case 'now_playing': url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&language=${lang}`; break;
        default: url = `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_KEY}&language=${lang}`; break;
      }
      const data = await fetchJSON(url);
      return {
        category,
        movies: (data.results || []).slice(0, opts.limit || 10).map(m => ({
          title: m.title,
          original_title: m.original_title !== m.title ? m.original_title : undefined,
          rating: m.vote_average,
          votes: m.vote_count,
          release: m.release_date,
          overview: m.overview?.slice(0, 300),
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          genres: m.genre_ids
        }))
      };
    } catch (e) {
      // Fallback 2 — OMDb
      try {
        const search = category === 'trending' ? 'popular' : category;
        const d = await fetchJSON(`http://www.omdbapi.com/?s=${encodeURIComponent(search)}&type=movie&apikey=trilogy`, { timeout: 5000 });
        if (d.Search) {
          return {
            category, source: 'OMDb',
            movies: d.Search.slice(0, opts.limit || 10).map(m => ({
              title: m.Title,
              original_title: undefined,
              rating: null,
              votes: null,
              release: m.Year,
              overview: null,
              poster: m.Poster !== 'N/A' ? m.Poster : null,
              genres: null
            }))
          };
        }
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

async function getTVShows(opts = {}) {
  const category = opts.category || 'trending';
  const lang = opts.lang || 'fr-FR';
  const key = `tv:${category}:${lang}`;
  return cached(key, 600000, async () => {
    try {
      let url;
      switch (category) {
        case 'popular': url = `https://api.themoviedb.org/3/tv/popular?api_key=${TMDB_KEY}&language=${lang}`; break;
        case 'top_rated': url = `https://api.themoviedb.org/3/tv/top_rated?api_key=${TMDB_KEY}&language=${lang}`; break;
        case 'airing_today': url = `https://api.themoviedb.org/3/tv/airing_today?api_key=${TMDB_KEY}&language=${lang}`; break;
        default: url = `https://api.themoviedb.org/3/trending/tv/week?api_key=${TMDB_KEY}&language=${lang}`; break;
      }
      const data = await fetchJSON(url);
      return {
        category,
        shows: (data.results || []).slice(0, opts.limit || 10).map(s => ({
          name: s.name,
          original_name: s.original_name !== s.name ? s.original_name : undefined,
          rating: s.vote_average,
          first_air: s.first_air_date,
          overview: s.overview?.slice(0, 300),
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null
        }))
      };
    } catch (e) {
      // Fallback 2 — TVMaze
      try {
        const d = await fetchJSON('https://api.tvmaze.com/shows?page=0', { timeout: 5000 });
        return {
          category, source: 'TVMaze',
          shows: (d || []).slice(0, opts.limit || 10).map(s => ({
            name: s.name,
            original_name: undefined,
            rating: s.rating?.average,
            first_air: s.premiered,
            overview: s.summary?.replace(/<[^>]+>/g, '').slice(0, 300),
            poster: s.image?.medium || null
          }))
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

async function searchMovie(query, opts = {}) {
  const lang = opts.lang || 'fr-FR';
  const key = `movie_search:${query}:${lang}`;
  return cached(key, 600000, async () => {
    try {
      const enc = encodeURIComponent(query);
      const data = await fetchJSON(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&language=${lang}&query=${enc}`);
      return {
        query,
        results: (data.results || []).slice(0, 10).map(r => ({
          type: r.media_type,
          title: r.title || r.name,
          rating: r.vote_average,
          date: r.release_date || r.first_air_date,
          overview: r.overview?.slice(0, 300),
          poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null
        }))
      };
    } catch (e) {
      return { query, error: e.message };
    }
  });
}

async function getMusicCharts(opts = {}) {
  const country = opts.country || 'fr';
  const key = `music:${country}`;
  return cached(key, 600000, async () => {
    try {
      const data = await fetchJSON(`https://itunes.apple.com/${country}/rss/topsongs/limit=20/json`);
      const entries = data.feed?.entry || [];
      return {
        country,
        chart: 'iTunes Top Songs',
        songs: entries.map(e => ({
          title: e['im:name']?.label,
          artist: e['im:artist']?.label,
          album: e['im:collection']?.['im:name']?.label,
          price: e['im:price']?.label,
          image: e['im:image']?.[2]?.label,
          link: e.link?.[0]?.attributes?.href || e.id?.label
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getBooks(query) {
  const key = `books:${query}`;
  return cached(key, 600000, async () => {
    try {
      const enc = encodeURIComponent(query);
      const data = await fetchJSON(`https://openlibrary.org/search.json?q=${enc}&limit=10`);
      return {
        query,
        total: data.numFound,
        books: (data.docs || []).slice(0, 10).map(b => ({
          title: b.title,
          author: b.author_name ? b.author_name.join(', ') : 'Unknown',
          first_published: b.first_publish_year,
          isbn: b.isbn ? b.isbn[0] : null,
          pages: b.number_of_pages_median,
          subjects: b.subject?.slice(0, 5),
          cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
          editions: b.edition_count,
          languages: b.language?.slice(0, 5)
        }))
      };
    } catch (e) {
      // Fallback 2 — Google Books
      try {
        const enc = encodeURIComponent(query);
        const d = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=10`, { timeout: 5000 });
        return {
          query, source: 'GoogleBooks',
          total: d.totalItems || 0,
          books: (d.items || []).slice(0, 10).map(b => {
            const v = b.volumeInfo || {};
            return {
              title: v.title,
              author: v.authors ? v.authors.join(', ') : 'Unknown',
              first_published: v.publishedDate?.slice(0, 4) ? parseInt(v.publishedDate.slice(0, 4)) : null,
              isbn: v.industryIdentifiers?.[0]?.identifier || null,
              pages: v.pageCount,
              subjects: v.categories?.slice(0, 5),
              cover: v.imageLinks?.thumbnail || null,
              editions: null,
              languages: v.language ? [v.language] : null
            };
          })
        };
      } catch (e2) {}
      return { query, error: 'All sources failed' };
    }
  });
}

const RAWG_KEY = '5b9bcb5a2e5745cfa63f5ed33ce6f5a6';

async function getVideoGames(opts = {}) {
  const key = `games:${JSON.stringify(opts)}`;
  return cached(key, 3600000, async () => {
    // Source 1 — RAWG API
    try {
      const params = [`key=${RAWG_KEY}`, 'page_size=15', 'metacritic=60,100'];
      if (opts.search) params.push(`search=${encodeURIComponent(opts.search)}`);
      if (opts.ordering) params.push(`ordering=${opts.ordering}`);
      else params.push('ordering=-rating');
      if (opts.dates) params.push(`dates=${opts.dates}`);
      if (opts.platforms) params.push(`platforms=${opts.platforms}`);
      const data = await fetchJSON(`https://api.rawg.io/api/games?${params.join('&')}`, { timeout: 8000 });
      if (data.results?.length > 0) {
        return {
          source: 'RAWG', count: data.count,
          games: data.results.map(g => ({
            name: g.name, released: g.released, rating: g.rating,
            metacritic: g.metacritic,
            platforms: g.platforms?.map(p => p.platform?.name).slice(0, 5),
            genres: g.genres?.map(g2 => g2.name),
            image: g.background_image, playtime: g.playtime
          }))
        };
      }
    } catch (e) {}

    // Source 2 — CheapShark (deals avec Metacritic scores)
    try {
      const data = await fetchJSON('https://www.cheapshark.com/api/1.0/deals?pageSize=15&sortBy=Metacritic&metacritic=80', { timeout: 8000 });
      if (data?.length > 0) {
        return {
          source: 'CheapShark',
          games: data.slice(0, 15).map(g => ({
            name: g.title, metacritic: g.metacriticScore,
            rating: g.steamRatingPercent + '% Steam',
            price: g.salePrice + '$ (sale)', normal_price: g.normalPrice + '$',
            image: g.thumb
          }))
        };
      }
    } catch (e) {}

    // Source 3 — SteamSpy top 100
    try {
      const data = await fetchJSON('https://steamspy.com/api.php?request=top100in2weeks', { timeout: 8000 });
      const games = Object.values(data).slice(0, 15);
      if (games.length > 0) {
        return {
          source: 'SteamSpy',
          games: games.map(g => ({
            name: g.name, rating: g.positive + ' positifs',
            owners: g.owners, price: (g.price / 100).toFixed(2) + '€',
            genre: g.genre
          }))
        };
      }
    } catch (e) {}

    return { error: 'APIs jeux indisponibles', games: [] };
  });
}

async function getPodcasts(query) {
  const key = `podcasts:${query}`;
  return cached(key, 600000, async () => {
    try {
      const enc = encodeURIComponent(query);
      const data = await fetchJSON(`https://itunes.apple.com/search?term=${enc}&media=podcast&limit=10`);
      return {
        query,
        podcasts: (data.results || []).map(p => ({
          name: p.collectionName,
          artist: p.artistName,
          genre: p.primaryGenreName,
          episodes: p.trackCount,
          feed_url: p.feedUrl,
          artwork: p.artworkUrl600 || p.artworkUrl100,
          url: p.collectionViewUrl
        }))
      };
    } catch (e) {
      return { query, error: e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 11: GEO
// ═══════════════════════════════════════════════════════════

async function geocode(address) {
  try {
    const enc = encodeURIComponent(address);
    const data = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${enc}&format=json&limit=5&addressdetails=1`, {
      headers: { 'User-Agent': 'PrometheusBot/2.0' }
    });
    return {
      query: address,
      results: data.map(r => ({
        display_name: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        type: r.type,
        class: r.class,
        address: r.address
      }))
    };
  } catch (e) {
    // Fallback 2 — Photon (Komoot)
    try {
      const enc = encodeURIComponent(address);
      const d = await fetchJSON(`https://photon.komoot.io/api/?q=${enc}&limit=5&lang=fr`, { timeout: 5000 });
      return {
        query: address,
        source: 'Photon',
        results: (d.features || []).map(f => ({
          display_name: [f.properties?.name, f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean).join(', '),
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0],
          type: f.properties?.osm_value,
          class: f.properties?.osm_key,
          address: f.properties
        }))
      };
    } catch (e2) {}
    return { query: address, error: 'All sources failed' };
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const data = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`, {
      headers: { 'User-Agent': 'PrometheusBot/2.0' }
    });
    return {
      lat, lon,
      display_name: data.display_name,
      address: data.address
    };
  } catch (e) {
    // Fallback 2 — BigDataCloud
    try {
      const d = await fetchJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=fr`, { timeout: 5000 });
      return {
        lat, lon,
        source: 'BigDataCloud',
        display_name: [d.locality, d.city, d.principalSubdivision, d.countryName].filter(Boolean).join(', '),
        address: {
          city: d.city || d.locality,
          state: d.principalSubdivision,
          country: d.countryName,
          country_code: d.countryCode,
          postcode: d.postcode
        }
      };
    } catch (e2) {}
    return { lat, lon, error: 'All sources failed' };
  }
}

async function getDistance(from, to) {
  try {
    const [a, b] = await Promise.all([
      fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(from)}&format=json&limit=1`, { headers: { 'User-Agent': 'PrometheusBot/2.0' } }),
      fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(to)}&format=json&limit=1`, { headers: { 'User-Agent': 'PrometheusBot/2.0' } })
    ]);
    if (!a[0] || !b[0]) return { error: 'Location not found' };
    const R = 6371;
    const dLat = (b[0].lat - a[0].lat) * Math.PI / 180;
    const dLon = (b[0].lon - a[0].lon) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0].lat * Math.PI / 180) * Math.cos(b[0].lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return {
      from: { name: a[0].display_name, lat: a[0].lat, lon: a[0].lon },
      to: { name: b[0].display_name, lat: b[0].lat, lon: b[0].lon },
      distance_km: Math.round(dist),
      distance_miles: Math.round(dist * 0.621371)
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function getNearbyPlaces(lat, lon, type) {
  try {
    const tag = type || 'amenity';
    const overpass = `https://overpass-api.de/api/interpreter?data=[out:json][timeout:10];node(around:1000,${lat},${lon})[${tag}];out body 15;`;
    const data = await fetchJSON(overpass, { timeout: 15000 });
    return {
      lat, lon, type: tag,
      places: (data.elements || []).map(e => ({
        name: e.tags?.name,
        type: e.tags?.[tag] || e.tags?.amenity || e.tags?.shop,
        lat: e.lat,
        lon: e.lon,
        address: e.tags?.['addr:street'] ? `${e.tags['addr:housenumber'] || ''} ${e.tags['addr:street']}` : null,
        phone: e.tags?.phone,
        website: e.tags?.website
      })).filter(p => p.name)
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function getCountryInfo(code) {
  const key = `country:${code}`;
  return cached(key, 86400000, async () => {
    try {
      const d = await fetchJSON(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(code)}`);
      const c = d[0] || {};
      return {
        name: c.name?.common,
        official: c.name?.official,
        capital: c.capital?.[0],
        population: c.population,
        population_formatted: c.population?.toLocaleString(),
        area_km2: c.area,
        region: c.region,
        subregion: c.subregion,
        languages: Object.values(c.languages || {}),
        currencies: Object.entries(c.currencies || {}).map(([k, v]) => ({ code: k, name: v.name, symbol: v.symbol })),
        timezones: c.timezones,
        borders: c.borders,
        flag_emoji: c.flag,
        flag_svg: c.flags?.svg,
        coat_of_arms: c.coatOfArms?.svg,
        maps: c.maps,
        car_side: c.car?.side,
        independent: c.independent,
        un_member: c.unMember,
        tld: c.tld,
        calling_code: c.idd?.root ? c.idd.root + (c.idd.suffixes?.[0] || '') : null
      };
    } catch (e) {
      // Fallback 2 — WorldBank
      try {
        const d = await fetchJSON(`https://api.worldbank.org/v2/country/${encodeURIComponent(code)}?format=json`, { timeout: 5000 });
        const c = d?.[1]?.[0];
        if (c) {
          return {
            source: 'WorldBank',
            name: c.name,
            official_name: c.name,
            capital: c.capitalCity,
            population: null,
            population_formatted: null,
            area_km2: null,
            region: c.region?.value,
            subregion: c.adminregion?.value,
            languages: [],
            currencies: [],
            timezones: [],
            borders: [],
            flag_emoji: null,
            flag_svg: null,
            coat_of_arms: null,
            maps: null,
            car_side: null,
            independent: null,
            un_member: null,
            tld: null,
            calling_code: null
          };
        }
      } catch (e2) {}
      return { code, error: 'All sources failed' };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 12: SCIENCE
// ═══════════════════════════════════════════════════════════

const NASA_KEY = 'DEMO_KEY';

async function getNASA(opts = {}) {
  const type = opts.type || 'apod';
  const key = `nasa:${type}:${opts.date || 'latest'}`;
  return cached(key, 3600000, async () => {
    try {
      switch (type) {
        case 'apod': {
          const date = opts.date ? `&date=${opts.date}` : '';
          const data = await fetchJSON(`https://api.nasa.gov/planetary/apod?api_key=${NASA_KEY}${date}`);
          return { type: 'apod', title: data.title, explanation: data.explanation, url: data.hdurl || data.url, media_type: data.media_type, date: data.date, copyright: data.copyright };
        }
        case 'mars': {
          const sol = opts.sol || 1000;
          const rover = opts.rover || 'curiosity';
          const data = await fetchJSON(`https://api.nasa.gov/mars-photos/api/v1/rovers/${rover}/photos?sol=${sol}&api_key=${NASA_KEY}&page=1`);
          return { type: 'mars', rover, sol, photos: (data.photos || []).slice(0, 10).map(p => ({ id: p.id, camera: p.camera?.full_name, img: p.img_src, earth_date: p.earth_date })) };
        }
        case 'asteroids': {
          const today = new Date().toISOString().slice(0, 10);
          const data = await fetchJSON(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${today}&api_key=${NASA_KEY}`);
          const neos = data.near_earth_objects?.[today] || [];
          return {
            type: 'asteroids', date: today,
            count: data.element_count,
            asteroids: neos.slice(0, 10).map(a => ({
              name: a.name,
              diameter_m: a.estimated_diameter?.meters?.estimated_diameter_max?.toFixed(0),
              hazardous: a.is_potentially_hazardous_asteroid,
              velocity_kmh: a.close_approach_data?.[0]?.relative_velocity?.kilometers_per_hour,
              miss_distance_km: a.close_approach_data?.[0]?.miss_distance?.kilometers
            }))
          };
        }
        case 'iss': {
          const [issRes, crewRes] = await Promise.allSettled([
            fetchJSON('http://api.open-notify.org/iss-now.json', { timeout: 6000 }),
            fetchJSON('http://api.open-notify.org/astros.json', { timeout: 6000 }),
          ]);
          let lat = null, lon = null, ts = '';
          if (issRes.status === 'fulfilled') {
            const d = issRes.value;
            lat = d.iss_position?.latitude || d.latitude;
            lon = d.iss_position?.longitude || d.longitude;
            ts = d.timestamp ? new Date(d.timestamp * 1000).toLocaleString('fr-FR') : '';
          }
          if (!lat) {
            try {
              const alt = await fetchJSON('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 5000 });
              lat = alt.latitude; lon = alt.longitude;
              ts = new Date(alt.timestamp * 1000).toLocaleString('fr-FR');
            } catch (e2) {}
          }
          let crew = [], crewCount = 0;
          if (crewRes.status === 'fulfilled') {
            const c = crewRes.value;
            crew = (c.people || []).filter(p => p.craft === 'ISS').map(p => p.name);
            crewCount = c.number || crew.length;
          }
          return {
            type: 'iss',
            lat: lat ? parseFloat(lat).toFixed(4) : null,
            lon: lon ? parseFloat(lon).toFixed(4) : null,
            position: { latitude: lat, longitude: lon },
            altitude_km: 408, velocity_kmh: 27600,
            timestamp: ts,
            crew, crew_count: crewCount, total_in_space: crewCount,
            maps_url: lat ? `https://www.google.com/maps?q=${lat},${lon}` : '',
          };
        }
        default:
          return { error: `Unknown NASA type: ${type}` };
      }
    } catch (e) {
      return { type, error: e.message };
    }
  });
}

async function getEarthquakes(opts = {}) {
  const key = `earthquakes:${opts.min_magnitude || 4}`;
  return cached(key, 300000, async () => {
    try {
      const minMag = opts.min_magnitude || 4;
      const limit = opts.limit || 15;
      const data = await fetchJSON(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${minMag >= 4.5 ? 'significant' : 'all'}_day.geojson`);
      return {
        title: data.metadata?.title,
        count: data.metadata?.count,
        earthquakes: (data.features || []).slice(0, limit).map(f => ({
          magnitude: f.properties?.mag,
          place: f.properties?.place,
          time: new Date(f.properties?.time).toISOString(),
          depth_km: f.geometry?.coordinates?.[2],
          tsunami: f.properties?.tsunami,
          url: f.properties?.url,
          felt: f.properties?.felt
        }))
      };
    } catch (e) {
      // Fallback 2 — EMSC (SeismicPortal)
      try {
        const limit = opts.limit || 15;
        const minMag = opts.min_magnitude || 4;
        const d = await fetchJSON(`https://www.seismicportal.eu/fdsnws/event/1/query?limit=${limit}&minmagnitude=${minMag}&format=json&orderby=time`, { timeout: 5000 });
        const features = d.features || [];
        return {
          source: 'EMSC',
          title: 'EMSC Earthquakes',
          count: features.length,
          earthquakes: features.map(f => ({
            magnitude: f.properties?.mag,
            place: f.properties?.flynn_region || f.properties?.place,
            time: f.properties?.time,
            depth_km: f.properties?.depth,
            tsunami: null,
            url: f.properties?.unid ? `https://www.seismicportal.eu/eventdetail.html?unid=${f.properties.unid}` : null,
            felt: null
          }))
        };
      } catch (e2) {}
      return { error: 'All sources failed' };
    }
  });
}

async function getSpaceEvents() {
  const key = 'space:events';
  return cached(key, 3600000, async () => {
    // Source 1 — SpaceDevs
    try {
      const data = await fetchJSON('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&format=json', { timeout: 10000 });
      const results = data.results || [];
      if (results.length > 0) {
        const mapped = results.map(l => ({
          name: l.name, status: l.status?.name, net: l.net,
          window_start: l.window_start,
          provider: l.launch_service_provider?.name,
          rocket: l.rocket?.configuration?.name,
          pad: l.pad?.name, location: l.pad?.location?.name,
          mission: l.mission?.name,
          mission_desc: l.mission?.description?.slice(0, 200),
          webcast: l.webcast_live ? l.vidURLs?.[0]?.url : null
        }));
        return { source: 'SpaceDevs', launches: mapped, upcoming_launches: mapped };
      }
    } catch (e) {}

    // Source 2 — RocketLaunch.live
    try {
      const data = await fetchJSON('https://fdo.rocketlaunch.live/json/launches/next/10', { timeout: 8000 });
      const launches = (data.result || []).map(l => ({
        name: l.name || l.launch_description,
        provider: l.provider?.name, rocket: l.vehicle?.name,
        date: l.t0 || l.date_str, location: l.pad?.location?.name,
        mission: l.missions?.[0]?.name || l.name,
      }));
      return { source: 'RocketLaunch.live', launches, upcoming_launches: launches };
    } catch (e) {}

    return { error: 'APIs spatiales temporairement indisponibles', launches: [], upcoming_launches: [] };
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 13: HEALTH
// ═══════════════════════════════════════════════════════════

async function searchDrug(name) {
  const key = `drug:${name}`;
  return cached(key, 86400000, async () => {
    try {
      const enc = encodeURIComponent(name);
      const data = await fetchJSON(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${enc}"+openfda.generic_name:"${enc}"&limit=3`);
      return {
        query: name,
        source: 'FDA',
        drugs: (data.results || []).map(d => ({
          brand: d.openfda?.brand_name?.[0],
          generic: d.openfda?.generic_name?.[0],
          manufacturer: d.openfda?.manufacturer_name?.[0],
          purpose: d.purpose?.[0]?.slice(0, 300),
          warnings: d.warnings?.[0]?.slice(0, 500),
          dosage: d.dosage_and_administration?.[0]?.slice(0, 500),
          route: d.openfda?.route?.[0],
          substance: d.openfda?.substance_name?.[0]
        }))
      };
    } catch (e) {
      return { query: name, error: e.message };
    }
  });
}

async function searchDrugEU(name) {
  const key = `drug_eu:${name}`;
  return cached(key, 86400000, async () => {
    try {
      const enc = encodeURIComponent(name);
      const data = await fetchJSON(`https://api.fda.gov/drug/event.json?search=patient.drug.openfda.brand_name:"${enc}"&limit=3`);
      return {
        query: name,
        source: 'FDA Events',
        events: (data.results || []).slice(0, 3).map(r => ({
          serious: r.serious,
          reactions: r.patient?.reaction?.map(rx => rx.reactionmeddrapt).slice(0, 10),
          drugs: r.patient?.drug?.map(d => d.medicinalproduct).slice(0, 5)
        }))
      };
    } catch (e) {
      return { query: name, error: e.message };
    }
  });
}

async function getNutrition(food) {
  const key = `nutrition:${food}`;
  return cached(key, 86400000, async () => {
    const enc = encodeURIComponent(food);

    // Source 1 — Open Food Facts (rapide, international)
    try {
      const d = await fetchJSON(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments,categories,brands`,
        { timeout: 5000 }
      );
      const products = (d.products || []).filter(p => p.product_name);
      if (products.length > 0) {
        return {
          source: 'Open Food Facts', query: food,
          foods: products.slice(0, 4).map(p => {
            const n = p.nutriments || {};
            return {
              name: p.product_name, brand: p.brands,
              category: p.categories?.split(',')[0]?.trim(),
              per_100g: {
                calories_kcal: n['energy-kcal_100g'], proteins_g: n.proteins_100g,
                carbs_g: n.carbohydrates_100g, sugars_g: n.sugars_100g,
                fat_g: n.fat_100g, fiber_g: n.fiber_100g, salt_g: n.salt_100g,
              },
            };
          }),
        };
      }
    } catch (e) {}

    // Source 2 — USDA FDC (timeout réduit)
    try {
      const d = await fetchJSON(
        `https://api.nal.usda.gov/fdc/v1/foods/search?query=${enc}&dataType=Foundation,SR%20Legacy&pageSize=3&api_key=DEMO_KEY`,
        { timeout: 4000 }
      );
      if (d.foods?.length) {
        return {
          source: 'USDA FDC', query: food,
          foods: d.foods.slice(0, 3).map(f => ({
            name: f.description, category: f.foodCategory,
            nutrients: (f.foodNutrients || []).slice(0, 10).map(n => ({
              name: n.nutrientName, value: n.value, unit: n.unitName,
            })),
          })),
        };
      }
    } catch (e) {}

    // Source 3 — Base locale pour aliments courants
    const LOCAL = {
      pizza:{cal:266,prot:11,carb:33,fat:10},burger:{cal:295,prot:17,carb:24,fat:14},
      apple:{cal:52,prot:0.3,carb:14,fat:0.2},pomme:{cal:52,prot:0.3,carb:14,fat:0.2},
      banana:{cal:89,prot:1.1,carb:23,fat:0.3},banane:{cal:89,prot:1.1,carb:23,fat:0.3},
      rice:{cal:130,prot:2.7,carb:28,fat:0.3},riz:{cal:130,prot:2.7,carb:28,fat:0.3},
      chicken:{cal:165,prot:31,carb:0,fat:3.6},poulet:{cal:165,prot:31,carb:0,fat:3.6},
      egg:{cal:155,prot:13,carb:1.1,fat:11},oeuf:{cal:155,prot:13,carb:1.1,fat:11},
      bread:{cal:265,prot:9,carb:49,fat:3.2},pain:{cal:265,prot:9,carb:49,fat:3.2},
      milk:{cal:61,prot:3.2,carb:4.8,fat:3.3},lait:{cal:61,prot:3.2,carb:4.8,fat:3.3},
      salmon:{cal:208,prot:20,carb:0,fat:13},saumon:{cal:208,prot:20,carb:0,fat:13},
      pasta:{cal:131,prot:5,carb:25,fat:1.1},pates:{cal:131,prot:5,carb:25,fat:1.1},
      chocolate:{cal:546,prot:5,carb:60,fat:31},chocolat:{cal:546,prot:5,carb:60,fat:31},
    };
    const k = food.toLowerCase().replace(/[^a-zàâéèêëïîôûùüç]/g, '');
    const match = Object.keys(LOCAL).find(l => k.includes(l) || l.includes(k.slice(0, 4)));
    if (match) {
      const n = LOCAL[match];
      return {
        source: 'Base locale', query: food,
        foods: [{ name: match, per: '100g', calories_kcal: n.cal, proteins_g: n.prot, carbs_g: n.carb, fat_g: n.fat }],
      };
    }

    return { query: food, error: 'Aliment non trouvé', foods: [] };
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 14: TRANSLATION
// ═══════════════════════════════════════════════════════════

const LANG_CODES = {
  fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi',
  tr: 'Turkish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  el: 'Greek', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay'
};

async function translate(text, opts = {}) {
  const from = opts.from || 'fr';
  const to = opts.to || 'en';
  const key = `translate:${from}:${to}:${text.slice(0, 80)}`;
  return cached(key, 1800000, async () => {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
      const data = await fetchJSON(url);
      const translated = data.responseData ? data.responseData.translatedText : '';
      const matches = data.matches ? data.matches.slice(0, 5).map(m => ({ segment: m.segment, translation: m.translation, quality: m.quality, source: m.created_by })) : [];
      return {
        original: text,
        translated,
        from: { code: from, name: LANG_CODES[from] || from },
        to: { code: to, name: LANG_CODES[to] || to },
        confidence: data.responseData?.match,
        alternatives: matches
      };
    } catch (e) {
      return { original: text, error: e.message };
    }
  });
}

async function detectLanguage(text) {
  try {
    // Use MyMemory with auto-detect
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 200))}&langpair=autodetect|en`;
    const data = await fetchJSON(url);
    const detected = data.responseData?.detectedLanguage;
    return {
      text: text.slice(0, 100),
      detected_lang: detected,
      lang_name: LANG_CODES[detected] || detected,
      confidence: data.responseData?.match
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function getDictionary(word, lang = 'en') {
  const key = `dict:${lang}:${word}`;
  return cached(key, 86400000, async () => {
    try {
      const d = await fetchJSON(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word)}`);
      const e = d[0] || {};
      return {
        word: e.word,
        phonetic: e.phonetic,
        phonetics: e.phonetics?.filter(p => p.audio).map(p => ({ text: p.text, audio: p.audio })),
        origin: e.origin,
        meanings: (e.meanings || []).map(m => ({
          pos: m.partOfSpeech,
          definitions: m.definitions?.slice(0, 5).map(d2 => ({ def: d2.definition, example: d2.example })),
          synonyms: m.synonyms?.slice(0, 8),
          antonyms: m.antonyms?.slice(0, 5)
        })),
        source: e.sourceUrls?.[0]
      };
    } catch (e) {
      return { word, error: e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 15: CALCULATE & CONVERT
// ═══════════════════════════════════════════════════════════

function calculate(expr) {
  try {
    const safe = expr
      .replace(/Math\.PI\b/g, '3.14159265358979')
      .replace(/Math\.E\b/g, '2.71828182845905')
      .replace(/\bPI\b/g, '3.14159265358979')
      .replace(/\bpi\b/gi, '3.14159265358979')
      .replace(/\be\b/g, '2.71828182845905')
      .replace(/(?<!Math\.)\bsqrt\(/gi, 'Math.sqrt(')
      .replace(/(?<!Math\.)\babs\(/gi, 'Math.abs(')
      .replace(/(?<!Math\.)\bsin\(/gi, 'Math.sin(')
      .replace(/(?<!Math\.)\bcos\(/gi, 'Math.cos(')
      .replace(/(?<!Math\.)\btan\(/gi, 'Math.tan(')
      .replace(/(?<!Math\.)\blog\(/gi, 'Math.log10(')
      .replace(/(?<!Math\.)\bln\(/gi, 'Math.log(')
      .replace(/(?<!Math\.)\bpow\(/gi, 'Math.pow(')
      .replace(/(?<!Math\.)\bround\(/gi, 'Math.round(')
      .replace(/(?<!Math\.)\bfloor\(/gi, 'Math.floor(')
      .replace(/(?<!Math\.)\bceil\(/gi, 'Math.ceil(')
      .replace(/(?<!Math\.)\bmin\(/gi, 'Math.min(')
      .replace(/(?<!Math\.)\bmax\(/gi, 'Math.max(')
      .replace(/\^/g, '**')
      .replace(/÷/g, '/')
      .replace(/×/g, '*')
      .replace(/,/g, '.');
    // Security check
    if (/[a-zA-Z_$]/.test(safe.replace(/Math\.\w+/g, '').replace(/\d+\.?\d*/g, ''))) {
      return { expression: expr, error: 'Invalid characters in expression' };
    }
    const result = Function('"use strict";return (' + safe + ')')();
    if (typeof result !== 'number' || !isFinite(result)) {
      return { expression: expr, error: 'Result is not a finite number' };
    }
    return {
      expression: expr,
      result,
      formatted: Number.isInteger(result) ? result.toString() : result.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
    };
  } catch (e) {
    return { expression: expr, error: 'Invalid expression: ' + e.message };
  }
}

function convert(value, from, to) {
  const conversions = {
    // Length
    m_km: 0.001, km_m: 1000, m_ft: 3.28084, ft_m: 0.3048, m_in: 39.3701, in_m: 0.0254,
    km_mi: 0.621371, mi_km: 1.60934, m_yd: 1.09361, yd_m: 0.9144,
    cm_in: 0.393701, in_cm: 2.54, mm_in: 0.0393701, m_cm: 100, cm_m: 0.01,
    m_mm: 1000, mm_m: 0.001, km_ft: 3280.84, mi_ft: 5280, nm_km: 1.852, km_nm: 0.539957,
    // Weight
    kg_lb: 2.20462, lb_kg: 0.453592, kg_oz: 35.274, oz_kg: 0.0283495,
    g_oz: 0.035274, oz_g: 28.3495, kg_g: 1000, g_kg: 0.001,
    kg_st: 0.157473, st_kg: 6.35029, t_kg: 1000, kg_t: 0.001,
    // Volume
    l_gal: 0.264172, gal_l: 3.78541, l_qt: 1.05669, qt_l: 0.946353,
    l_ml: 1000, ml_l: 0.001, l_oz_fl: 33.814, oz_fl_l: 0.0295735,
    l_cup: 4.22675, cup_l: 0.236588, l_pt: 2.11338, pt_l: 0.473176,
    // Speed
    kmh_mph: 0.621371, mph_kmh: 1.60934, ms_kmh: 3.6, kmh_ms: 0.277778,
    kmh_kn: 0.539957, kn_kmh: 1.852, ms_mph: 2.23694, mph_ms: 0.44704,
    // Area
    m2_ft2: 10.7639, ft2_m2: 0.092903, km2_mi2: 0.386102, mi2_km2: 2.58999,
    ha_acre: 2.47105, acre_ha: 0.404686, m2_ha: 0.0001, ha_m2: 10000,
    // Data
    b_kb: 0.001, kb_b: 1000, kb_mb: 0.001, mb_kb: 1000,
    mb_gb: 0.001, gb_mb: 1000, gb_tb: 0.001, tb_gb: 1000,
    // Time
    s_min: 1/60, min_s: 60, min_h: 1/60, h_min: 60,
    h_d: 1/24, d_h: 24, d_wk: 1/7, wk_d: 7
  };

  const key = `${from.toLowerCase()}_${to.toLowerCase()}`;

  // Direct conversion
  if (conversions[key]) {
    return { value, from, to, result: +(value * conversions[key]).toFixed(6) };
  }

  // Temperature
  if (from.toUpperCase() === 'C' && to.toUpperCase() === 'F') return { value, from, to, result: +(value * 9 / 5 + 32).toFixed(2) };
  if (from.toUpperCase() === 'F' && to.toUpperCase() === 'C') return { value, from, to, result: +((value - 32) * 5 / 9).toFixed(2) };
  if (from.toUpperCase() === 'C' && to.toUpperCase() === 'K') return { value, from, to, result: +(value + 273.15).toFixed(2) };
  if (from.toUpperCase() === 'K' && to.toUpperCase() === 'C') return { value, from, to, result: +(value - 273.15).toFixed(2) };
  if (from.toUpperCase() === 'F' && to.toUpperCase() === 'K') return { value, from, to, result: +((value - 32) * 5 / 9 + 273.15).toFixed(2) };
  if (from.toUpperCase() === 'K' && to.toUpperCase() === 'F') return { value, from, to, result: +((value - 273.15) * 9 / 5 + 32).toFixed(2) };

  return { value, from, to, error: `Conversion ${from} -> ${to} not supported. Available: ${Object.keys(conversions).join(', ')}, C/F/K` };
}

// ═══════════════════════════════════════════════════════════
// SECTION 16: TIME
// ═══════════════════════════════════════════════════════════

async function getTime(timezone) {
  const key = `time:${timezone}`;
  return cached(key, 60000, async () => {
    try {
      const tz = encodeURIComponent(timezone || 'Europe/Paris');
      const data = await fetchJSON(`https://worldtimeapi.org/api/timezone/${tz}`);
      return {
        timezone: data.timezone,
        datetime: data.datetime,
        utc_offset: data.utc_offset,
        day_of_week: data.day_of_week,
        day_of_year: data.day_of_year,
        week_number: data.week_number,
        dst: data.dst,
        abbreviation: data.abbreviation
      };
    } catch (_) {
      // Fallback
      try {
        const data = await fetchJSON(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(timezone || 'Europe/Paris')}`);
        return { timezone, datetime: data.dateTime || `${data.date} ${data.time}`, source: 'timeapi.io' };
      } catch (e2) {
        return { timezone, error: e2.message };
      }
    }
  });
}

async function getWorldClocks(timezones) {
  const zones = timezones || ['Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Shanghai', 'Europe/London', 'Australia/Sydney', 'Asia/Dubai'];
  const results = await Promise.allSettled(zones.map(tz => getTime(tz)));
  return {
    clocks: zones.map((tz, i) => ({
      timezone: tz,
      data: results[i].status === 'fulfilled' ? results[i].value : { error: results[i].reason?.message }
    }))
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 17: FOOD
// ═══════════════════════════════════════════════════════════

async function searchRecipe(query) {
  const key = `recipe:${query}`;
  return cached(key, 3600000, async () => {
    try {
      const d = await fetchJSON(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`);
      return {
        query,
        meals: (d.meals || []).slice(0, 5).map(m => ({
          name: m.strMeal,
          category: m.strCategory,
          area: m.strArea,
          instructions: m.strInstructions?.slice(0, 600),
          image: m.strMealThumb,
          video: m.strYoutube,
          tags: m.strTags,
          ingredients: Object.keys(m).filter(k => k.startsWith('strIngredient') && m[k]?.trim()).map((k, i) => `${m[k].trim()} - ${m['strMeasure' + (i + 1)]?.trim() || ''}`)
        }))
      };
    } catch (e) {
      return { query, error: e.message };
    }
  });
}

async function getCocktail(name) {
  const key = `cocktail:${name}`;
  return cached(key, 3600000, async () => {
    try {
      const d = await fetchJSON(`https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${encodeURIComponent(name)}`);
      return {
        query: name,
        cocktails: (d.drinks || []).slice(0, 5).map(c => ({
          name: c.strDrink,
          category: c.strCategory,
          glass: c.strGlass,
          alcoholic: c.strAlcoholic,
          instructions: c.strInstructions?.slice(0, 500),
          instructions_fr: c.strInstructionsFR?.slice(0, 500),
          image: c.strDrinkThumb,
          ingredients: Object.keys(c).filter(k => k.startsWith('strIngredient') && c[k]?.trim()).map((k, i) => `${c[k].trim()} - ${c['strMeasure' + (i + 1)]?.trim() || ''}`)
        }))
      };
    } catch (e) {
      return { query: name, error: e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 18: TECH
// ═══════════════════════════════════════════════════════════

async function searchGitHub(query, opts = {}) {
  const key = `github:${query}`;
  return cached(key, 600000, async () => {
    try {
      const enc = encodeURIComponent(query);
      const sort = opts.sort || 'stars';
      const data = await fetchJSON(`https://api.github.com/search/repositories?q=${enc}&sort=${sort}&per_page=10`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'PrometheusBot/2.0' }
      });
      return {
        query,
        total: data.total_count,
        repos: (data.items || []).map(r => ({
          name: r.full_name,
          description: r.description?.slice(0, 200),
          stars: r.stargazers_count,
          forks: r.forks_count,
          language: r.language,
          license: r.license?.spdx_id,
          topics: r.topics?.slice(0, 5),
          url: r.html_url,
          created: r.created_at?.slice(0, 10),
          updated: r.updated_at?.slice(0, 10),
          open_issues: r.open_issues_count
        }))
      };
    } catch (e) {
      return { query, error: e.message };
    }
  });
}

async function getNpmPackage(name) {
  const key = `npm:${name}`;
  return cached(key, 600000, async () => {
    try {
      const data = await fetchJSON(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      const latest = data['dist-tags']?.latest;
      const ver = data.versions?.[latest] || {};
      return {
        name: data.name,
        description: data.description,
        version: latest,
        license: ver.license || data.license,
        homepage: data.homepage,
        repository: data.repository?.url,
        keywords: data.keywords?.slice(0, 10),
        author: typeof data.author === 'string' ? data.author : data.author?.name,
        dependencies: ver.dependencies ? Object.keys(ver.dependencies).length : 0,
        maintainers: data.maintainers?.map(m => m.name),
        npm_url: `https://www.npmjs.com/package/${data.name}`
      };
    } catch (e) {
      return { name, error: e.message };
    }
  });
}

async function getPyPIPackage(name) {
  const key = `pypi:${name}`;
  return cached(key, 600000, async () => {
    try {
      const data = await fetchJSON(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
      const info = data.info || {};
      return {
        name: info.name,
        version: info.version,
        summary: info.summary,
        author: info.author,
        license: info.license,
        homepage: info.home_page || info.project_url,
        requires_python: info.requires_python,
        keywords: info.keywords,
        classifiers: info.classifiers?.filter(c => c.startsWith('Topic')).slice(0, 5),
        pypi_url: info.package_url || `https://pypi.org/project/${name}/`,
        project_urls: info.project_urls
      };
    } catch (e) {
      return { name, error: e.message };
    }
  });
}

async function getHackerNews(opts = {}) {
  const type = opts.type || 'top';
  const key = `hn:${type}`;
  return cached(key, 300000, async () => {
    try {
      const ids = await fetchJSON(`https://hacker-news.firebaseio.com/v0/${type}stories.json`);
      const topIds = ids.slice(0, opts.limit || 15);
      const stories = await Promise.all(topIds.map(id => fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
      return {
        type,
        stories: stories.filter(Boolean).map(s => ({
          title: s.title,
          url: s.url,
          score: s.score,
          by: s.by,
          time: new Date(s.time * 1000).toISOString(),
          comments: s.descendants,
          hn_url: `https://news.ycombinator.com/item?id=${s.id}`
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getProductHunt() {
  const key = 'ph:today';
  return cached(key, 600000, async () => {
    try {
      const xml = await fetchText('https://www.producthunt.com/feed');
      const items = parseRSS(xml);
      return {
        source: 'Product Hunt',
        products: items.slice(0, 15).map(i => ({
          title: i.title,
          description: i.description,
          url: i.url,
          date: i.date
        }))
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

async function getDockerHub(image) {
  const key = `docker:${image}`;
  return cached(key, 600000, async () => {
    try {
      const parts = image.includes('/') ? image : `library/${image}`;
      const data = await fetchJSON(`https://hub.docker.com/v2/repositories/${parts}`);
      return {
        name: data.name,
        namespace: data.namespace,
        description: data.description?.slice(0, 300),
        stars: data.star_count,
        pulls: data.pull_count,
        last_updated: data.last_updated,
        is_official: data.is_official,
        is_automated: data.is_automated,
        url: `https://hub.docker.com/r/${parts}`
      };
    } catch (e) {
      return { image, error: e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 19: EDUCATION
// ═══════════════════════════════════════════════════════════

async function getWikipedia(topic, opts = {}) {
  const lang = opts.lang || 'fr';
  const key = `wiki:${lang}:${topic}`;
  return cached(key, 3600000, async () => {
    try {
      const enc = encodeURIComponent(topic);
      const d = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`);
      let sections = null;
      if (opts.full) {
        try {
          const mobile = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/mobile-sections/${enc}`);
          sections = (mobile.remaining?.sections || []).slice(0, 15).map(s => ({
            title: s.line,
            level: s.toclevel,
            text: s.text?.replace(/<[^>]+>/g, '').slice(0, 500)
          }));
        } catch (_) {}
      }
      return {
        title: d.title,
        description: d.description,
        extract: d.extract,
        image: d.thumbnail?.source,
        url: d.content_urls?.desktop?.page,
        lang,
        sections
      };
    } catch (e) {
      if (lang !== 'en') return getWikipedia(topic, { ...opts, lang: 'en' });
      // Fallback 2 — Wikidata
      try {
        const enc = encodeURIComponent(topic);
        const d = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc}&language=fr&limit=1&format=json`, { timeout: 5000 });
        const entity = d.search?.[0];
        if (entity) {
          return {
            source: 'Wikidata',
            title: entity.label,
            description: entity.description,
            extract: entity.description || '',
            image: null,
            url: entity.concepturi,
            lang: 'fr',
            sections: null
          };
        }
      } catch (e2) {}
      return { topic, error: 'All sources failed' };
    }
  });
}

async function getMathProof(theorem) {
  // Use Wikipedia for math content
  const key = `math:${theorem}`;
  return cached(key, 86400000, async () => {
    try {
      const wiki = await getWikipedia(theorem, { lang: 'en', full: true });
      return {
        theorem,
        title: wiki.title,
        summary: wiki.extract,
        sections: wiki.sections,
        url: wiki.url,
        note: 'Full proofs available at the linked Wikipedia article'
      };
    } catch (e) {
      return { theorem, error: e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 20: INTERNET
// ═══════════════════════════════════════════════════════════

async function checkWebsite(url) {
  try {
    const start = Date.now();
    const res = await fetchRaw(url, { timeout: 10000 });
    const latency = Date.now() - start;
    return {
      url,
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      latency_ms: latency,
      server: res.headers?.server,
      content_type: res.headers?.['content-type'],
      content_length: res.headers?.['content-length'],
      powered_by: res.headers?.['x-powered-by']
    };
  } catch (e) {
    return { url, ok: false, error: e.message };
  }
}

async function getDomainInfo(domain) {
  const key = `domain:${domain}`;
  return cached(key, 3600000, async () => {
    try {
      const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*/, '');
      // DNS lookup via DNS-over-HTTPS
      const dns = await fetchJSON(`https://dns.google/resolve?name=${clean}&type=A`);
      const mx = await fetchJSON(`https://dns.google/resolve?name=${clean}&type=MX`).catch(() => null);
      const ns = await fetchJSON(`https://dns.google/resolve?name=${clean}&type=NS`).catch(() => null);
      const txt = await fetchJSON(`https://dns.google/resolve?name=${clean}&type=TXT`).catch(() => null);
      return {
        domain: clean,
        dns: {
          a: dns.Answer?.map(a => a.data) || [],
          mx: mx?.Answer?.map(a => a.data) || [],
          ns: ns?.Answer?.map(a => a.data) || [],
          txt: txt?.Answer?.map(a => a.data).slice(0, 5) || []
        },
        status: dns.Status === 0 ? 'OK' : 'NXDOMAIN'
      };
    } catch (e) {
      // Fallback 2 — Cloudflare DoH
      try {
        const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*/, '');
        const d = await fetchJSON(`https://cloudflare-dns.com/dns-query?name=${clean}&type=A`, {
          timeout: 5000,
          headers: { 'Accept': 'application/dns-json' }
        });
        return {
          domain: clean,
          source: 'Cloudflare',
          dns: {
            a: (d.Answer || []).filter(a => a.type === 1).map(a => a.data),
            mx: [],
            ns: [],
            txt: []
          },
          status: d.Status === 0 ? 'OK' : 'NXDOMAIN'
        };
      } catch (e2) {}
      return { domain, error: 'All sources failed' };
    }
  });
}

async function getIPInfo(ip) {
  const key = `ip:${ip || 'self'}`;
  return cached(key, 600000, async () => {
    try {
      const target = ip || '';
      const data = await fetchJSON(`https://ipapi.co/${target}/json/`);
      return {
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country_name,
        country_code: data.country_code,
        postal: data.postal,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        org: data.org,
        asn: data.asn,
        isp: data.org
      };
    } catch (e) {
      // Fallback 2 — ip-api.com
      try {
        const target = ip || '';
        const d = await fetchJSON(`http://ip-api.com/json/${target}?lang=fr`, { timeout: 5000 });
        return {
          source: 'ip-api',
          ip: d.query,
          city: d.city,
          region: d.regionName,
          country: d.country,
          country_code: d.countryCode,
          postal: d.zip,
          latitude: d.lat,
          longitude: d.lon,
          timezone: d.timezone,
          org: d.org,
          asn: d.as,
          isp: d.isp
        };
      } catch (e2) {}
      return { ip, error: 'All sources failed' };
    }
  });
}

async function shortenURL(url) {
  try {
    const data = await fetchJSON(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
    return { original: url, short: data.shorturl };
  } catch (e) {
    return { url, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 21: INTENT DETECTOR
// ═══════════════════════════════════════════════════════════

const INTENTS = [
  { intent: 'weather', pattern: /\b(m[eé]t[eé]o|weather|temps\s+qu.il\s+fait|temperature|pluie|soleil|neige|vent|climat|forecast|pr[eé]vision|orage|brouillard|canicule|gel)\b/i, extract: (m) => { const c = m.match(/(?:[àa]|in|at|for|de|du|pour)\s+([A-Za-z\u00C0-\u024F\s-]+?)(?:\s*[?.,!]|\s+(?:demain|aujourd|cette|ce\s)|\s*$)/i); return c ? c[1].trim() : null; } },
  { intent: 'weather_compare', pattern: /\b(compar|versus|vs|ou)\b.*\b(m[eé]t[eé]o|weather|temp)/i, extract: (m) => { const cities = m.match(/[A-Z][a-z\u00C0-\u024F]+/g); return cities || []; } },
  { intent: 'weather_alerts', pattern: /\b(alert|vigilance|danger|risque)\b.*\b(m[eé]t[eé]o|weather|temp)/i, extract: (m) => { const c = m.match(/(?:[àa]|in|at|for|de)\s+([A-Za-z\u00C0-\u024F\s-]+)/i); return c ? c[1].trim() : null; } },
  { intent: 'sports', pattern: /\b(score|match|ligue\s*[12]|nba|nfl|ucl|premier\s*league|serie\s*a|la\s*liga|bundesliga|f1|football|soccer|basket|sport|nhl|mlb|mls|rugby|ufc|motogp|tennis|eredivisie)\b/i, extract: (m) => { for (const k of Object.keys(LEAGUES)) { if (m.toLowerCase().replace(/\s+/g, '').includes(k)) return k; } if (/ligue\s*1/i.test(m)) return 'ligue1'; if (/ligue\s*2/i.test(m)) return 'ligue2'; if (/premier/i.test(m)) return 'premierleague'; if (/serie\s*a/i.test(m)) return 'seriea'; if (/la\s*liga/i.test(m)) return 'laliga'; if (/bundes/i.test(m)) return 'bundesliga'; if (/top\s*14/i.test(m)) return 'rugby_top14'; return 'ligue1'; } },
  { intent: 'standings', pattern: /\b(classement|standings|table|ranking|leaderboard)\b/i, extract: (m) => { for (const k of Object.keys(LEAGUES)) { if (m.toLowerCase().replace(/\s+/g, '').includes(k)) return k; } if (/ligue\s*1/i.test(m)) return 'ligue1'; if (/premier/i.test(m)) return 'premierleague'; return 'ligue1'; } },
  { intent: 'f1', pattern: /\b(f1|formula\s*1|formule\s*1|grand\s*prix|gp)\b/i, extract: (m) => { if (/calendar|programme|schedule|prochaine?/i.test(m)) return 'calendar'; return 'standings'; } },
  { intent: 'player', pattern: /\b(joueur|player|stats?\s+de|statistiques?\s+de)\b/i, extract: (m) => { const p = m.match(/(?:de|for|about)\s+([A-Za-z\u00C0-\u024F\s-]+)/i); return p ? p[1].trim() : m; } },
  { intent: 'crypto', pattern: /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|cardano|ada|polkadot|dot|xrp|ripple|dogecoin|doge|bnb|binance|prix\s+crypto|cours\s+crypto|shib|litecoin|ltc|avax|matic|polygon|ton|near|apt|sui)\b/i, extract: (m) => { const found = []; for (const [k, v] of Object.entries(CRYPTO_IDS)) { if (m.toLowerCase().includes(k) && k.length >= 3) found.push(v); } return found.length ? [...new Set(found)].join(',') : 'bitcoin,ethereum,solana'; } },
  { intent: 'crypto_detail', pattern: /\b(d[eé]tail|info|about|sur)\b.*\b(crypto|bitcoin|eth|sol)\b/i, extract: (m) => { for (const [k, v] of Object.entries(CRYPTO_IDS)) { if (m.toLowerCase().includes(k) && k.length >= 3) return v; } return 'bitcoin'; } },
  { intent: 'defi', pattern: /\b(defi|d[eé]centralis[eé]|tvl|protocol|liquidity)\b/i, extract: () => ({}) },
  { intent: 'crypto_global', pattern: /\b(march[eé]\s+crypto|crypto\s+march|global\s+crypto|crypto\s+global|market\s+cap|capitalisation)\b/i, extract: () => ({}) },
  { intent: 'news', pattern: /\b(news|actualit[eé]s?|actu|infos?\s|journal|presse|headlines|breaking|derni[eèe]res?\s+nouvelles?|mondiale)\b/i, extract: (m) => { for (const k of Object.keys(NEWS_SOURCES)) { if (m.toLowerCase().includes(k)) return k; } if (/tech/i.test(m)) return 'hn'; if (/sport/i.test(m)) return 'lequipe'; if (/bbc/i.test(m)) return 'bbc_world'; if (/science/i.test(m)) return 'bbc_science'; if (/s[eé]cu/i.test(m)) return 'krebs'; if (/gaming|jeu/i.test(m)) return 'ign'; return 'monde'; } },
  { intent: 'multi_news', pattern: /\b(toutes?\s+les?\s+(?:news|actu)|all\s+news|multi.*news|revue\s+de\s+presse)\b/i, extract: () => ['monde', 'bbc_world', 'guardian', 'hn'] },
  { intent: 'stock', pattern: /\b(bourse|stock|action|nasdaq|cac|s&p|dow|cours\s+bourse|share\s+price|tsx|nyse|wall\s*street)\b/i, extract: (m) => { const t = m.match(/\b([A-Z]{1,5})\b/); return t ? t[1] : 'AAPL'; } },
  { intent: 'market', pattern: /\b(march[eé]s?\s+(?:financier|boursier)|market\s+indic|indices?\s+boursier|indices?\s+march)/i, extract: () => ({}) },
  { intent: 'forex', pattern: /\b(forex|devise|change|taux\s+de\s+change|currency|exchange\s+rate|eur.?usd|usd.?eur)\b/i, extract: () => ({ base: 'EUR', targets: ['USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'] }) },
  { intent: 'inflation', pattern: /\b(inflation|ipc|cpi|co[uû]t\s+de\s+la\s+vie)\b/i, extract: (m) => { const c = m.match(/(?:en|in|for|de|du)\s+([A-Za-z\u00C0-\u024F]+)/i); return c ? c[1] : 'France'; } },
  { intent: 'economy', pattern: /\b([eé]conomie|economy|pib|gdp|ch[oô]mage|unemployment)\b/i, extract: (m) => { const c = m.match(/(?:en|in|for|de|du)\s+([A-Za-z]{2,3})/i); return c ? c[1] : 'FR'; } },
  { intent: 'translate', pattern: /\b(tradui[st]?|translate|traduction|translation)\b/i, extract: (m) => { const t = m.replace(/tradui[st]?|translate|traduction|translation/gi, '').trim(); return t || m; } },
  { intent: 'detect_lang', pattern: /\b(d[eé]tecter?\s+langue|detect\s+lang|quelle\s+langue)\b/i, extract: (m) => m },
  { intent: 'dictionary', pattern: /\b(d[eé]finition|define|dictionary|dictionnaire|signification|meaning)\b/i, extract: (m) => { const w = m.match(/(?:de|of|for)\s+["']?(\w+)["']?/i); return w ? w[1] : m.split(/\s+/).pop(); } },
  { intent: 'time', pattern: /\b(heure|time|clock|horloge|timezone|fuseau)\b/i, extract: (m) => { const tz = m.match(/(?:[àa]|in|at|de)\s+([A-Za-z_\/]+)/i); return tz ? tz[1] : 'Europe/Paris'; } },
  { intent: 'world_clocks', pattern: /\b(heures?\s+(?:du\s+)?monde|world\s+clocks?|toutes?\s+les?\s+heures?)\b/i, extract: () => null },
  { intent: 'movies', pattern: /\b(film|movie|cin[eé]ma|trending\s+movies?|box\s+office|sorties?\s+cin[eé])\b/i, extract: (m) => { if (/popular|populaire/i.test(m)) return { category: 'popular' }; if (/top|meilleur|best/i.test(m)) return { category: 'top_rated' }; if (/upcoming|[àa]\s+venir|bient[oô]t/i.test(m)) return { category: 'upcoming' }; if (/now|salle|playing/i.test(m)) return { category: 'now_playing' }; return {}; } },
  { intent: 'tv', pattern: /\b(s[eé]rie|tv\s*show|television|t[eé]l[eé]|streaming)\b/i, extract: (m) => { if (/popular/i.test(m)) return { category: 'popular' }; if (/top|best/i.test(m)) return { category: 'top_rated' }; return {}; } },
  { intent: 'search_movie', pattern: /\b(cherche[rz]?\s+(?:un\s+)?film|search\s+movie|find\s+movie|quel\s+film)\b/i, extract: (m) => { const q = m.match(/(?:film|movie)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'music', pattern: /\b(musique|music|chart|top\s+(?:songs?|titres?)|hit.?parade|playlist)\b/i, extract: (m) => { if (/us|america/i.test(m)) return { country: 'us' }; if (/uk|brit/i.test(m)) return { country: 'gb' }; return { country: 'fr' }; } },
  { intent: 'books', pattern: /\b(livre|book|lire|reading|bouquin|roman|auteur|author)\b/i, extract: (m) => { const q = m.match(/(?:livre|book|sur|about|de)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'games', pattern: /\b(jeu[x]?\s*vid[eé]o|video\s*game|gaming|playstation|xbox|nintendo|steam)\b/i, extract: (m) => { const q = m.match(/(?:jeu|game)\s+(.+)/i); return q ? { search: q[1].trim() } : {}; } },
  { intent: 'podcasts', pattern: /\b(podcast|[eé]mission|[eé]couter)\b/i, extract: (m) => { const q = m.match(/(?:podcast|sur|about)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'nasa', pattern: /\b(nasa|apod|space|espace|astronomie|astronomy|mars|ast[eé]ro[iï]de|iss|station\s+spatiale)\b/i, extract: (m) => { if (/mars/i.test(m)) return { type: 'mars' }; if (/ast[eé]ro[iï]de|neo/i.test(m)) return { type: 'asteroids' }; if (/iss|station/i.test(m)) return { type: 'iss' }; return { type: 'apod' }; } },
  { intent: 'earthquake', pattern: /\b(tremblement|earthquake|s[eé]isme|sismique|richter)\b/i, extract: (m) => { const mag = m.match(/(\d+\.?\d*)/); return { min_magnitude: mag ? parseFloat(mag[1]) : 4 }; } },
  { intent: 'space_events', pattern: /\b(lancement|launch|fus[eé]e|rocket|spacex|space\s+event)\b/i, extract: () => ({}) },
  { intent: 'recipe', pattern: /\b(recette|recipe|cuisine|cuisiner|cook|pr[eé]parer)\b/i, extract: (m) => { const q = m.match(/(?:recette|recipe|de|for|du)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'cocktail', pattern: /\b(cocktail|drink|boisson|ap[eé]ro|mojito|margarita)\b/i, extract: (m) => { const q = m.match(/(?:cocktail|drink|de|for)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'drug', pattern: /\b(m[eé]dicament|drug|pharma|paracetamol|ibuprof[eèe]ne|aspirine|notice)\b/i, extract: (m) => { const q = m.match(/(?:m[eé]dicament|drug|notice|sur|about|de)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'nutrition', pattern: /\b(nutrition|calories?|nutriment|prot[eé]ine|vitamines?|macros?)\b/i, extract: (m) => { const q = m.match(/(?:de|du|in|for|dans)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'calculate', pattern: /\b(calcul[eé]?|compute|math[eé]?matiq|combien\s+fait|how\s+much\s+is|\d+\s*[+\-*/^%]\s*\d+|\d+%\s+de)\b/i, extract: (m) => { const e = m.match(/(?:calcul[eé]?|compute|combien\s+fait|=)\s*(.+)/i); return e ? e[1].trim() : m; } },
  { intent: 'convert', pattern: /\b(converti[rs]?|convert|en\s+(?:km|miles?|kg|lb|celsius|fahrenheit|litres?))\b/i, extract: (m) => m },
  { intent: 'distance', pattern: /\b(distance|loin|far|km\s+entre|km\s+between|trajet)\b/i, extract: (m) => { const places = m.match(/(?:entre|between|from)\s+(.+?)\s+(?:et|and|to)\s+(.+)/i); return places ? { from: places[1], to: places[2] } : null; } },
  { intent: 'country', pattern: /\b(pays|country|info\s+(?:sur|about)\s+\w+|population|capitale|capital)\b/i, extract: (m) => { const c = m.match(/(?:pays|country|sur|about|de|du|la)\s+([A-Za-z\u00C0-\u024F]+)/i); return c ? c[1] : m; } },
  { intent: 'github', pattern: /\b(github|repo|repository|open\s*source)\b/i, extract: (m) => { const q = m.match(/(?:github|repo|repository)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'npm', pattern: /\b(npm|node\s*module|package\s+npm)\b/i, extract: (m) => { const q = m.match(/(?:npm|package)\s+(\S+)/i); return q ? q[1].trim() : m; } },
  { intent: 'pypi', pattern: /\b(pypi|pip|python\s+package)\b/i, extract: (m) => { const q = m.match(/(?:pypi|pip|package)\s+(\S+)/i); return q ? q[1].trim() : m; } },
  { intent: 'academic', pattern: /\b(arxiv|pubmed|article\s+(?:scientifique|acad[eé]miq)|paper|recherche\s+scientifiq|scholarly)\b/i, extract: (m) => { const q = m.match(/(?:arxiv|pubmed|article|paper|sur|about)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'hackernews', pattern: /\b(hacker\s*news|hn\b|ycombinator)\b/i, extract: (m) => { if (/best/i.test(m)) return { type: 'best' }; if (/new|nouveau/i.test(m)) return { type: 'new' }; return { type: 'top' }; } },
  { intent: 'wikipedia', pattern: /\b(wikip[eé]dia|wiki|encyclop[eé]die|qui\s+(?:est|[eé]tait|sont|[eé]taient)\s|who\s+(?:is|was|are))\b/i, extract: (m) => { const q = m.match(/(?:wikip[eé]dia|wiki|sur|about|est|was|is)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'website_check', pattern: /\b(site\s+(?:up|down|en\s+ligne)|check\s+(?:site|url|website)|ping\s+(?:site|url)|uptime|status\s+(?:de|of))\b/i, extract: (m) => { const u = m.match(/(https?:\/\/[^\s]+)/i); return u ? u[1] : m; } },
  { intent: 'domain', pattern: /\b(domain|dns|whois|nameserver)\b/i, extract: (m) => { const d = m.match(/(?:domain|dns|whois)\s+(\S+)/i); return d ? d[1] : m; } },
  { intent: 'ip', pattern: /\b(ip\s+(?:info|address|location)|my\s+ip|mon\s+ip|geoloc)\b/i, extract: (m) => { const ip = m.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/); return ip ? ip[1] : null; } },
  { intent: 'nearby', pattern: /\b(pr[eè]s\s+de|nearby|autour\s+de|around|[àa]\s+proximit[eé]|restaurant|h[oô]tel|hotel|pharmacie|supermarché)\b.*\b([àa]|in|de|du)\b/i, extract: (m) => { const c = m.match(/(?:[àa]|in|de|du|pour)\s+([A-Za-z\u00C0-\u024F\s-]+)/i); return c ? c[1].trim() : m; } },
  { intent: 'geocode', pattern: /\b(g[eé]ocode|coordonn[eé]es?|coordinates?|lat.*lon|localiser|o[uù]\s+(?:se\s+)?trouve|o[uù]\s+est|where\s+is|location\s+of)\b/i, extract: (m) => { const q = m.match(/(?:de|of|for|trouve|est)\s+(.+)/i); return q ? q[1].trim() : m; } },
  { intent: 'flights', pattern: /\b(vol|flight|avion|airplane|a[eé]roport|airport)\b/i, extract: (m) => m },
  { intent: 'transit', pattern: /\b(transport|m[eé]tro|metro|bus|tram|gare|station|train)\b/i, extract: (m) => { const c = m.match(/(?:[àa]|in|de|du)\s+([A-Za-z\u00C0-\u024F\s-]+)/i); return c ? c[1].trim() : m; } },
  { intent: 'search', pattern: /.*/, extract: (m) => m }
];

function detectIntent(message) {
  for (const { intent, pattern } of INTENTS) {
    if (intent === 'search') continue;
    if (pattern.test(message)) return intent;
  }
  return 'search';
}

// ═══════════════════════════════════════════════════════════
// SECTION 22: SMART SEARCH ROUTER
// ═══════════════════════════════════════════════════════════

async function smartSearch(message, opts = {}) {
  const intent = detectIntent(message);
  let data;
  const extractor = INTENTS.find((p) => p.intent === intent);
  const param = extractor ? extractor.extract(message) : message;

  try {
    switch (intent) {
      case 'weather': data = await getWeather(param || 'Paris'); break;
      case 'weather_compare': data = await compareWeather(param); break;
      case 'weather_alerts': data = await getWeatherAlerts(param || 'Paris'); break;
      case 'sports': data = await getSports(param); break;
      case 'standings': data = await getStandings(param); break;
      case 'f1': data = param === 'calendar' ? await getF1Calendar() : await getF1Standings(); break;
      case 'player': data = await getPlayerStats(param); break;
      case 'crypto': data = await getCrypto(param); break;
      case 'crypto_detail': data = await getCryptoDetail(param); break;
      case 'defi': data = await getDefiProtocols(); break;
      case 'crypto_global': data = await getGlobalCryptoStats(); break;
      case 'news': data = await getNews(param, opts); break;
      case 'multi_news': data = await getMultiNews(param, opts); break;
      case 'stock': data = await getStock(param); break;
      case 'market': data = await getMarketIndices(); break;
      case 'forex': data = await getForex(param.base || 'EUR', param.targets || ['USD', 'GBP']); break;
      case 'inflation': data = await getInflationData(param); break;
      case 'economy': data = await getEconomicIndicators(param); break;
      case 'translate': data = await translate(typeof param === 'string' ? param : message, opts); break;
      case 'detect_lang': data = await detectLanguage(param); break;
      case 'dictionary': data = await getDictionary(param, opts.lang || 'en'); break;
      case 'time': data = await getTime(param); break;
      case 'world_clocks': data = await getWorldClocks(); break;
      case 'movies': data = await getMovies(typeof param === 'object' ? param : opts); break;
      case 'tv': data = await getTVShows(typeof param === 'object' ? param : opts); break;
      case 'search_movie': data = await searchMovie(param, opts); break;
      case 'music': data = await getMusicCharts(typeof param === 'object' ? param : opts); break;
      case 'books': data = await getBooks(param); break;
      case 'games': data = await getVideoGames(typeof param === 'object' ? param : opts); break;
      case 'podcasts': data = await getPodcasts(param); break;
      case 'nasa': data = await getNASA(typeof param === 'object' ? param : opts); break;
      case 'earthquake': data = await getEarthquakes(typeof param === 'object' ? param : opts); break;
      case 'space_events': data = await getSpaceEvents(); break;
      case 'recipe': data = await searchRecipe(param); break;
      case 'cocktail': data = await getCocktail(param); break;
      case 'academic': data = await searchAcademic(param); break;
      case 'drug': data = await searchDrug(param); break;
      case 'nutrition': data = await getNutrition(param); break;
      case 'nearby': { const geo = await geocode(param); if (geo && geo[0]) data = await getNearbyPlaces(parseFloat(geo[0].lat), parseFloat(geo[0].lon)); else data = { error: 'Location not found' }; break; }
      case 'calculate': data = calculate(param); break;
      case 'convert': {
        const cm = message.match(/(\d+\.?\d*)\s*(\w+)\s+(?:en|in|to)\s+(\w+)/i);
        if (cm) data = convert(parseFloat(cm[1]), cm[2], cm[3]);
        else data = { error: 'Format: [value] [from] en/to [to]' };
        break;
      }
      case 'distance': data = param ? await getDistance(param.from, param.to) : { error: 'Format: distance entre X et Y' }; break;
      case 'country': data = await getCountryInfo(param); break;
      case 'github': data = await searchGitHub(param); break;
      case 'npm': data = await getNpmPackage(param); break;
      case 'pypi': data = await getPyPIPackage(param); break;
      case 'hackernews': data = await getHackerNews(typeof param === 'object' ? param : {}); break;
      case 'wikipedia': data = await getWikipedia(param, opts); break;
      case 'website_check': data = await checkWebsite(param); break;
      case 'domain': data = await getDomainInfo(param); break;
      case 'ip': data = await getIPInfo(param); break;
      case 'geocode': data = await geocode(param); break;
      case 'flights': data = await getFlights(opts); break;
      case 'transit': data = await getPublicTransit(param); break;
      default: data = await search(message); break;
    }
  } catch (err) {
    data = { error: err.message };
  }
  return { intent, data };
}

// ═══════════════════════════════════════════════════════════
// SECTION 23: FORMAT FOR AI
// ═══════════════════════════════════════════════════════════

function formatForAI(result) {
  if (!result) return '[NO DATA]';
  const intent = result.intent ? `[Intent: ${result.intent}]` : '';
  const data = result.data || result;
  return `[DONNEES WEB TEMPS REEL] ${intent}\n${JSON.stringify(data, null, 2)}\n[FIN DONNEES]`;
}

// ═══════════════════════════════════════════════════════════
// CACHE WARM-UP
// ═══════════════════════════════════════════════════════════

let _warmupDone = false;
function warmupCache() {
  if (_warmupDone) return;
  _warmupDone = true;
  setTimeout(async () => {
    try {
      await Promise.allSettled([
        getWeather('Paris'), getCrypto(['bitcoin','ethereum','solana']),
        getGlobalCryptoStats(), getForex('EUR'), getMarketIndices(),
        getSports('ligue1'), getMultiNews(['monde','bbc_world'], { limit: 10 }),
        getMovies({ type: 'trending' }),
      ]);
      console.log('[WebIntel] Cache warm-up done');
    } catch (e) {}
  }, 3000);
}

// Auto-refresh crypto/forex toutes les 2min
setInterval(() => {
  Promise.allSettled([
    getCrypto(['bitcoin','ethereum','solana']),
    getGlobalCryptoStats(), getForex('EUR'),
  ]).catch(() => {});
}, 120000).unref();

// ═══════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  // Core
  fetchRaw,
  fetchJSON,
  fetchText,
  cached,
  parseRSS,
  parseXML,
  xmlVal,

  // Weather
  getWeather,
  compareWeather,
  getWeatherAlerts,

  // Search
  search,
  searchImages,
  searchAcademic,

  // Sports
  getSports,
  getStandings,
  getPlayerStats,
  getF1Calendar,
  getF1Standings,
  LEAGUES,

  // News
  getNews,
  getMultiNews,
  searchNews,
  NEWS_SOURCES,

  // Finance
  getStock,
  getStockPrice,
  getMultipleStocks,
  getMarketIndices,

  // Crypto
  getCrypto,
  getCryptoDetail,
  getDefiProtocols,
  getGlobalCryptoStats,
  CRYPTO_IDS,

  // Forex
  getForex,
  getInflationData,
  getEconomicIndicators,

  // Flights
  getFlights,
  getAirportInfo,
  getPublicTransit,

  // Entertainment
  getMovies,
  getTVShows,
  searchMovie,
  getMusicCharts,
  getBooks,
  getVideoGames,
  getPodcasts,

  // Geo
  geocode,
  reverseGeocode,
  getDistance,
  getNearbyPlaces,
  getCountryInfo,

  // Science
  getNASA,
  getEarthquakes,
  getSpaceEvents,

  // Health
  searchDrug,
  searchDrugEU,
  getNutrition,

  // Translation
  translate,
  detectLanguage,
  getDictionary,
  LANG_CODES,

  // Calculate
  calculate,
  convert,

  // Time
  getTime,
  getWorldClocks,

  // Food
  searchRecipe,
  getCocktail,

  // Tech
  searchGitHub,
  getNpmPackage,
  getPyPIPackage,
  getHackerNews,
  getProductHunt,
  getDockerHub,

  // Education
  getWikipedia,
  getMathProof,

  // Internet
  checkWebsite,
  getDomainInfo,
  getIPInfo,
  shortenURL,

  // Intelligence
  detectIntent,
  smartSearch,
  formatForAI,
  warmupCache,
  INTENTS
};
