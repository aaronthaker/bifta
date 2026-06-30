const API_ROOT = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const PINNACLE_ROOT = "https://guest.api.arcadia.pinnacle.com/0.1";
const PINNACLE_SOCCER_ID = 29;
const PINNACLE_API_KEY = "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R";
const ODDS_SNAPSHOT_STORAGE_KEY = "touchline:pinnacleOddsSnapshot:v1";
const ODDS_MOVEMENTS_STORAGE_KEY = "touchline:pinnacleOddsMovements:v1";
const MAX_ODDS_MOVEMENTS = 80;
const ODDS_CHANGE_FIELDS = ["home", "draw", "away"];
const SPORTSDB_ROOT = "https://www.thesportsdb.com/api/v1/json/3";
const FORM_LOOKBACK_DAYS = 420;
const FORM_SAMPLE_SIZE = 5;
const PLAYER_STAT_COLUMNS = [
  { name: "subIns", label: "SUB", title: "Substitute appearances" },
  { name: "totalGoals", label: "G", title: "Goals" },
  { name: "goalAssists", label: "A", title: "Assists" },
  { name: "totalShots", label: "SH", title: "Shots" },
  { name: "shotsOnTarget", label: "SOT", title: "Shots on target" },
  { name: "offsides", label: "OFF", title: "Offsides" },
  { name: "foulsCommitted", label: "FC", title: "Fouls committed" },
  { name: "foulsSuffered", label: "FS", title: "Fouls suffered" },
  { name: "yellowCards", label: "YC", title: "Yellow cards" },
  { name: "redCards", label: "RC", title: "Red cards" },
  { name: "ownGoals", label: "OG", title: "Own goals" },
  { name: "saves", label: "SV", title: "Saves" },
  { name: "shotsFaced", label: "SHF", title: "Shots faced" },
  { name: "goalsConceded", label: "GA", title: "Goals conceded" },
];

const LEAGUES = [
  { slug: "fifa.world", name: "FIFA World Cup", category: "Global" },
];

const state = {
  allMatches: [],
  filteredMatches: [],
  failures: [],
  oddsFailures: [],
  oddsSnapshot: readStoredOddsSnapshot(),
  oddsMovements: readStoredOddsMovements(),
  latestOddsChangeCount: 0,
  selectedCompetition: "all",
  query: "",
  rangeDays: 7,
  loadedAt: null,
  oddsLoadedAt: null,
  oddsCoverage: 0,
  selectedMatchId: null,
  marketCache: new Map(),
  formCache: new Map(),
  summaryCache: new Map(),
  squadCache: new Map(),
  sportsDbTeamCache: new Map(),
  sportsDbEventsCache: new Map(),
  recentResultsPromise: null,
  recentResultsLoadedAt: null,
  activeDrawerRequest: null,
  timer: null,
};

const elements = {
  syncPill: document.querySelector("#syncPill"),
  syncText: document.querySelector("#syncText"),
  oddsPill: document.querySelector("#oddsPill"),
  oddsText: document.querySelector("#oddsText"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  competitionFilter: document.querySelector("#competitionFilter"),
  rangeOptions: Array.from(document.querySelectorAll(".range-option")),
  totalMatches: document.querySelector("#totalMatches"),
  todayMatches: document.querySelector("#todayMatches"),
  oddsMatches: document.querySelector("#oddsMatches"),
  nextKickoff: document.querySelector("#nextKickoff"),
  timezoneLabel: document.querySelector("#timezoneLabel"),
  spotlight: document.querySelector("#spotlight"),
  leagueBreakdown: document.querySelector("#leagueBreakdown"),
  resultsLabel: document.querySelector("#resultsLabel"),
  stateMessage: document.querySelector("#stateMessage"),
  oddsMovementPanel: document.querySelector("#oddsMovementPanel"),
  dateRail: document.querySelector("#dateRail"),
  fixturesList: document.querySelector("#fixturesList"),
  drawer: document.querySelector("#matchDrawer"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  drawerClose: document.querySelector("#drawerClose"),
  drawerEyebrow: document.querySelector("#drawerEyebrow"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerBody: document.querySelector("#drawerBody"),
};

const TEAM_ALIASES = new Map(
  Object.entries({
    "bosnia and herzegovina": "bosnia herzegovina",
    "bosnia-herzegovina": "bosnia herzegovina",
    "czech republic": "czechia",
    "korea republic": "south korea",
    "republic of korea": "south korea",
    "united states": "usa",
    "united states of america": "usa",
    "ivory coast": "cote divoire",
    "cote d ivoire": "cote divoire",
    "dr congo": "congo dr",
    "democratic republic of congo": "congo dr",
    "uae": "united arab emirates",
    "u a e": "united arab emirates",
    "cape verde islands": "cape verde",
    "curaçao": "curacao",
  }),
);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatDateParam(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getDateWindow(days) {
  const visibleStart = new Date();
  visibleStart.setHours(0, 0, 0, 0);

  const apiStart = new Date(visibleStart);
  apiStart.setDate(apiStart.getDate() - 1);

  const end = new Date(visibleStart);
  end.setDate(end.getDate() + days);

  return {
    start: visibleStart,
    end,
    apiRange: `${formatDateParam(apiStart)}-${formatDateParam(end)}`,
  };
}

function apiUrl(slug, range, limit = 120) {
  return `${API_ROOT}/${slug}/scoreboard?dates=${range}&limit=${limit}`;
}

async function fetchCompetition(source, range, limit = 120) {
  const response = await fetch(apiUrl(source.slug, range, limit), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`${source.name} returned ${response.status}`);
  }

  const payload = await response.json();
  return normalizePayload(payload, source);
}

async function fetchAggregateFallback(range, limit = 120) {
  const response = await fetch(apiUrl("all", range, limit), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Global scoreboard returned ${response.status}`);
  }

  const payload = await response.json();
  return normalizePayload(payload, {
    slug: "all",
    name: "Global Fixtures",
    category: "All soccer",
  });
}

function normalizePayload(payload, source) {
  const league = payload.leagues?.find((item) => item?.name) || {};
  const competitionName = league.name || source.name;
  const competitionSlug = league.slug || source.slug;
  const leagueLogo = findLogo(league.logos);

  return (payload.events || []).map((event) =>
    normalizeEvent(event, {
      competitionName,
      competitionSlug,
      category: source.category,
      leagueLogo,
    }),
  );
}

function normalizeEvent(event, source) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const home = competitors.find((entry) => entry.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((entry) => entry.homeAway === "away") || competitors[1] || {};
  const date = new Date(competition.date || event.date);
  const broadcasts = collectBroadcasts(competition);
  const venue = competition.venue || event.venue || {};
  const address = venue.address || {};
  const eventLink = event.links?.find((link) => link.rel?.includes("summary"))?.href || "";
  const statusType = competition.status?.type || event.status?.type || {};

  return {
    id: event.id,
    date,
    timestamp: date.getTime(),
    completed: Boolean(statusType.completed),
    status: statusType.description || "Scheduled",
    statusDetail: statusType.shortDetail || statusType.detail || "",
    competition: source.competitionName,
    competitionSlug: source.competitionSlug,
    category: source.category,
    leagueLogo: source.leagueLogo,
    home: normalizeTeam(home),
    away: normalizeTeam(away),
    venueName: venue.fullName || venue.displayName || "Venue TBA",
    venuePlace: [address.city, address.country].filter(Boolean).join(", "),
    broadcasts,
    eventLink,
  };
}

function normalizeTeam(entry) {
  const team = entry.team || {};
  return {
    id: team.id || entry.id || "",
    name: team.displayName || team.shortDisplayName || team.name || "TBA",
    shortName: team.shortDisplayName || team.abbreviation || team.name || "TBA",
    abbreviation: team.abbreviation || "",
    logo: team.logo || findLogo(team.logos),
    score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
  };
}

function findLogo(logos) {
  if (!Array.isArray(logos)) {
    return "";
  }

  return logos.find((logo) => logo.rel?.includes("default"))?.href || logos[0]?.href || "";
}

function collectBroadcasts(competition) {
  const direct = competition.broadcasts?.flatMap((item) => item.names || []) || [];
  const geo = competition.geoBroadcasts?.map((item) => item.media?.shortName).filter(Boolean) || [];
  return Array.from(new Set([...direct, ...geo])).slice(0, 4);
}

async function loadFixtures() {
  setLoading(true);
  setOddsLoading(true);
  closeMatchDetails();
  state.marketCache.clear();
  state.formCache.clear();
  state.squadCache.clear();
  clearMessage();

  const { apiRange } = getDateWindow(state.rangeDays);
  const settled = await Promise.allSettled(LEAGUES.map((league) => fetchCompetition(league, apiRange)));
  const matches = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  state.failures = settled
    .map((result, index) => ({ result, source: LEAGUES[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, source }) => `${source.name}: ${result.reason.message}`);

  const nextMatches = dedupeAndSort(matches);

  state.allMatches = nextMatches.filter((match) => match.timestamp >= Date.now());
  await attachPinnacleOdds(state.allMatches);
  state.loadedAt = new Date();
  updateCompetitionOptions();
  applyFilters();
  setLoading(false);
}

async function attachPinnacleOdds(matches) {
  try {
    state.oddsFailures = [];
    state.latestOddsChangeCount = 0;
    const [pinnacleMatchups, pinnacleMarkets] = await Promise.all([
      fetchPinnacle(`/sports/${PINNACLE_SOCCER_ID}/matchups?withSpecials=false`),
      fetchPinnacle(`/sports/${PINNACLE_SOCCER_ID}/markets/straight?primaryOnly=true&withSpecials=false`),
    ]);
    const oddsLoadedAt = new Date();

    const marketByMatchupId = mapPinnacleMarkets(pinnacleMarkets);
    const candidates = normalizePinnacleMatchups(pinnacleMatchups).filter((matchup) =>
      marketByMatchupId.has(matchup.id),
    );

    let matchedCount = 0;
    state.oddsLoadedAt = oddsLoadedAt;
    for (const match of matches) {
      const matchResult = findPinnacleMatch(match, candidates, marketByMatchupId);
      if (matchResult) {
        match.odds = matchResult.odds;
        matchedCount += 1;
      } else {
        match.odds = null;
      }
    }

    state.oddsCoverage = matchedCount;
    recordPinnacleOddsMovements(matches, oddsLoadedAt);
    setOddsLoading(false);
  } catch (error) {
    state.oddsCoverage = 0;
    state.oddsLoadedAt = null;
    state.latestOddsChangeCount = 0;
    state.oddsFailures = [error.message || "Pinnacle odds could not be loaded."];
    matches.forEach((match) => {
      match.odds = null;
    });
    setOddsLoading(false, true);
  }
}

async function fetchPinnacle(path) {
  const response = await fetch(`${PINNACLE_ROOT}${path}`, {
    headers: {
      Accept: "application/json",
      "X-API-Key": PINNACLE_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Pinnacle returned ${response.status}`);
  }

  return response.json();
}

async function fetchPinnacleMarketsForMatch(match) {
  if (!match.odds?.matchupId) {
    throw new Error("No Pinnacle matchup is available for this fixture.");
  }

  const cacheKey = String(match.odds.matchupId);
  if (state.marketCache.has(cacheKey)) {
    return state.marketCache.get(cacheKey);
  }

  const markets = await fetchPinnacle(
    `/matchups/${match.odds.matchupId}/markets/straight?primaryOnly=false&withSpecials=true`,
  );
  const payload = {
    markets: markets || [],
    loadedAt: new Date(),
  };
  state.marketCache.set(cacheKey, payload);
  return payload;
}

function readStoredOddsMovements() {
  const movements = readStoredJson(ODDS_MOVEMENTS_STORAGE_KEY, []);
  if (!Array.isArray(movements)) {
    return [];
  }

  return movements
    .filter((movement) => movement?.detectedAt && Array.isArray(movement.changes))
    .sort(compareOddsMovements)
    .slice(0, MAX_ODDS_MOVEMENTS);
}

function readStoredOddsSnapshot() {
  const snapshot = readStoredJson(ODDS_SNAPSHOT_STORAGE_KEY, {});
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
}

function readStoredJson(key, fallback) {
  const storage = getLocalStorage();
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage can be unavailable in private contexts; the live session still works.
  }
}

function getLocalStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function recordPinnacleOddsMovements(matches, detectedAt) {
  const previousSnapshot = state.oddsSnapshot || readStoredOddsSnapshot();
  const nextSnapshot = {};
  const newMovements = [];

  for (const match of matches) {
    const snapshot = buildPinnacleOddsSnapshot(match, detectedAt);
    if (!snapshot) {
      continue;
    }

    nextSnapshot[snapshot.key] = snapshot.entry;

    const previous = previousSnapshot[snapshot.key];
    const changes = buildPinnacleOddsChanges(previous, snapshot.entry, match);
    if (changes.length) {
      newMovements.push({
        id: `${snapshot.key}-${detectedAt.getTime()}-${changes
          .map((change) => change.designation)
          .join("-")}`,
        matchupId: snapshot.key,
        detectedAt: detectedAt.toISOString(),
        fixture: snapshot.entry.fixture,
        home: snapshot.entry.home,
        away: snapshot.entry.away,
        competition: snapshot.entry.competition,
        kickoff: snapshot.entry.kickoff,
        changes,
      });
    }
  }

  state.latestOddsChangeCount = newMovements.length;
  state.oddsSnapshot = pruneOddsSnapshot({ ...previousSnapshot, ...nextSnapshot }, detectedAt);
  writeStoredJson(ODDS_SNAPSHOT_STORAGE_KEY, state.oddsSnapshot);

  if (!newMovements.length) {
    return;
  }

  state.oddsMovements = [...newMovements, ...state.oddsMovements]
    .sort(compareOddsMovements)
    .slice(0, MAX_ODDS_MOVEMENTS);
  writeStoredJson(ODDS_MOVEMENTS_STORAGE_KEY, state.oddsMovements);
}

function buildPinnacleOddsSnapshot(match, capturedAt) {
  if (!match.odds?.matchupId) {
    return null;
  }

  const odds = Object.fromEntries(
    ODDS_CHANGE_FIELDS.map((field) => [field, Number(match.odds[field])]),
  );

  if (!ODDS_CHANGE_FIELDS.every((field) => Number.isFinite(odds[field]))) {
    return null;
  }

  const key = String(match.odds.matchupId);
  return {
    key,
    entry: {
      matchupId: key,
      capturedAt: capturedAt.toISOString(),
      fixture: `${match.home.name} vs ${match.away.name}`,
      home: match.home.name,
      away: match.away.name,
      competition: match.competition,
      kickoff: match.date.toISOString(),
      odds,
    },
  };
}

function buildPinnacleOddsChanges(previous, current, match) {
  if (!previous?.odds) {
    return [];
  }

  return ODDS_CHANGE_FIELDS.map((designation) => {
    const previousValue = Number(previous.odds[designation]);
    const currentValue = Number(current.odds[designation]);
    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue) || previousValue === currentValue) {
      return null;
    }

    return {
      designation,
      label: oddsDesignationLabel(designation, match),
      previous: previousValue,
      current: currentValue,
      direction: oddsMoveDirection(previousValue, currentValue),
    };
  }).filter(Boolean);
}

function oddsDesignationLabel(designation, match) {
  if (designation === "home") {
    return match.home.shortName || match.home.name || "Home";
  }
  if (designation === "away") {
    return match.away.shortName || match.away.name || "Away";
  }
  return "Draw";
}

function oddsMoveDirection(previous, current) {
  const previousDecimal = americanToDecimal(previous);
  const currentDecimal = americanToDecimal(current);
  if (!Number.isFinite(previousDecimal) || !Number.isFinite(currentDecimal)) {
    return "moved";
  }
  if (currentDecimal < previousDecimal) {
    return "shortened";
  }
  if (currentDecimal > previousDecimal) {
    return "drifted";
  }
  return "moved";
}

function pruneOddsSnapshot(snapshot, now) {
  const cutoff = now.getTime() - 45 * 24 * 60 * 60 * 1000;
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, entry]) => {
      const kickoff = Date.parse(entry?.kickoff || "");
      const captured = Date.parse(entry?.capturedAt || "");
      return (
        (Number.isFinite(kickoff) && kickoff >= cutoff) ||
        (Number.isFinite(captured) && captured >= cutoff)
      );
    }),
  );
}

function compareOddsMovements(first, second) {
  const detectedDelta = movementDateMs(second.detectedAt) - movementDateMs(first.detectedAt);
  if (detectedDelta) {
    return detectedDelta;
  }
  return movementDateMs(first.kickoff) - movementDateMs(second.kickoff);
}

function movementDateMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

async function fetchTeamFormForMatch(match) {
  const cacheKey = `${match.home.id || normalizeTeamName(match.home.name)}-${match.away.id || normalizeTeamName(match.away.name)}`;
  if (state.formCache.has(cacheKey)) {
    return state.formCache.get(cacheKey);
  }

  try {
    const form = await fetchDetailedTeamFormForMatch(match);
    state.formCache.set(cacheKey, form);
    return form;
  } catch (error) {
    const fallback = await fetchFallbackTeamFormForMatch(match);
    fallback.error = `Full match stats were unavailable. Showing scoreline data only.`;
    state.formCache.set(cacheKey, fallback);
    return fallback;
  }
}

async function fetchDetailedTeamFormForMatch(match) {
  const [matchSummary, fetchedHomeSquad, fetchedAwaySquad] = await Promise.all([
    fetchEspnSummary(match.id),
    fetchWorldCupSquad(match.home),
    fetchWorldCupSquad(match.away),
  ]);
  const formEntries = matchSummary.boxscore?.form || [];
  const homeEntry = findFormEntry(formEntries, match.home);
  const awayEntry = findFormEntry(formEntries, match.away);
  const homeSquad =
    fetchedHomeSquad.length
      ? fetchedHomeSquad
      : normalizeWorldCupSquad(
          findSummaryRoster(matchSummary.rosters, match.home.id, match.home.name)?.roster,
        );
  const awaySquad =
    fetchedAwaySquad.length
      ? fetchedAwaySquad
      : normalizeWorldCupSquad(
          findSummaryRoster(matchSummary.rosters, match.away.id, match.away.name)?.roster,
        );

  if (!homeEntry || !awayEntry) {
    throw new Error("ESPN did not return both teams' recent form.");
  }

  const homeEvents = (homeEntry.events || []).slice(0, FORM_SAMPLE_SIZE);
  const awayEvents = (awayEntry.events || []).slice(0, FORM_SAMPLE_SIZE);
  const eventIds = Array.from(new Set([...homeEvents, ...awayEvents].map((event) => event.id).filter(Boolean)));
  const settled = await Promise.allSettled(eventIds.map((eventId) => fetchEspnSummary(eventId)));
  const summaryByEvent = new Map();

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      summaryByEvent.set(String(eventIds[index]), result.value);
    }
  });

  const homeGames = homeEvents.map((event) =>
    normalizeDetailedFormGame(event, homeEntry.team, summaryByEvent.get(String(event.id))),
  );
  const awayGames = awayEvents.map((event) =>
    normalizeDetailedFormGame(event, awayEntry.team, summaryByEvent.get(String(event.id))),
  );

  return {
    loadedAt: new Date(),
    source: "ESPN match summaries",
    detailedGamesLoaded: summaryByEvent.size,
    detailedGamesRequested: eventIds.length,
    home: buildTeamFormFromGames(match.home, homeGames, homeSquad),
    away: buildTeamFormFromGames(match.away, awayGames, awaySquad),
  };
}

async function fetchFallbackTeamFormForMatch(match) {
  const recentResults = await fetchRecentResults();
  const [homeSportsDbGames, awaySportsDbGames] = await Promise.all([
    fetchSportsDbRecentGames(match.home, match.timestamp),
    fetchSportsDbRecentGames(match.away, match.timestamp),
  ]);
  const homeGames = mergeTeamGames(
    collectTeamGamesFromResults(match.home, recentResults, match.timestamp),
    homeSportsDbGames,
  );
  const awayGames = mergeTeamGames(
    collectTeamGamesFromResults(match.away, recentResults, match.timestamp),
    awaySportsDbGames,
  );
  return {
    loadedAt: state.recentResultsLoadedAt || new Date(),
    home: buildTeamFormFromGames(match.home, homeGames),
    away: buildTeamFormFromGames(match.away, awayGames),
  };
}

async function fetchEspnSummary(eventId) {
  const cacheKey = String(eventId);
  if (state.summaryCache.has(cacheKey)) {
    return state.summaryCache.get(cacheKey);
  }

  const promise = fetch(`${API_ROOT}/all/summary?event=${encodeURIComponent(cacheKey)}`, {
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`ESPN match summary returned ${response.status}`);
    }
    return response.json();
  });

  state.summaryCache.set(cacheKey, promise);
  return promise;
}

async function fetchWorldCupSquad(team) {
  if (!team.id) {
    return [];
  }

  const cacheKey = String(team.id);
  if (state.squadCache.has(cacheKey)) {
    return state.squadCache.get(cacheKey);
  }

  const promise = fetch(
    `${API_ROOT}/fifa.world/teams/${encodeURIComponent(cacheKey)}/roster`,
    { headers: { Accept: "application/json" } },
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(`ESPN squad returned ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => normalizeWorldCupSquad(payload.athletes))
    .catch(() => []);

  state.squadCache.set(cacheKey, promise);
  return promise;
}

function findFormEntry(entries, team) {
  return (
    entries.find((entry) => team.id && String(entry.team?.id) === String(team.id)) ||
    entries.find((entry) => teamSimilarity(normalizeTeamName(entry.team?.displayName), normalizeTeamName(team.name)) >= 0.9)
  );
}

function normalizeDetailedFormGame(event, team, summary) {
  const isHome = String(event.homeTeamId) === String(team.id);
  const goalsFor = Number(isHome ? event.homeTeamScore : event.awayTeamScore);
  const goalsAgainst = Number(isHome ? event.awayTeamScore : event.homeTeamScore);
  const teamBox = findSummaryTeam(summary?.boxscore?.teams, team.id, team.displayName);
  const opponentBox = (summary?.boxscore?.teams || []).find(
    (entry) => String(entry.team?.id) !== String(team.id),
  );
  const roster = findSummaryRoster(summary?.rosters, team.id, team.displayName);
  const date = new Date(event.gameDate);

  return {
    matchId: event.id,
    date,
    timestamp: date.getTime(),
    competition: event.competitionName || event.leagueName || "International",
    opponent: normalizeSummaryOpponent(event.opponent),
    side: isHome ? "home" : "away",
    goalsFor: Number.isFinite(goalsFor) ? goalsFor : 0,
    goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : 0,
    outcome: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
    source: "ESPN",
    teamStats: normalizeSummaryStats(teamBox?.statistics),
    opponentStats: normalizeSummaryStats(opponentBox?.statistics),
    players: normalizeSummaryPlayers(roster?.roster),
    scorers: normalizeSummaryScorers(summary?.keyEvents, team.id),
    hasFullStats: Boolean(teamBox?.statistics?.length),
  };
}

function findSummaryTeam(teams, teamId, teamName) {
  return (
    (teams || []).find((entry) => teamId && String(entry.team?.id) === String(teamId)) ||
    (teams || []).find(
      (entry) => teamSimilarity(normalizeTeamName(entry.team?.displayName), normalizeTeamName(teamName)) >= 0.9,
    )
  );
}

function findSummaryRoster(rosters, teamId, teamName) {
  return (
    (rosters || []).find((entry) => teamId && String(entry.team?.id) === String(teamId)) ||
    (rosters || []).find(
      (entry) => teamSimilarity(normalizeTeamName(entry.team?.displayName), normalizeTeamName(teamName)) >= 0.9,
    )
  );
}

function normalizeSummaryOpponent(opponent) {
  return {
    id: opponent?.id || "",
    name: opponent?.displayName || "Opponent",
    shortName: opponent?.displayName || "Opponent",
    abbreviation: opponent?.abbreviation || "",
    logo: opponent?.logo || findLogo(opponent?.logos),
    score: null,
  };
}

function normalizeSummaryStats(stats) {
  return (stats || []).map((stat) => ({
    name: stat.name,
    label: stat.label || stat.displayName || stat.name,
    value: Number.isFinite(Number(stat.value)) ? Number(stat.value) : parseSummaryStatValue(stat.displayValue),
    displayValue: formatSummaryStatDisplay(stat),
  }));
}

function parseSummaryStatValue(value) {
  const number = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function formatSummaryStatDisplay(stat) {
  const value = Number.isFinite(Number(stat.value)) ? Number(stat.value) : parseSummaryStatValue(stat.displayValue);
  if (!Number.isFinite(value)) {
    return stat.displayValue ?? "-";
  }

  if (stat.name === "possessionPct") {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }

  if (stat.name?.endsWith("Pct")) {
    const percentage = value <= 1 ? value * 100 : value;
    return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
  }

  return stat.displayValue ?? String(value);
}

function normalizeSummaryPlayers(roster) {
  return (roster || [])
    .filter((player) => {
      const appearances = (player.stats || []).find((stat) => stat.name === "appearances");
      return Number(appearances?.value) > 0 || player.starter || player.subbedIn || player.subbedOut;
    })
    .map((player) => ({
      id: player.athlete?.id || "",
      name: player.athlete?.displayName || "Player",
      shortName: player.athlete?.shortName || player.athlete?.displayName || "Player",
      starter: Boolean(player.starter),
      position: player.position?.abbreviation || "",
      positionName: player.position?.displayName || "",
      stats: Object.fromEntries(
        (player.stats || []).map((stat) => [stat.name, Number.isFinite(Number(stat.value)) ? Number(stat.value) : 0]),
      ),
    }));
}

function normalizeWorldCupSquad(roster) {
  const players = new Map();

  for (const player of roster || []) {
    const athlete = player.athlete || player;
    const position = player.position || athlete.position;
    const id = athlete.id || "";
    const name = athlete.displayName || athlete.fullName || "";
    if (!name) {
      continue;
    }

    const key = id || normalizeTeamName(name);
    if (!players.has(key)) {
      players.set(key, {
        id,
        name,
        shortName: athlete.shortName || name,
        jersey: player.jersey || athlete.jersey || "",
        position: position?.abbreviation === "SUB" ? "" : position?.abbreviation || "",
        positionName:
          position?.displayName === "Substitute" ? "" : position?.displayName || position?.name || "",
      });
    }
  }

  return Array.from(players.values()).sort(
    (a, b) =>
      squadPositionRank(a.position) - squadPositionRank(b.position) ||
      Number(a.jersey || 999) - Number(b.jersey || 999) ||
      a.name.localeCompare(b.name),
  );
}

function squadPositionRank(position) {
  const value = String(position || "").toUpperCase();
  if (value === "G" || value === "GK") {
    return 0;
  }
  if (value.includes("B") || value.includes("D")) {
    return 1;
  }
  if (value.includes("M")) {
    return 2;
  }
  if (value.includes("F") || value.includes("W")) {
    return 3;
  }
  return 4;
}

function normalizeSummaryScorers(events, teamId) {
  return (events || [])
    .filter(
      (event) =>
        event.scoringPlay &&
        event.type?.type === "goal" &&
        String(event.team?.id) === String(teamId) &&
        event.participants?.[0]?.athlete,
    )
    .map((event) => ({
      id: event.participants[0].athlete.id || "",
      name: event.participants[0].athlete.displayName || "Scorer",
      minute: event.clock?.displayValue || "",
    }));
}

async function loadMatchFormSafely(match) {
  try {
    return await fetchTeamFormForMatch(match);
  } catch (error) {
    return {
      loadedAt: new Date(),
      error: error.message || "Recent team form could not be loaded.",
      home: emptyTeamForm(match.home),
      away: emptyTeamForm(match.away),
    };
  }
}

async function fetchRecentResults() {
  if (state.recentResultsPromise) {
    return state.recentResultsPromise;
  }

  state.recentResultsPromise = (async () => {
    const { apiRange } = getPastDateWindow(FORM_LOOKBACK_DAYS);
    const settled = await Promise.allSettled(
      LEAGUES.map((league) => fetchCompetition(league, apiRange, 500)),
    );
    const matches = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

    let recentResults = dedupeAndSort(matches).filter(
      (match) => match.completed && match.timestamp < Date.now() && hasValidScore(match),
    );

    if (recentResults.length < 40) {
      try {
        const fallbackMatches = await fetchAggregateFallback(apiRange, 500);
        recentResults = dedupeAndSort([...recentResults, ...fallbackMatches]).filter(
          (match) => match.completed && match.timestamp < Date.now() && hasValidScore(match),
        );
      } catch (error) {
        // The per-league history is still usable if the aggregate endpoint is unavailable.
      }
    }

    state.recentResultsLoadedAt = new Date();
    return recentResults;
  })();

  return state.recentResultsPromise;
}

function getPastDateWindow(days) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  return {
    start,
    end,
    apiRange: `${formatDateParam(start)}-${formatDateParam(end)}`,
  };
}

function hasValidScore(match) {
  return Number.isFinite(match.home.score) && Number.isFinite(match.away.score);
}

function buildTeamForm(team, results, beforeTimestamp) {
  return buildTeamFormFromGames(team, collectTeamGamesFromResults(team, results, beforeTimestamp));
}

function collectTeamGamesFromResults(team, results, beforeTimestamp) {
  const cutoff = Math.min(beforeTimestamp, Date.now());
  return results
    .filter((match) => match.timestamp < cutoff)
    .map((match) => teamResultFromMatch(match, team))
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, FORM_SAMPLE_SIZE);
}

function buildTeamFormFromGames(team, games, squad = []) {
  if (!games.length) {
    return {
      ...emptyTeamForm(team),
      squadSize: squad.length,
      playerTrends: summarizePlayerTrends(games, squad),
    };
  }

  const totals = games.reduce(
    (acc, game) => {
      acc.goalsFor += game.goalsFor;
      acc.goalsAgainst += game.goalsAgainst;
      acc.wins += game.outcome === "W" ? 1 : 0;
      acc.draws += game.outcome === "D" ? 1 : 0;
      acc.losses += game.outcome === "L" ? 1 : 0;
      acc.scoredIn += game.goalsFor > 0 ? 1 : 0;
      acc.concededIn += game.goalsAgainst > 0 ? 1 : 0;
      acc.cleanSheets += game.goalsAgainst === 0 ? 1 : 0;
      acc.twoPlusGoals += game.goalsFor >= 2 ? 1 : 0;
      acc.over25MatchGoals += game.goalsFor + game.goalsAgainst > 2.5 ? 1 : 0;
      return acc;
    },
    {
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      scoredIn: 0,
      concededIn: 0,
      cleanSheets: 0,
      twoPlusGoals: 0,
      over25MatchGoals: 0,
    },
  );

  return {
    team,
    games,
    played: games.length,
    ...totals,
    avgFor: totals.goalsFor / games.length,
    avgAgainst: totals.goalsAgainst / games.length,
    avgTotal: (totals.goalsFor + totals.goalsAgainst) / games.length,
    avgGoalDiff: (totals.goalsFor - totals.goalsAgainst) / games.length,
    record: `${totals.wins}-${totals.draws}-${totals.losses}`,
    formLine: games.map((game) => game.outcome).join(""),
    sources: Array.from(new Set(games.map((game) => game.source).filter(Boolean))),
    fullStatGames: games.filter((game) => game.hasFullStats).length,
    statSummary: summarizeTeamStats(games),
    squadSize: squad.length,
    playerTrends: summarizePlayerTrends(games, squad),
  };
}

function emptyTeamForm(team) {
  return {
    team,
    games: [],
    played: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    scoredIn: 0,
    concededIn: 0,
    cleanSheets: 0,
    twoPlusGoals: 0,
    over25MatchGoals: 0,
    avgFor: 0,
    avgAgainst: 0,
    avgTotal: 0,
    avgGoalDiff: 0,
    record: "0-0-0",
    formLine: "",
    sources: [],
    fullStatGames: 0,
    statSummary: {},
    squadSize: 0,
    playerTrends: [],
  };
}

function summarizeTeamStats(games) {
  const definitions = [
    ["totalShots", "Shots"],
    ["shotsOnTarget", "Shots on target"],
    ["wonCorners", "Corners"],
    ["foulsCommitted", "Fouls"],
    ["yellowCards", "Yellow cards"],
    ["offsides", "Offsides"],
    ["possessionPct", "Possession"],
  ];

  return Object.fromEntries(
    definitions.map(([name, label]) => {
      const values = games
        .map((game) => statNumber(game.teamStats, name))
        .filter((value) => Number.isFinite(value));
      return [
        name,
        {
          name,
          label,
          games: values.length,
          values,
          average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        },
      ];
    }),
  );
}

function summarizePlayerTrends(games, squad = []) {
  const players = new Map();

  for (const player of squad) {
    const key = player.id || normalizeTeamName(player.name);
    players.set(key, {
      ...player,
      squadMember: true,
      appearances: 0,
      starts: 0,
      totals: {},
      hits: {},
      recentGames: [],
    });
  }

  for (const game of games) {
    for (const player of game.players || []) {
      const key = player.id || normalizeTeamName(player.name);
      let aggregate = players.get(key);
      if (!aggregate) {
        aggregate = Array.from(players.values()).find(
          (item) => normalizeTeamName(item.name) === normalizeTeamName(player.name),
        );
      }

      if (!aggregate && squad.length) {
        continue;
      }

      if (!aggregate) {
        aggregate = {
          id: player.id,
          name: player.name,
          shortName: player.shortName,
          jersey: "",
          position: player.position,
          positionName: player.positionName,
          squadMember: false,
          appearances: 0,
          starts: 0,
          totals: {},
          hits: {},
          recentGames: [],
        };
        players.set(key, aggregate);
      }

      aggregate.appearances += 1;
      aggregate.starts += player.starter ? 1 : 0;
      if ((!aggregate.position || aggregate.position === "SUB") && player.position !== "SUB") {
        aggregate.position = player.position;
        aggregate.positionName = player.positionName;
      }

      for (const [statName, value] of Object.entries(player.stats || {})) {
        aggregate.totals[statName] = (aggregate.totals[statName] || 0) + value;
        aggregate.hits[statName] = (aggregate.hits[statName] || 0) + (value > 0 ? 1 : 0);
      }
    }
  }

  for (const player of players.values()) {
    player.recentGames = games.map((game) => {
      const appearance = (game.players || []).find(
        (item) =>
          (player.id && item.id && String(player.id) === String(item.id)) ||
          normalizeTeamName(item.name) === normalizeTeamName(player.name),
      );
      return {
        matchId: game.matchId,
        date: game.date,
        opponent: game.opponent,
        played: Boolean(appearance),
        starter: Boolean(appearance?.starter),
        stats: appearance?.stats || {},
      };
    });
  }

  return Array.from(players.values()).sort(
    (a, b) =>
      squadPositionRank(a.position) - squadPositionRank(b.position) ||
      Number(a.jersey || 999) - Number(b.jersey || 999) ||
      a.name.localeCompare(b.name),
  );
}

function statNumber(stats, name) {
  const stat = (stats || []).find((item) => item.name === name);
  return Number.isFinite(stat?.value) ? stat.value : null;
}

function teamResultFromMatch(match, team) {
  const side = teamMatches(team, match.home) ? "home" : teamMatches(team, match.away) ? "away" : "";
  if (!side) {
    return null;
  }

  const opponentSide = side === "home" ? "away" : "home";
  const own = match[side];
  const opponent = match[opponentSide];
  const goalsFor = own.score;
  const goalsAgainst = opponent.score;
  if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) {
    return null;
  }

  return {
    matchId: match.id,
    date: match.date,
    timestamp: match.timestamp,
    competition: match.competition,
    opponent,
    side,
    goalsFor,
    goalsAgainst,
    outcome: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
    source: "ESPN",
  };
}

function teamMatches(source, candidate) {
  if (source.id && candidate.id && String(source.id) === String(candidate.id)) {
    return true;
  }

  const sourceKey = normalizeTeamName(source.name);
  const candidateKey = normalizeTeamName(candidate.name);
  return teamSimilarity(sourceKey, candidateKey) >= 0.9;
}

async function fetchSportsDbRecentGames(team, beforeTimestamp) {
  try {
    const sportsDbTeam = await fetchSportsDbTeam(team);
    if (!sportsDbTeam?.idTeam) {
      return [];
    }

    const cacheKey = sportsDbTeam.idTeam;
    if (!state.sportsDbEventsCache.has(cacheKey)) {
      state.sportsDbEventsCache.set(
        cacheKey,
        fetch(`${SPORTSDB_ROOT}/eventslast.php?id=${encodeURIComponent(cacheKey)}`, {
          headers: { Accept: "application/json" },
        }).then((response) => {
          if (!response.ok) {
            throw new Error(`TheSportsDB returned ${response.status}`);
          }
          return response.json();
        }),
      );
    }

    const payload = await state.sportsDbEventsCache.get(cacheKey);
    return (payload.results || [])
      .map((event) => sportsDbEventToTeamResult(event, team, sportsDbTeam.idTeam))
      .filter((game) => game && game.timestamp < Math.min(beforeTimestamp, Date.now()))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, FORM_SAMPLE_SIZE);
  } catch (error) {
    return [];
  }
}

async function fetchSportsDbTeam(team) {
  const cacheKey = normalizeTeamName(team.name);
  if (state.sportsDbTeamCache.has(cacheKey)) {
    return state.sportsDbTeamCache.get(cacheKey);
  }

  const promise = fetch(`${SPORTSDB_ROOT}/searchteams.php?t=${encodeURIComponent(team.name)}`, {
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`TheSportsDB returned ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => selectSportsDbTeam(team, payload.teams || []))
    .catch(() => null);

  state.sportsDbTeamCache.set(cacheKey, promise);
  return promise;
}

function selectSportsDbTeam(team, teams) {
  const target = normalizeTeamName(team.name);
  return teams
    .filter((item) => item.strSport === "Soccer")
    .map((item) => {
      const names = [item.strTeam, item.strTeamAlternate, item.strTeamShort].filter(Boolean);
      const score = Math.max(...names.map((name) => teamSimilarity(target, normalizeTeamName(name))));
      return { ...item, score };
    })
    .filter((item) => item.score >= 0.78)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function sportsDbEventToTeamResult(event, team, sportsDbTeamId) {
  const homeScore = Number(event.intHomeScore);
  const awayScore = Number(event.intAwayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || event.strStatus !== "FT") {
    return null;
  }

  const isHome =
    String(event.idHomeTeam) === String(sportsDbTeamId) ||
    teamSimilarity(normalizeTeamName(team.name), normalizeTeamName(event.strHomeTeam || "")) >= 0.9;
  const isAway =
    String(event.idAwayTeam) === String(sportsDbTeamId) ||
    teamSimilarity(normalizeTeamName(team.name), normalizeTeamName(event.strAwayTeam || "")) >= 0.9;
  if (!isHome && !isAway) {
    return null;
  }

  const date = parseSportsDbDate(event);
  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;
  const opponentName = isHome ? event.strAwayTeam : event.strHomeTeam;

  return {
    matchId: event.idEvent,
    date,
    timestamp: date.getTime(),
    competition: event.strLeague || "TheSportsDB",
    opponent: {
      id: isHome ? event.idAwayTeam : event.idHomeTeam,
      name: opponentName || "Opponent",
      shortName: opponentName || "Opponent",
      abbreviation: "",
      logo: "",
      score: goalsAgainst,
    },
    side: isHome ? "home" : "away",
    goalsFor,
    goalsAgainst,
    outcome: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
    source: "TheSportsDB",
  };
}

function parseSportsDbDate(event) {
  if (event.strTimestamp) {
    return new Date(`${event.strTimestamp.replace(" ", "T")}Z`);
  }

  return new Date(`${event.dateEvent || ""}T${event.strTime || "00:00:00"}Z`);
}

function mergeTeamGames(primaryGames, fallbackGames) {
  const map = new Map();
  for (const game of [...primaryGames, ...fallbackGames]) {
    const key = [
      localDateKey(game.date),
      normalizeTeamName(game.opponent.name),
      game.goalsFor,
      game.goalsAgainst,
    ].join("|");
    if (!map.has(key)) {
      map.set(key, game);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, FORM_SAMPLE_SIZE);
}

function mapPinnacleMarkets(markets) {
  const map = new Map();

  for (const market of markets || []) {
    if (
      market.type === "moneyline" &&
      market.period === 0 &&
      market.status === "open" &&
      !market.isAlternate
    ) {
      const prices = Object.fromEntries((market.prices || []).map((price) => [price.designation, price.price]));
      if (Number.isFinite(prices.home) && Number.isFinite(prices.away) && Number.isFinite(prices.draw)) {
        map.set(market.matchupId, {
          home: prices.home,
          draw: prices.draw,
          away: prices.away,
          cutoffAt: market.cutoffAt,
          version: market.version,
        });
      }
    }
  }

  return map;
}

function normalizePinnacleMatchups(matchups) {
  return (matchups || [])
    .filter((matchup) => matchup.type === "matchup" && !matchup.isLive && matchup.status === "pending")
    .map((matchup) => {
      const home = matchup.participants?.find((participant) => participant.alignment === "home");
      const away = matchup.participants?.find((participant) => participant.alignment === "away");

      return {
        id: matchup.id,
        startTime: new Date(matchup.startTime),
        timestamp: new Date(matchup.startTime).getTime(),
        league: matchup.league?.name || "",
        home: home?.name || "",
        away: away?.name || "",
        homeKey: normalizeTeamName(home?.name || ""),
        awayKey: normalizeTeamName(away?.name || ""),
      };
    })
    .filter((matchup) => matchup.home && matchup.away && !Number.isNaN(matchup.timestamp));
}

function findPinnacleMatch(match, candidates, marketByMatchupId) {
  const homeKey = normalizeTeamName(match.home.name);
  const awayKey = normalizeTeamName(match.away.name);
  let best = null;

  for (const candidate of candidates) {
    const deltaMinutes = Math.abs(match.timestamp - candidate.timestamp) / 60000;
    if (deltaMinutes > 360) {
      continue;
    }

    const straightScore =
      teamSimilarity(homeKey, candidate.homeKey) + teamSimilarity(awayKey, candidate.awayKey);
    const swappedScore =
      teamSimilarity(homeKey, candidate.awayKey) + teamSimilarity(awayKey, candidate.homeKey);
    const isSwapped = swappedScore > straightScore;
    const teamScore = Math.max(straightScore, swappedScore) / 2;
    const timeScore = Math.max(0, 1 - deltaMinutes / 360);
    const competitionScore = competitionSimilarity(match.competition, candidate.league);
    const score = teamScore * 78 + timeScore * 17 + competitionScore * 5;

    if (teamScore < 0.74 || score < 76) {
      continue;
    }

    if (!best || score > best.score) {
      best = { candidate, score, isSwapped, deltaMinutes };
    }
  }

  if (!best) {
    return null;
  }

  const market = marketByMatchupId.get(best.candidate.id);
  const odds = best.isSwapped
    ? { home: market.away, draw: market.draw, away: market.home }
    : { home: market.home, draw: market.draw, away: market.away };

  return {
    odds: {
      ...odds,
      source: "Pinnacle",
      market: "1X2",
      matchupId: best.candidate.id,
      league: best.candidate.league,
      confidence: Math.round(best.score),
      updatedAt: state.oddsLoadedAt || new Date(),
    },
  };
}

function normalizeTeamName(name) {
  const normalized = String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(women|men|u23|u21|u20|u19|u18|fc|sc|afc|cf|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return TEAM_ALIASES.get(normalized) || normalized;
}

function teamSimilarity(first, second) {
  if (!first || !second) {
    return 0;
  }

  if (first === second) {
    return 1;
  }

  if (first.includes(second) || second.includes(first)) {
    return 0.9;
  }

  return tokenSimilarity(first, second);
}

function competitionSimilarity(first, second) {
  const normalizedFirst = normalizeTeamName(first).replace(/\bfifa\b/g, "").trim();
  const normalizedSecond = normalizeTeamName(second).replace(/\bfifa\b/g, "").trim();
  return tokenSimilarity(normalizedFirst, normalizedSecond);
}

function tokenSimilarity(first, second) {
  const firstTokens = new Set(first.split(" ").filter(Boolean));
  const secondTokens = new Set(second.split(" ").filter(Boolean));
  if (!firstTokens.size || !secondTokens.size) {
    return 0;
  }

  const intersection = Array.from(firstTokens).filter((token) => secondTokens.has(token)).length;
  const union = new Set([...firstTokens, ...secondTokens]).size;
  return intersection / union;
}

function dedupeAndSort(matches) {
  const map = new Map();
  const naturalKeys = new Map();
  for (const match of matches) {
    if (Number.isNaN(match.timestamp)) {
      continue;
    }

    const naturalKey = fixtureIdentity(match);
    if (naturalKeys.has(naturalKey)) {
      mergeFixture(naturalKeys.get(naturalKey), match);
      continue;
    }

    const idKey = match.id || naturalKey;
    if (!map.has(idKey)) {
      map.set(idKey, match);
      naturalKeys.set(naturalKey, match);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function fixtureIdentity(match) {
  return [
    Math.round(match.timestamp / 60000),
    normalizeTeamName(match.home.name),
    normalizeTeamName(match.away.name),
    normalizeTeamName(match.competition),
  ].join("|");
}

function mergeFixture(existing, incoming) {
  if (!existing.eventLink && incoming.eventLink) {
    existing.eventLink = incoming.eventLink;
  }
  if (existing.venueName === "Venue TBA" && incoming.venueName !== "Venue TBA") {
    existing.venueName = incoming.venueName;
  }
  if (!existing.venuePlace && incoming.venuePlace) {
    existing.venuePlace = incoming.venuePlace;
  }
  existing.broadcasts = Array.from(new Set([...existing.broadcasts, ...incoming.broadcasts])).slice(0, 4);
}

function updateCompetitionOptions() {
  const current = state.selectedCompetition;
  const competitions = Array.from(new Set(state.allMatches.map((match) => match.competition))).sort();

  elements.competitionFilter.innerHTML = [
    `<option value="all">All competitions</option>`,
    ...competitions.map((name) => `<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`),
  ].join("");

  if (current !== "all" && competitions.includes(current)) {
    elements.competitionFilter.value = current;
  } else {
    state.selectedCompetition = "all";
    elements.competitionFilter.value = "all";
  }
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();

  state.filteredMatches = state.allMatches.filter((match) => {
    const competitionMatch =
      state.selectedCompetition === "all" || match.competition === state.selectedCompetition;
    const searchMatch =
      !query ||
      [
        match.home.name,
        match.away.name,
        match.competition,
        match.venueName,
        match.venuePlace,
        match.broadcasts.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);

    return competitionMatch && searchMatch;
  });

  render();
}

function render() {
  renderStats();
  renderMessage();
  renderOddsMovements();
  renderFixtures();
}

function renderStats() {
  const next = state.filteredMatches[0] || state.allMatches[0];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
  const todayCount = state.filteredMatches.filter((match) => isSameLocalDay(match.date, new Date())).length;
  const oddsCount = state.filteredMatches.filter((match) => match.odds).length;

  elements.totalMatches.textContent = String(state.filteredMatches.length);
  elements.todayMatches.textContent = String(todayCount);
  elements.oddsMatches.textContent = String(oddsCount);
  elements.nextKickoff.textContent = next ? timeUntil(next.date) : "-";
  elements.timezoneLabel.textContent = timezone.replaceAll("_", " ");
  elements.resultsLabel.textContent = resultLabel();
}

function renderOddsMovements() {
  if (!elements.oddsMovementPanel) {
    return;
  }

  const hasHistory = state.oddsMovements.length > 0;
  const hasOddsStatus = Boolean(state.oddsLoadedAt) || hasHistory;
  if (!hasOddsStatus || (state.oddsFailures.length && !hasHistory)) {
    elements.oddsMovementPanel.hidden = true;
    elements.oddsMovementPanel.innerHTML = "";
    return;
  }

  elements.oddsMovementPanel.hidden = false;

  if (!hasHistory) {
    elements.oddsMovementPanel.innerHTML = `
      <button class="odds-movement-summary is-empty" type="button" disabled>
        <span class="movement-kicker">Pinnacle moves</span>
        <span class="movement-main">
          <strong>No odds changes detected</strong>
          <span>${state.oddsLoadedAt ? `Last checked ${escapeHtml(timeFormatter.format(state.oddsLoadedAt))}` : "Waiting for the first comparison"}</span>
        </span>
      </button>
    `;
    return;
  }

  const latest = state.oddsMovements[0];
  const latestChangeCount = latest.changes.length;
  const fetchChangeCount = state.latestOddsChangeCount;
  const summaryCount =
    fetchChangeCount > 0
      ? `${fetchChangeCount} ${fetchChangeCount === 1 ? "fixture moved" : "fixtures moved"} this check`
      : "No new moves this check";

  elements.oddsMovementPanel.innerHTML = `
    <button
      class="odds-movement-summary"
      id="oddsMovementButton"
      type="button"
      aria-haspopup="dialog"
      aria-label="Open Pinnacle odds change details"
    >
      <span class="movement-kicker">Pinnacle moves</span>
      <span class="movement-main">
        <strong>${escapeHtml(summaryCount)}</strong>
        <span>${escapeHtml(latest.fixture)} · ${latestChangeCount} ${latestChangeCount === 1 ? "price" : "prices"} changed at ${escapeHtml(formatMovementTime(latest.detectedAt))}</span>
      </span>
      <span class="movement-peek">${escapeHtml(formatMovementChangeSummary(latest))}</span>
    </button>
  `;
}

function renderSpotlight() {
  const next = state.filteredMatches[0] || state.allMatches[0];

  if (!next) {
    elements.spotlight.innerHTML = `
      <div class="empty-state spotlight-empty">
        <h3>No upcoming fixtures found</h3>
        <p>Try a wider date range or clear the filters to check the full ESPN soccer scoreboard.</p>
      </div>
    `;
    return;
  }

  elements.spotlight.innerHTML = `
    <div class="spotlight-inner">
      <div class="spotlight-top">
        <span class="match-label">${escapeHtml(next.competition)}</span>
        <div class="kickoff-stack" aria-label="Next match kickoff">
          <span class="kickoff-date">${escapeHtml(dateFormatter.format(next.date))}</span>
          <strong class="kickoff-time">${escapeHtml(timeFormatter.format(next.date))}</strong>
          <span class="countdown">${escapeHtml(timeUntil(next.date))}</span>
        </div>
      </div>
      <div class="teams-display">
        ${renderSpotlightTeam(next.home, "Home")}
        ${renderSpotlightTeam(next.away, "Away")}
      </div>
      ${renderSpotlightOdds(next)}
      <div class="spotlight-meta">
        <span class="meta-chip">${escapeHtml(next.venueName)}</span>
        ${next.venuePlace ? `<span class="meta-chip">${escapeHtml(next.venuePlace)}</span>` : ""}
        ${next.broadcasts.length ? `<span class="meta-chip">${escapeHtml(next.broadcasts.join(", "))}</span>` : ""}
      </div>
    </div>
  `;
}

function renderSpotlightOdds(match) {
  if (!match.odds) {
    return `
      <div class="spotlight-odds is-empty">
        <span>Pinnacle 1X2</span>
        <strong>No line matched</strong>
      </div>
    `;
  }

  return `
    <div class="spotlight-odds">
      <span>Pinnacle 1X2</span>
      <div class="spotlight-odds-grid">
        ${renderOddsCell("1", match.odds.home)}
        ${renderOddsCell("X", match.odds.draw)}
        ${renderOddsCell("2", match.odds.away)}
      </div>
    </div>
  `;
}

function renderSpotlightTeam(team, context) {
  return `
    <div class="spotlight-team">
      ${renderLogo(team, "team-logo")}
      <div>
        <strong class="team-name">${escapeHtml(team.name)}</strong>
        <span class="team-context">${escapeHtml(context)}</span>
      </div>
    </div>
  `;
}

function renderLeagueBreakdown() {
  const counts = new Map();

  for (const match of state.filteredMatches) {
    counts.set(match.competition, (counts.get(match.competition) || 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);

  if (!rows.length) {
    elements.leagueBreakdown.innerHTML = `
      <div class="empty-state">
        <h3>No competitions</h3>
        <p>Clear the filters to restore the schedule.</p>
      </div>
    `;
    return;
  }

  elements.leagueBreakdown.innerHTML = rows
    .map(
      ([name, count]) => `
        <div class="league-row">
          <span>${escapeHtml(name)}</span>
          <strong>${count}</strong>
        </div>
      `,
    )
    .join("");
}

function renderMessage() {
  if (state.failures.length && state.allMatches.length === 0) {
    showMessage("The live fixtures could not be loaded. Check the network connection and try Refresh.");
    return;
  }

  if (state.failures.length) {
    showMessage("Some competitions did not respond, but the live fixture list is still available.");
    return;
  }

  if (state.oddsFailures.length) {
    showMessage("Fixtures loaded, but Pinnacle odds are temporarily unavailable.");
    return;
  }

  clearMessage();
}

function renderFixtures() {
  elements.fixturesList.classList.remove("is-loading");

  if (!state.filteredMatches.length) {
    elements.dateRail.innerHTML = "";
    elements.fixturesList.innerHTML = `
      <div class="empty-state">
        <h3>No matches match these filters</h3>
        <p>Clear the search, choose all competitions, or extend the range to see more fixtures.</p>
      </div>
    `;
    return;
  }

  const groups = groupByDate(state.filteredMatches);

  renderDateRail(groups);

  elements.fixturesList.innerHTML = groups
    .map(
      ({ key, label, matches }) => `
        <div class="date-group" id="date-${escapeAttribute(key)}">
          <div class="date-heading">${escapeHtml(label)}</div>
          ${matches.map(renderFixtureCard).join("")}
        </div>
      `,
    )
    .join("");
}

function renderFixtureCard(match) {
  const isSelected = state.selectedMatchId === match.id;
  const detailLabel = `Open prop board for ${match.home.name} vs ${match.away.name}`;

  return `
    <article
      class="fixture-card ${isSelected ? "is-selected" : ""}"
      data-match-id="${escapeAttribute(match.id)}"
      role="button"
      tabindex="0"
      aria-label="${escapeAttribute(detailLabel)}"
    >
      <div class="time-tile">
        <strong>${escapeHtml(timeFormatter.format(match.date))}</strong>
        <span>${escapeHtml(dateFormatter.format(match.date))}</span>
      </div>
      <div class="fixture-content">
        <div class="fixture-matchup">
          ${renderFixtureTeam(match.home)}
          <span class="versus-inline">vs</span>
          ${renderFixtureTeam(match.away)}
        </div>
        <div class="fixture-tags">
          <span class="fixture-tag">${escapeHtml(match.competition)}</span>
          <span class="fixture-tag">${escapeHtml(match.status)}</span>
        </div>
      </div>
      ${renderFixtureOdds(match)}
      <button class="match-link" type="button" tabindex="-1" aria-hidden="true">&rsaquo;</button>
    </article>
  `;
}

function renderFixtureOdds(match) {
  if (!match.odds) {
    return `
      <div class="odds-strip odds-empty">
        <span>Pinnacle</span>
        <strong>No line</strong>
      </div>
    `;
  }

  return `
    <div class="odds-strip" title="Pinnacle full-match 1X2 moneyline">
      <span>Pinnacle</span>
      <div class="odds-grid">
        ${renderOddsCell("1", match.odds.home)}
        ${renderOddsCell("X", match.odds.draw)}
        ${renderOddsCell("2", match.odds.away)}
      </div>
    </div>
  `;
}

function renderOddsCell(label, value) {
  return `
    <span class="odds-cell">
      <small>${escapeHtml(label)}</small>
      <strong title="American ${escapeAttribute(formatAmericanOdds(value))}">${escapeHtml(formatDecimalOdds(value))}</strong>
    </span>
  `;
}

function openOddsMovementDetails() {
  state.selectedMatchId = null;
  state.activeDrawerRequest = null;
  updateSelectedFixtureCard();
  showDrawer();
  setDrawerHeader("Pinnacle movements", "Odds change log");

  elements.drawerBody.innerHTML = renderResearchSection({
    className: "odds-movement-detail-section",
    ariaLabel: "Pinnacle odds change history",
    eyebrow: "Pinnacle 1X2",
    title: "Recent price changes",
    note: state.oddsMovements.length
      ? `${state.oddsMovements.length} logged ${state.oddsMovements.length === 1 ? "move" : "moves"}`
      : "No changes logged",
    open: true,
    content: state.oddsMovements.length
      ? `<div class="movement-detail-list">${state.oddsMovements.map(renderMovementDetail).join("")}</div>`
      : `<div class="prop-empty"><h3>No odds changes detected</h3><p>The next Pinnacle refresh will be compared with the latest saved prices.</p></div>`,
  });
}

function renderMovementDetail(movement) {
  const kickoff = parseMovementDate(movement.kickoff);
  return `
    <article class="movement-detail-card">
      <div class="movement-detail-top">
        <div>
          <span>${escapeHtml(formatMovementDateTime(movement.detectedAt))}</span>
          <strong>${escapeHtml(movement.fixture || `${movement.home} vs ${movement.away}`)}</strong>
          <small>${escapeHtml(movement.competition || "Pinnacle")} ${
            kickoff ? `· ${escapeHtml(dateFormatter.format(kickoff))} ${escapeHtml(timeFormatter.format(kickoff))}` : ""
          }</small>
        </div>
        <span class="movement-count">${movement.changes.length} ${movement.changes.length === 1 ? "price" : "prices"}</span>
      </div>
      <div class="movement-change-grid">
        ${movement.changes.map(renderMovementChange).join("")}
      </div>
    </article>
  `;
}

function renderMovementChange(change) {
  return `
    <div class="movement-change is-${escapeAttribute(change.direction || "moved")}">
      <span>${escapeHtml(change.label || titleCase(change.designation))}</span>
      <strong>
        ${escapeHtml(formatDecimalOdds(change.previous))}
        <small>${escapeHtml(formatAmericanOdds(change.previous))}</small>
      </strong>
      <b aria-hidden="true">&rarr;</b>
      <strong>
        ${escapeHtml(formatDecimalOdds(change.current))}
        <small>${escapeHtml(formatAmericanOdds(change.current))}</small>
      </strong>
    </div>
  `;
}

async function openMatchDetails(matchId) {
  const match = state.allMatches.find((item) => item.id === matchId);
  if (!match) {
    return;
  }

  const requestId = `${match.id}-${Date.now()}`;
  state.selectedMatchId = match.id;
  state.activeDrawerRequest = requestId;
  updateSelectedFixtureCard();
  showDrawer();
  renderDrawerLoading(match);

  const formPromise = loadMatchFormSafely(match);

  if (!match.odds?.matchupId) {
    const form = await formPromise;
    if (state.activeDrawerRequest === requestId) {
      renderDrawerEmpty(match, "No Pinnacle prop board is available for this fixture yet.", form);
    }
    return;
  }

  try {
    const [payload, form] = await Promise.all([fetchPinnacleMarketsForMatch(match), formPromise]);
    if (state.activeDrawerRequest !== requestId) {
      return;
    }
    const props = buildPropBets(match, payload.markets, form);
    renderDrawerContent(match, payload, props, form);
  } catch (error) {
    if (state.activeDrawerRequest === requestId) {
      const form = await formPromise;
      renderDrawerEmpty(match, error.message || "Pinnacle prop markets could not be loaded.", form);
    }
  }
}

function closeMatchDetails() {
  state.selectedMatchId = null;
  state.activeDrawerRequest = null;
  elements.drawer.hidden = true;
  elements.drawerBackdrop.hidden = true;
  document.body.classList.remove("has-drawer");
  updateSelectedFixtureCard();
}

function showDrawer() {
  elements.drawer.hidden = false;
  elements.drawerBackdrop.hidden = false;
  elements.drawerBody.scrollTop = 0;
  document.body.classList.add("has-drawer");
}

function setDrawerHeader(eyebrow, title) {
  if (elements.drawerEyebrow) {
    elements.drawerEyebrow.textContent = eyebrow;
  }
  elements.drawerTitle.textContent = title;
}

function updateSelectedFixtureCard() {
  elements.fixturesList.querySelectorAll(".fixture-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.matchId === state.selectedMatchId);
  });
}

function renderDrawerLoading(match) {
  setDrawerHeader("Match research", `${match.home.shortName} vs ${match.away.shortName}`);
  elements.drawerBody.innerHTML = `
    ${renderDrawerMatchHeader(match)}
    <div class="drawer-loading">
      <span class="skeleton skeleton-line wide"></span>
      <span class="skeleton skeleton-line"></span>
      <span class="skeleton skeleton-line"></span>
    </div>
  `;
}

function renderResearchSection({
  className = "",
  ariaLabel,
  eyebrow,
  title,
  note = "",
  content,
  open = false,
}) {
  const testId = className.split(" ").find(Boolean) || normalizeTeamName(title);
  return `
    <details
      class="research-section ${escapeAttribute(className)}"
      aria-label="${escapeAttribute(ariaLabel)}"
      data-testid="section-${escapeAttribute(testId)}"
      ${open ? "open" : ""}
    >
      <summary class="research-section-summary">
        <span class="research-section-heading">
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <strong>${escapeHtml(title)}</strong>
        </span>
        ${note ? `<span class="research-section-note">${escapeHtml(note)}</span>` : ""}
      </summary>
      <div class="research-section-body">
        ${content}
      </div>
    </details>
  `;
}

function renderDrawerEmpty(match, message, form = null) {
  const playerProps = form ? buildPlayerTrendProps(match, form).slice(0, 4) : [];
  setDrawerHeader("Match research", `${match.home.shortName} vs ${match.away.shortName}`);
  elements.drawerBody.innerHTML = `
    ${renderDrawerMatchHeader(match)}
    ${renderResearchSection({
      className: "market-status-section",
      ariaLabel: "Market availability",
      eyebrow: "Pinnacle 1X2",
      title: "Prices unavailable",
      note: "Market status",
      open: true,
      content: `
        <div class="prop-empty">
          <h3>Market prices unavailable</h3>
          <p>${escapeHtml(message)}</p>
        </div>
      `,
    })}
    ${
      playerProps.length
        ? renderResearchSection({
            className: "prop-section",
            ariaLabel: "Player prop watchlist",
            eyebrow: "Player watchlist",
            title: "Trends worth pricing",
            note: "These trends are not matched to a live player-prop price.",
            content: `<div class="prop-list">${playerProps.map(renderPropCard).join("")}</div>`,
          })
        : ""
    }
    ${form ? renderFormSummary(form) : ""}
    ${form ? renderDetailedGames(form) : ""}
    ${form ? renderSquadStats(form) : ""}
  `;
}

function renderFairOddsBoard(match, markets, summary, form, loadedAt) {
  const pricing = buildFairMoneyline(match, markets);
  if (!pricing.rows.length) {
    return "";
  }

  return renderResearchSection({
    className: "fair-odds-section",
    ariaLabel: "Pinnacle fair 1X2 probabilities",
    eyebrow: "Pinnacle 1X2",
    title: "Price and fair probability",
    note: `${formatProbability(pricing.overround)} market margin removed`,
    open: true,
    content: `
      <div class="fair-odds-wrap">
        <table class="fair-odds-table">
          <thead>
            <tr>
              <th scope="col">Outcome</th>
              <th scope="col">Pinnacle odds</th>
              <th scope="col">True probability</th>
              <th scope="col">Odds to beat</th>
            </tr>
          </thead>
          <tbody>
            ${pricing.rows
              .map(
                (row) => `
                  <tr>
                    <th scope="row">
                      <span>${escapeHtml(row.label)}</span>
                      <small>${escapeHtml(row.context)}</small>
                    </th>
                    <td data-label="Pinnacle">
                      <strong>${formatDecimalOdds(row.price)}</strong>
                      <small>${escapeHtml(formatAmericanOdds(row.price))}</small>
                    </td>
                    <td data-label="True probability"><strong>${formatProbability(row.fairProbability)}</strong></td>
                    <td data-label="Odds to beat">
                      <strong>&gt; ${row.fairDecimal.toFixed(2)}</strong>
                      <small>Decimal</small>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="fair-odds-footer">
        <p>True probability is Pinnacle's three-way implied probability normalized to 100%. “Odds to beat” is its inverse; a higher available price is required for a positive theoretical edge.</p>
        <p class="research-metadata">
          <span>${summary.openMarkets} open lines</span>
          <span>${form.home.played + form.away.played} recent team-games</span>
          <span>Checked ${escapeHtml(timeFormatter.format(loadedAt))}</span>
        </p>
      </div>
    `,
  });
}

function buildFairMoneyline(match, markets) {
  const market = (markets || []).find(
    (item) =>
      item.type === "moneyline" &&
      item.period === 0 &&
      item.status === "open" &&
      !item.isAlternate,
  );
  const labels = {
    home: { label: match.home.name, context: "Home win" },
    draw: { label: "Draw", context: "Full time" },
    away: { label: match.away.name, context: "Away win" },
  };
  const marketPrices = (market?.prices || [])
    .filter(
      (price) =>
        labels[price.designation] &&
        Number.isFinite(price.price) &&
        americanToProbability(price.price) > 0,
    )
    .map((price) => ({
      designation: price.designation,
      price: price.price,
      impliedProbability: americanToProbability(price.price),
    }));
  const fallbackPrices =
    marketPrices.length === 3 || !match.odds
      ? marketPrices
      : ["home", "draw", "away"]
          .filter((designation) => Number.isFinite(match.odds[designation]))
          .map((designation) => ({
            designation,
            price: match.odds[designation],
            impliedProbability: americanToProbability(match.odds[designation]),
          }));
  const totalProbability = fallbackPrices.reduce(
    (total, price) => total + price.impliedProbability,
    0,
  );

  if (fallbackPrices.length !== 3 || !totalProbability) {
    return { rows: [], overround: 0 };
  }

  return {
    overround: Math.max(0, totalProbability - 1),
    rows: ["home", "draw", "away"].map((designation) => {
      const price = fallbackPrices.find((item) => item.designation === designation);
      const fairProbability = price.impliedProbability / totalProbability;
      return {
        ...labels[designation],
        ...price,
        fairProbability,
        fairDecimal: 1 / fairProbability,
      };
    }),
  };
}

function formatProbability(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function renderDrawerContent(match, payload, props, form) {
  const summary = summarizeMarketBoard(payload.markets);
  setDrawerHeader("Match research", `${match.home.shortName} vs ${match.away.shortName}`);
  elements.drawerBody.innerHTML = `
    ${renderDrawerMatchHeader(match)}
    ${renderFairOddsBoard(match, payload.markets, summary, form, payload.loadedAt)}
    ${renderResearchSection({
      className: "prop-section",
      ariaLabel: "Potential prop bets",
      eyebrow: "Prop shortlist",
      title: "Evidence before opinion",
      note: "A trend only becomes a bet when the available price clears the stated value gate.",
      content: props.length
        ? `<div class="prop-list">${props.map(renderPropCard).join("")}</div>`
        : `<div class="prop-empty"><h3>No clean angle</h3><p>The available line and five-match evidence do not align strongly enough. Passing is a valid decision.</p></div>`,
    })}
    ${renderFormSummary(form)}
    ${renderDetailedGames(form)}
    ${renderSquadStats(form)}
    ${renderPrimaryBoard(match, payload.markets)}
  `;
}

function renderDrawerMatchHeader(match) {
  const venue = [match.venueName, match.venuePlace].filter(Boolean).join(" - ") || "Venue TBA";
  const broadcast = match.broadcasts.length ? match.broadcasts.join(", ") : "Broadcast TBA";

  return renderResearchSection({
    className: "match-overview-section",
    ariaLabel: "Match overview",
    eyebrow: "Fixture",
    title: "Match overview",
    note: `${dateFormatter.format(match.date)} · ${timeFormatter.format(match.date)}`,
    content: `
      <div class="drawer-match-card">
      <div class="drawer-kickoff">
        <span>${escapeHtml(dateFormatter.format(match.date))}</span>
        <strong>${escapeHtml(timeFormatter.format(match.date))}</strong>
      </div>
      <div class="drawer-teams">
        ${renderDrawerTeam(match.home, "Home")}
        ${renderDrawerTeam(match.away, "Away")}
      </div>
      <div class="drawer-meta">
        <span>${escapeHtml(match.competition)}</span>
        <span>${escapeHtml(venue)}</span>
        <span>${escapeHtml(broadcast)}</span>
      </div>
      ${
        match.eventLink
          ? `<a class="drawer-link" href="${escapeAttribute(match.eventLink)}" target="_blank" rel="noreferrer">Match center</a>`
          : ""
      }
      </div>
    `,
  });
}

function renderDrawerTeam(team, label) {
  return `
    <div class="drawer-team">
      ${renderLogo(team, "team-logo small")}
      <div>
        <strong>${escapeHtml(team.name)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
    </div>
  `;
}

function renderFormSummary(form) {
  if (!form) {
    return "";
  }

  return renderResearchSection({
    className: "form-section",
    ariaLabel: "Recent team form",
    eyebrow: "Last five internationals",
    title: "Form at a glance",
    note: form.source || formSourceLabel(form.home, form.away),
    content: `
      <div class="form-summary">
        ${renderTeamFormCard(form.home)}
        ${renderTeamFormCard(form.away)}
        ${form.error ? `<p class="form-error">${escapeHtml(form.error)}</p>` : ""}
      </div>
    `,
  });
}

function renderTeamFormCard(form) {
  const hasGames = form.played > 0;
  return `
    <article class="form-card">
      <div class="form-card-top">
        <span>Last ${form.played || 0}</span>
        <strong>${escapeHtml(form.team.shortName || form.team.name)}</strong>
      </div>
      ${
        hasGames
          ? `
            <div class="form-record">
              <strong>${escapeHtml(form.record)}</strong>
              <span>${form.goalsFor} GF / ${form.goalsAgainst} GA</span>
            </div>
            <div class="form-line">
              <span>${formatStat(form.avgFor)} scored/gm</span>
              <span>${formatStat(form.avgAgainst)} conceded/gm</span>
            </div>
            <div class="result-chips">${form.games.map(renderResultChip).join("")}</div>
            ${renderTeamTrendGrid(form)}
            <small class="form-source">${form.fullStatGames}/${form.played} games with full stats</small>
          `
          : `<p>No completed ESPN or TheSportsDB results found in the lookback window.</p>`
      }
    </article>
  `;
}

function renderTeamTrendGrid(form) {
  const shots = form.statSummary?.totalShots;
  const onTarget = form.statSummary?.shotsOnTarget;
  const corners = form.statSummary?.wonCorners;
  const possession = form.statSummary?.possessionPct;
  const items = [
    ["Scored", `${form.scoredIn}/${form.played}`],
    ["Over 2.5", `${form.over25MatchGoals}/${form.played}`],
    ["Shots avg", formatOptionalAverage(shots)],
    ["SOT avg", formatOptionalAverage(onTarget)],
    ["Corners avg", formatOptionalAverage(corners)],
    ["Possession", formatOptionalAverage(possession, "%")],
  ];

  return `
    <div class="trend-grid">
      ${items
        .map(
          ([label, value]) => `
            <div class="trend-stat">
              <span class="trend-label">${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function formatOptionalAverage(stat, suffix = "") {
  return Number.isFinite(stat?.average) ? `${formatStat(stat.average)}${suffix}` : "-";
}

function renderDetailedGames(form) {
  if (!form?.home?.played && !form?.away?.played) {
    return "";
  }

  return renderResearchSection({
    className: "recent-games-section",
    ariaLabel: "Full last five match statistics",
    eyebrow: "Source matches",
    title: "Every available stat",
    note: "Open a match to inspect the complete ESPN team stat sheet and recorded player lines.",
    content: `
      <div class="games-grid">
        ${renderTeamGames(form.home)}
        ${renderTeamGames(form.away)}
      </div>
    `,
  });
}

function renderTeamGames(form) {
  return `
    <div class="team-games">
      <h4>${escapeHtml(form.team.name)}</h4>
      ${form.games.map((game) => renderGameDetail(form.team, game)).join("")}
    </div>
  `;
}

function renderGameDetail(team, game) {
  return `
    <details class="game-detail">
      <summary>
        <span class="game-date">${escapeHtml(dateFormatter.format(game.date))}</span>
        <span class="game-opponent">${game.side === "away" ? "at" : "vs"} ${escapeHtml(game.opponent.name)}</span>
        <span class="game-score">${escapeHtml(game.outcome)} ${game.goalsFor}-${game.goalsAgainst}</span>
      </summary>
      <div class="game-detail-body">
        ${
          game.hasFullStats
            ? renderStatsTable(team, game)
            : `<p class="section-note">A full stat sheet was not published for this match.</p>`
        }
        ${renderPlayerLines(game.players)}
      </div>
    </details>
  `;
}

function renderStatsTable(team, game) {
  const stats = mergeGameStats(game.teamStats, game.opponentStats);
  return `
    <table class="stat-table">
      <thead>
        <tr>
          <th>Statistic</th>
          <th>${escapeHtml(team.shortName || team.name)}</th>
          <th>${escapeHtml(game.opponent.shortName || game.opponent.name)}</th>
        </tr>
      </thead>
      <tbody>
        ${stats
          .map(
            (stat) => `
              <tr>
                <td>${escapeHtml(stat.label)}</td>
                <td>${escapeHtml(stat.teamValue)}</td>
                <td>${escapeHtml(stat.opponentValue)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function mergeGameStats(teamStats, opponentStats) {
  const opponentByName = new Map((opponentStats || []).map((stat) => [stat.name, stat]));
  const rows = (teamStats || []).map((stat) => ({
    name: stat.name,
    label: stat.label,
    teamValue: stat.displayValue,
    opponentValue: opponentByName.get(stat.name)?.displayValue ?? "-",
  }));
  const teamNames = new Set(rows.map((row) => row.name));

  for (const stat of opponentStats || []) {
    if (!teamNames.has(stat.name)) {
      rows.push({
        name: stat.name,
        label: stat.label,
        teamValue: "-",
        opponentValue: stat.displayValue,
      });
    }
  }

  return rows;
}

function renderPlayerLines(players) {
  if (!players?.length) {
    return "";
  }

  return `
    <div class="player-lines">
      <h5>Recorded player lines</h5>
      ${players
        .map(
          (player) => `
            <div class="player-line">
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(formatPlayerLine(player))}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function formatPlayerLine(player) {
  const labels = {
    totalGoals: "G",
    goalAssists: "A",
    totalShots: "shots",
    shotsOnTarget: "SOT",
    foulsCommitted: "fouls",
    foulsSuffered: "fouled",
    offsides: "offside",
    yellowCards: "YC",
    redCards: "RC",
    saves: "saves",
  };
  const line = Object.entries(labels)
    .filter(([name]) => Number(player.stats?.[name]) > 0)
    .map(([name, label]) => `${player.stats[name]} ${label}`);

  return [player.starter ? "Started" : "Sub", ...line].join(" · ");
}

function renderSquadStats(form) {
  const teams = [form?.home, form?.away].filter((teamForm) => teamForm?.playerTrends?.length);
  if (!teams.length) {
    return "";
  }

  return renderResearchSection({
    className: "squad-section",
    ariaLabel: "World Cup squad player statistics",
    eyebrow: "World Cup squads",
    title: "Player stats: last five",
    note: "Totals cover the five source matches above. A dash in the form strip means the player did not appear.",
    content: `
      <div class="squad-panels">
        ${teams.map(renderSquadTeamTable).join("")}
      </div>
    `,
  });
}

function renderSquadTeamTable(form) {
  const squadCount = form.squadSize || form.playerTrends.length;
  const coverageLabel = form.squadSize ? "World Cup squad" : "Recent participants";

  return `
    <details class="squad-team" data-testid="squad-${escapeAttribute(form.team.id || form.team.name)}">
      <summary>
        <span>
          <strong>${escapeHtml(form.team.name)}</strong>
          <small>${squadCount} players · ${escapeHtml(coverageLabel)}</small>
        </span>
      </summary>
      <div class="squad-table-wrap">
        <table class="squad-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Pos</th>
              <th scope="col">Last five</th>
              <th scope="col" title="Appearances">APP</th>
              <th scope="col" title="Starts">ST</th>
              ${PLAYER_STAT_COLUMNS.map(
                (column) => `<th scope="col" title="${escapeAttribute(column.title)}">${escapeHtml(column.label)}</th>`,
              ).join("")}
            </tr>
          </thead>
          <tbody>
            ${form.playerTrends.map(renderSquadPlayerRow).join("")}
          </tbody>
        </table>
      </div>
      <p class="squad-legend">
        APP appearances · ST starts · SUB substitute appearances · G goals · A assists · SH shots ·
        SOT shots on target · OFF offsides · FC/FS fouls committed/suffered · SV saves · SHF shots faced
      </p>
    </details>
  `;
}

function renderSquadPlayerRow(player) {
  return `
    <tr class="${player.appearances ? "" : "has-no-appearances"}">
      <th scope="row">
        <span class="squad-player">
          <span class="squad-number">${escapeHtml(player.jersey || "–")}</span>
          <span>
            <strong>${escapeHtml(player.name)}</strong>
            <small>${escapeHtml(player.positionName || "Squad player")}</small>
          </span>
        </span>
      </th>
      <td>${escapeHtml(player.position || "–")}</td>
      <td>${renderPlayerAppearanceStrip(player)}</td>
      <td>${player.appearances}</td>
      <td>${player.starts}</td>
      ${PLAYER_STAT_COLUMNS.map(
        (column) => `<td>${formatPlayerTotal(player.totals?.[column.name])}</td>`,
      ).join("")}
    </tr>
  `;
}

function renderPlayerAppearanceStrip(player) {
  return `
    <span class="appearance-strip" aria-label="${escapeAttribute(
      `${player.name}: ${player.appearances} appearances in the last five matches`,
    )}">
      ${(player.recentGames || [])
        .map((game) => {
          const status = game.played ? (game.starter ? "S" : "B") : "–";
          const className = game.played ? (game.starter ? "is-start" : "is-bench") : "is-dnp";
          const detail = game.played ? formatRecentPlayerGame(game) : "Did not appear";
          return `
            <span
              class="appearance-dot ${className}"
              title="${escapeAttribute(
                `${dateFormatter.format(game.date)} vs ${game.opponent.name}: ${detail}`,
              )}"
            >${status}</span>
          `;
        })
        .join("")}
    </span>
  `;
}

function formatRecentPlayerGame(game) {
  const labels = {
    totalGoals: "G",
    goalAssists: "A",
    totalShots: "SH",
    shotsOnTarget: "SOT",
    foulsCommitted: "FC",
    yellowCards: "YC",
    saves: "SV",
  };
  const stats = Object.entries(labels)
    .filter(([name]) => Number(game.stats?.[name]) > 0)
    .map(([name, label]) => `${game.stats[name]} ${label}`);
  return [game.starter ? "Started" : "Sub", ...stats].join(" · ");
}

function formatPlayerTotal(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "0";
}

function renderResultChip(game) {
  return `
    <span class="result-chip is-${game.outcome.toLowerCase()}" title="${escapeAttribute(
      `${longDateFormatter.format(game.date)} vs ${game.opponent.name}: ${game.goalsFor}-${game.goalsAgainst}`,
    )}">
      ${game.outcome} ${game.goalsFor}-${game.goalsAgainst}
    </span>
  `;
}

function formSourceLabel(...forms) {
  const sources = Array.from(new Set(forms.flatMap((form) => form?.sources || [])));
  return sources.length ? sources.join(" + ") : "No recent source";
}

function renderPropCard(prop) {
  return `
    <article class="prop-card">
      <div class="prop-topline">
        <span>${escapeHtml(prop.category)}</span>
        <strong class="prop-strength">${escapeHtml(prop.strength)}</strong>
      </div>
      <h4>${escapeHtml(prop.title)}</h4>
      <div class="prop-pick">
        <span>${escapeHtml(prop.marketLabel)}</span>
        <strong>${escapeHtml(prop.displayOdds)}</strong>
      </div>
      <p>${escapeHtml(prop.rationale)}</p>
      ${
        prop.evidence?.length
          ? `<div class="prop-evidence"><span>Why this made the board</span><ul>${prop.evidence
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul></div>`
          : ""
      }
      ${prop.valueGate ? `<div class="value-gate">${escapeHtml(prop.valueGate)}</div>` : ""}
    </article>
  `;
}

function renderPrimaryBoard(match, markets) {
  const primary = [
    buildPrimaryBoardItem(match, markets, "total", 0),
    buildPrimaryBoardItem(match, markets, "spread", 0),
    buildPrimaryBoardItem(match, markets, "team_total", 0, "home"),
    buildPrimaryBoardItem(match, markets, "team_total", 0, "away"),
  ].filter(Boolean);

  if (!primary.length) {
    return "";
  }

  return renderResearchSection({
    className: "market-board",
    ariaLabel: "Primary market board",
    eyebrow: "Pinnacle board",
    title: "Primary lines",
    note: "Main totals, handicap, and team-total prices.",
    content: `
      <div class="market-board-grid">
        ${primary
          .map(
            (item) => `
              <div class="market-mini">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.line)}</strong>
                <small>${escapeHtml(item.prices)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    `,
  });
}

function buildPrimaryBoardItem(match, markets, type, period, side = "") {
  const market = (markets || []).find(
    (item) =>
      item.type === type &&
      item.period === period &&
      item.status === "open" &&
      !item.isAlternate &&
      (!side || item.side === side),
  );
  if (!market) {
    return null;
  }

  const prices = market.prices || [];
  if (type === "total") {
    const over = prices.find((price) => price.designation === "over");
    const under = prices.find((price) => price.designation === "under");
    return {
      label: "Goals total",
      line: `O/U ${formatPoints(over?.points ?? under?.points)}`,
      prices: `Over ${formatDecimalOdds(over?.price)} | Under ${formatDecimalOdds(under?.price)}`,
    };
  }

  if (type === "spread") {
    const home = prices.find((price) => price.designation === "home");
    const away = prices.find((price) => price.designation === "away");
    return {
      label: "Asian handicap",
      line: `${match.home.shortName} ${formatSignedPoints(home?.points)} / ${match.away.shortName} ${formatSignedPoints(away?.points)}`,
      prices: `${formatDecimalOdds(home?.price)} | ${formatDecimalOdds(away?.price)}`,
    };
  }

  const over = prices.find((price) => price.designation === "over");
  const under = prices.find((price) => price.designation === "under");
  const team = side === "home" ? match.home : match.away;
  return {
    label: `${team.shortName} team total`,
    line: `O/U ${formatPoints(over?.points ?? under?.points)}`,
    prices: `Over ${formatDecimalOdds(over?.price)} | Under ${formatDecimalOdds(under?.price)}`,
  };
}

function buildPropBets(match, markets, form) {
  const openMarkets = (markets || []).filter((market) => market.status === "open" && Array.isArray(market.prices));
  const moneyline = openMarkets.find(
    (market) => market.type === "moneyline" && market.period === 0 && !market.isAlternate,
  );
  const favorite = favoriteFromMoneyline(moneyline);
  const primaryTotal = openMarkets.find(
    (market) => market.type === "total" && market.period === 0 && !market.isAlternate,
  );
  const primaryTotalLean = primaryTotal ? strongestLean(primaryTotal) : null;
  const candidates = [];

  if (primaryTotal && primaryTotalLean) {
    addPropCandidate(candidates, match, primaryTotal, primaryTotalLean.designation, {
      category: "Goals",
      label: "Full match total",
      title: `Full match ${titleCase(primaryTotalLean.designation)} ${formatPoints(primaryTotalLean.points)} goals`,
      rationale: `Primary total at ${formatPoints(primaryTotalLean.points)} with the market leaning ${primaryTotalLean.designation}.`,
      baseScore: 62,
      kind: "match_total",
    }, form);
  }

  const altTotal = bestPricedMarket(
    openMarkets.filter(
      (market) =>
        market.type === "total" &&
        market.period === 0 &&
        market.isAlternate &&
        (!primaryTotalLean || hasDesignation(market, primaryTotalLean.designation)),
    ),
    primaryTotalLean?.designation,
    1.9,
    3.2,
  );
  if (altTotal) {
    addPropCandidate(candidates, match, altTotal.market, altTotal.designation, {
      category: "Alt goals",
      label: "Alternate total",
      title: `Alternate ${titleCase(altTotal.designation)} ${formatPoints(altTotal.points)} goals`,
      rationale: `Alternate goals line keeps the same board direction with a stronger payout profile.`,
      baseScore: 55,
      kind: "match_total",
    }, form);
  }

  const primarySpread = openMarkets.find(
    (market) => market.type === "spread" && market.period === 0 && !market.isAlternate,
  );
  if (primarySpread) {
    const spreadSide = favorite?.designation && hasDesignation(primarySpread, favorite.designation)
      ? favorite.designation
      : strongestLean(primarySpread)?.designation;
    if (spreadSide) {
      const team = spreadSide === "home" ? match.home : match.away;
      const points = priceFor(primarySpread, spreadSide)?.points;
      addPropCandidate(candidates, match, primarySpread, spreadSide, {
        category: "Handicap",
        label: "Asian handicap",
        title: `${team.name} ${formatSignedPoints(points)} handicap`,
        rationale: `${team.shortName} is aligned with the main handicap board at a playable price range.`,
        baseScore: 60,
        kind: "spread",
        side: spreadSide,
      }, form);
    }
  }

  if (favorite?.designation) {
    const favoriteSide = favorite.designation;
    const teamTotal = bestPricedMarket(
      openMarkets.filter(
        (market) => market.type === "team_total" && market.period === 0 && market.side === favoriteSide,
      ),
      "over",
      1.75,
      3.4,
    );
    if (teamTotal) {
      const team = favoriteSide === "home" ? match.home : match.away;
      addPropCandidate(candidates, match, teamTotal.market, teamTotal.designation, {
        category: "Team goals",
        label: `${team.shortName} team total`,
        title: `${team.name} Over ${formatPoints(teamTotal.points)} team goals`,
        rationale: `${team.shortName} is the 1X2 favorite and has an open team-total ladder.`,
        baseScore: 58,
        kind: "team_total",
        side: favoriteSide,
      }, form);
    }

    const underdogSide = favoriteSide === "home" ? "away" : "home";
    const underdogTotal = bestPricedMarket(
      openMarkets.filter(
        (market) => market.type === "team_total" && market.period === 0 && market.side === underdogSide,
      ),
      "under",
      1.65,
      2.7,
    );
    if (underdogTotal) {
      const team = underdogSide === "home" ? match.home : match.away;
      addPropCandidate(candidates, match, underdogTotal.market, underdogTotal.designation, {
        category: "Team goals",
        label: `${team.shortName} team total`,
        title: `${team.name} Under ${formatPoints(underdogTotal.points)} team goals`,
        rationale: `${team.shortName} is priced as the outsider and the team-total board supports a lower scoring angle.`,
        baseScore: 54,
        kind: "team_total",
        side: underdogSide,
      }, form);
    }
  }

  const marketProps = dedupeProps(candidates).sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title),
  );
  const playerProps = buildPlayerTrendProps(match, form);

  return [...marketProps.slice(0, 3), ...playerProps.slice(0, 3)].sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title),
  );
}

function addPropCandidate(candidates, match, market, designation, detail, form) {
  const price = priceFor(market, designation);
  if (!price || !Number.isFinite(price.price)) {
    return;
  }

  if (!isFormAligned(market, designation, detail, form)) {
    return;
  }

  const decimal = americanToDecimal(price.price);
  if (!Number.isFinite(decimal) || decimal < 1.35 || decimal > 4.2) {
    return;
  }

  const score = scorePropSelection(market, designation, detail.baseScore, detail, form);
  const chaseFloor = Math.max(1.4, decimal - 0.08);
  candidates.push({
    key: `${market.key || market.id}-${designation}`,
    category: detail.category,
    title: detail.title,
    marketLabel: `${detail.label} | ${formatAmericanOdds(price.price)}`,
    displayOdds: formatDecimalOdds(price.price),
    rationale: detail.rationale,
    evidence: buildPropEvidence(match, market, designation, detail, form),
    score,
    strength: propStrengthLabel(score, form),
    valueGate: `Current ${formatDecimalOdds(price.price)}. Pass if the price falls below ${chaseFloor.toFixed(2)} or the line moves against the angle.`,
    matchupId: match.odds?.matchupId,
  });
}

function buildPlayerTrendProps(match, form) {
  if (!form) {
    return [];
  }

  const definitions = [
    {
      stat: "shotsOnTarget",
      category: "Player shots",
      market: "1+ shot on target",
      minHits: 4,
      scoreBase: 62,
    },
    {
      stat: "totalShots",
      category: "Player shots",
      market: "1+ shot",
      minHits: 5,
      scoreBase: 56,
    },
    {
      stat: "totalGoals",
      category: "Anytime scorer",
      market: "Anytime scorer",
      minHits: 3,
      scoreBase: 64,
    },
    {
      stat: "foulsCommitted",
      category: "Player fouls",
      market: "1+ foul committed",
      minHits: 4,
      scoreBase: 54,
    },
    {
      stat: "offsides",
      category: "Player offsides",
      market: "1+ offside",
      minHits: 4,
      scoreBase: 52,
    },
  ];
  const candidates = [];

  for (const teamForm of [form.home, form.away]) {
    for (const player of teamForm.playerTrends || []) {
      if (player.appearances < 4) {
        continue;
      }

      for (const definition of definitions) {
        const hits = player.hits[definition.stat] || 0;
        if (hits < definition.minHits || hits / player.appearances < 0.75) {
          continue;
        }

        const total = player.totals[definition.stat] || 0;
        const priceFloor = conservativeTrendPrice(hits, player.appearances);
        const score = Math.round(
          definition.scoreBase +
            (hits / player.appearances) * 18 +
            Math.min(8, player.appearances) +
            Math.min(6, total / player.appearances),
        );

        candidates.push({
          key: `player-${player.id || normalizeTeamName(player.name)}-${definition.stat}`,
          category: definition.category,
          title: `${player.name}: ${definition.market}`,
          marketLabel: `${teamForm.team.shortName || teamForm.team.name} player trend`,
          displayOdds: "Watchlist",
          rationale: `${player.name} recorded this outcome in ${hits} of ${player.appearances} recent international appearances.`,
          evidence: [
            `${hits}/${player.appearances} hit rate across the displayed sample.`,
            `${total} total ${playerStatLabel(definition.stat)}; started ${player.starts}/${player.appearances}.`,
            `This is a player trend, not a matched Pinnacle player price. Confirm selection and role after lineups.`,
          ],
          score,
          strength: score >= 86 ? "Strong trend" : "Worth checking",
          valueGate: `Sample-only gate: consider only at ${priceFloor.toFixed(2)} or better, then adjust for opponent and expected minutes.`,
        });
      }
    }
  }

  return dedupeProps(candidates).sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title),
  );
}

function conservativeTrendPrice(hits, attempts) {
  if (!attempts) {
    return 99;
  }

  const z = 1.28;
  const rate = hits / attempts;
  const denominator = 1 + (z * z) / attempts;
  const centre = rate + (z * z) / (2 * attempts);
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * attempts)) / attempts);
  const lowerBound = Math.max(0.05, (centre - margin) / denominator);
  return Math.min(10, (1 / lowerBound) * 1.05);
}

function playerStatLabel(stat) {
  return (
    {
      shotsOnTarget: "shots on target",
      totalShots: "shots",
      totalGoals: "goals",
      foulsCommitted: "fouls",
      offsides: "offsides",
    }[stat] || stat
  );
}

function propStrengthLabel(score, form) {
  const hasFullSample = form?.home?.played >= 4 && form?.away?.played >= 4;
  if (!hasFullSample) {
    return "Market-led";
  }
  return score >= 78 ? "Market + form" : "Monitor";
}

function isFormAligned(market, designation, detail, form) {
  const selected = priceFor(market, designation);
  if (!form || !selected || form.home.played < 3 || form.away.played < 3) {
    return true;
  }

  if (detail.kind === "match_total" && Number.isFinite(selected.points)) {
    const edge = combinedMatchTotalAverage(form) - selected.points;
    return designation === "over" ? edge >= -0.1 : edge <= 0.1;
  }

  if (detail.kind === "team_total" && Number.isFinite(selected.points)) {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    const edge = teamTotalBlend(sideForm, opponentForm) - selected.points;
    return designation === "over" ? edge >= -0.1 : edge <= 0.1;
  }

  if (detail.kind === "spread" && Number.isFinite(selected.points)) {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    return sideForm.avgGoalDiff - opponentForm.avgGoalDiff + selected.points >= 0;
  }

  return true;
}

function dedupeProps(props) {
  const seen = new Set();
  return props.filter((prop) => {
    if (seen.has(prop.key)) {
      return false;
    }
    seen.add(prop.key);
    return true;
  });
}

function summarizeMarketBoard(markets) {
  const openMarkets = (markets || []).filter((market) => market.status === "open");
  const propTypes = new Set(openMarkets.filter((market) => market.type !== "moneyline").map((market) => market.type));
  return {
    openMarkets: openMarkets.length,
    propTypes: propTypes.size,
  };
}

function favoriteFromMoneyline(market) {
  if (!market?.prices?.length) {
    return null;
  }

  return market.prices
    .filter((price) => ["home", "away"].includes(price.designation) && Number.isFinite(price.price))
    .map((price) => ({ ...price, probability: americanToProbability(price.price) }))
    .sort((a, b) => b.probability - a.probability)[0] || null;
}

function strongestLean(market) {
  const normalized = normalizedMarketPrices(market);
  return normalized.sort((a, b) => b.normalizedProbability - a.normalizedProbability)[0] || null;
}

function normalizedMarketPrices(market) {
  const prices = (market.prices || [])
    .filter((price) => Number.isFinite(price.price))
    .map((price) => ({
      ...price,
      probability: americanToProbability(price.price),
      normalizedProbability: 0,
    }));
  const totalProbability = prices.reduce((sum, price) => sum + price.probability, 0);
  return prices.map((price) => ({
    ...price,
    normalizedProbability: totalProbability ? price.probability / totalProbability : 0,
  }));
}

function bestPricedMarket(markets, preferredDesignation, minDecimal, maxDecimal) {
  const candidates = [];
  for (const market of markets) {
    for (const price of market.prices || []) {
      if (preferredDesignation && price.designation !== preferredDesignation) {
        continue;
      }
      const decimal = americanToDecimal(price.price);
      if (decimal >= minDecimal && decimal <= maxDecimal) {
        candidates.push({
          market,
          designation: price.designation,
          points: price.points,
          price: price.price,
          distance: Math.abs(decimal - 2.15),
        });
      }
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance || Math.abs(a.points || 0) - Math.abs(b.points || 0))[0];
}

function priceFor(market, designation) {
  return (market.prices || []).find((price) => price.designation === designation);
}

function hasDesignation(market, designation) {
  return Boolean(priceFor(market, designation));
}

function buildPropEvidence(match, market, designation, detail, form) {
  const selected = priceFor(market, designation);
  const line = Number.isFinite(selected?.points) ? formatPoints(selected.points) : "market";
  const evidence = [
    `Pinnacle line: ${detail.label} ${titleCase(designation)} ${line} at ${formatDecimalOdds(selected?.price)} (${formatAmericanOdds(selected?.price)}).`,
  ];

  if (!form || (!form.home.played && !form.away.played)) {
    evidence.push("Recent completed-results sample is thin for these teams, so this relies mostly on the live Pinnacle board.");
    return evidence;
  }

  evidence.push(`Recent form source: ${formSourceLabel(form.home, form.away)}.`);

  if (detail.kind === "match_total") {
    const combinedAverage = combinedMatchTotalAverage(form);
    evidence.push(
      `${match.home.shortName} last ${form.home.played}: ${form.home.goalsFor} GF / ${form.home.goalsAgainst} GA (${formatStat(
        form.home.avgTotal,
      )} total goals/gm).`,
    );
    evidence.push(
      `${match.away.shortName} last ${form.away.played}: ${form.away.goalsFor} GF / ${form.away.goalsAgainst} GA (${formatStat(
        form.away.avgTotal,
      )} total goals/gm).`,
    );
    if (Number.isFinite(selected?.points)) {
      evidence.push(`Combined recent match total average is ${formatStat(combinedAverage)} vs a Pinnacle line of ${line}.`);
    }
    return evidence;
  }

  if (detail.kind === "team_total") {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    evidence.push(
      `${sideForm.team.shortName} scored ${sideForm.goalsFor} in last ${sideForm.played} (${formatStat(
        sideForm.avgFor,
      )}/gm) and scored in ${sideForm.scoredIn}/${sideForm.played}.`,
    );
    evidence.push(
      `${opponentForm.team.shortName} conceded ${opponentForm.goalsAgainst} in last ${opponentForm.played} (${formatStat(
        opponentForm.avgAgainst,
      )}/gm), with ${opponentForm.cleanSheets}/${opponentForm.played} clean sheets.`,
    );
    if (Number.isFinite(selected?.points)) {
      evidence.push(`Team-total line is ${line}; recent attack/defence blend projects ${formatStat(teamTotalBlend(sideForm, opponentForm))}.`);
    }
    return evidence;
  }

  if (detail.kind === "spread") {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    evidence.push(
      `${sideForm.team.shortName} last ${sideForm.played}: ${sideForm.record} record, ${formatSignedStat(sideForm.avgGoalDiff)} goal diff/gm.`,
    );
    evidence.push(
      `${opponentForm.team.shortName} last ${opponentForm.played}: ${opponentForm.record} record, ${formatSignedStat(
        opponentForm.avgGoalDiff,
      )} goal diff/gm.`,
    );
    evidence.push(`Form gap is ${formatSignedStat(sideForm.avgGoalDiff - opponentForm.avgGoalDiff)} goals/gm against a ${formatSignedPoints(selected?.points)} handicap.`);
  }

  return evidence;
}

function scorePropSelection(market, designation, baseScore, detail = {}, form = null) {
  const selected = priceFor(market, designation);
  const normalized = normalizedMarketPrices(market).find((price) => price.designation === designation);
  const decimal = americanToDecimal(selected?.price);
  const priceQuality = Number.isFinite(decimal) ? Math.max(0, 18 - Math.abs(decimal - 1.95) * 9) : 0;
  const primaryScore = market.isAlternate ? 2 : 10;
  const periodScore = market.period === 0 ? 6 : 2;
  const leanScore = normalized ? Math.min(10, Math.abs(normalized.normalizedProbability - 0.5) * 42) : 0;
  const formScore = scoreFormSupport(market, designation, detail, form);
  return Math.max(50, Math.min(98, Math.round(baseScore + priceQuality + primaryScore + periodScore + leanScore + formScore)));
}

function scoreFormSupport(market, designation, detail, form) {
  const selected = priceFor(market, designation);
  if (!form || !selected || (!form.home.played && !form.away.played)) {
    return 0;
  }

  if (detail.kind === "match_total" && Number.isFinite(selected.points)) {
    const delta = combinedMatchTotalAverage(form) - selected.points;
    return designation === "over" ? clamp(delta * 5, -8, 10) : clamp(-delta * 5, -8, 10);
  }

  if (detail.kind === "team_total" && Number.isFinite(selected.points)) {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    const delta = teamTotalBlend(sideForm, opponentForm) - selected.points;
    return designation === "over" ? clamp(delta * 6, -8, 10) : clamp(-delta * 6, -8, 10);
  }

  if (detail.kind === "spread") {
    const sideForm = detail.side === "home" ? form.home : form.away;
    const opponentForm = detail.side === "home" ? form.away : form.home;
    return clamp((sideForm.avgGoalDiff - opponentForm.avgGoalDiff) * 4, -8, 10);
  }

  return 0;
}

function combinedMatchTotalAverage(form) {
  const totals = [form.home, form.away].filter((item) => item.played > 0).map((item) => item.avgTotal);
  if (!totals.length) {
    return 0;
  }

  return totals.reduce((sum, value) => sum + value, 0) / totals.length;
}

function teamTotalBlend(teamForm, opponentForm) {
  const values = [];
  if (teamForm.played) {
    values.push(teamForm.avgFor);
  }
  if (opponentForm.played) {
    values.push(opponentForm.avgAgainst);
  }

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderFixtureTeam(team) {
  return `
    <div class="fixture-team-row">
      ${renderLogo(team, "team-logo small")}
      <strong>${escapeHtml(team.name)}</strong>
      <span class="team-abbr">${escapeHtml(team.abbreviation)}</span>
    </div>
  `;
}

function renderLogo(team, className) {
  if (team.logo) {
    return `
      <span class="${className}">
        <img src="${escapeAttribute(team.logo)}" alt="" loading="lazy" />
      </span>
    `;
  }

  return `<span class="${className} placeholder">${escapeHtml((team.abbreviation || team.name).slice(0, 3))}</span>`;
}

function renderDateRail(groups) {
  elements.dateRail.innerHTML = groups
    .map(
      ({ key, date, matches }, index) => `
        <button class="date-button ${index === 0 ? "is-active" : ""}" type="button" data-target="date-${escapeAttribute(key)}">
          <strong>${escapeHtml(shortDayLabel(date))}</strong>
          <span>${matches.length} ${matches.length === 1 ? "match" : "matches"}</span>
        </button>
      `,
    )
    .join("");
}

function groupByDate(matches) {
  const grouped = new Map();
  for (const match of matches) {
    const key = localDateKey(match.date);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        date: match.date,
        label: longDateFormatter.format(match.date),
        matches: [],
      });
    }
    grouped.get(key).matches.push(match);
  }
  return Array.from(grouped.values());
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDayLabel(date) {
  return dateFormatter.format(date).replace(",", "");
}

function isSameLocalDay(first, second) {
  return localDateKey(first) === localDateKey(second);
}

function resultLabel() {
  if (!state.loadedAt) {
    return "Loading fixtures";
  }

  const count = state.filteredMatches.length;
  const matchWord = count === 1 ? "match" : "matches";
  const oddsCount = state.filteredMatches.filter((match) => match.odds).length;
  return `${count} ${matchWord} | ${oddsCount} with Pinnacle | ${timeFormatter.format(state.loadedAt)}`;
}

function timeUntil(date) {
  const diffMs = date.getTime() - Date.now();

  if (diffMs <= 0) {
    return "Kickoff window";
  }

  const totalMinutes = Math.round(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatMovementTime(value) {
  const date = parseMovementDate(value);
  return date ? timeFormatter.format(date) : "-";
}

function formatMovementDateTime(value) {
  const date = parseMovementDate(value);
  return date ? `${dateFormatter.format(date)} ${timeFormatter.format(date)}` : "-";
}

function parseMovementDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMovementChangeSummary(movement) {
  const change = movement?.changes?.[0];
  if (!change) {
    return "Open log";
  }

  const extra = movement.changes.length > 1 ? ` +${movement.changes.length - 1}` : "";
  return `${change.label}: ${formatDecimalOdds(change.previous)} to ${formatDecimalOdds(change.current)}${extra}`;
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.classList.toggle("is-loading", isLoading);
  elements.syncPill.classList.toggle("is-loading", isLoading);
  elements.syncPill.classList.remove("is-error");
  elements.syncText.textContent = isLoading ? "Refreshing live fixtures" : "Live data synced";
}

function setOddsLoading(isLoading, hasError = false) {
  elements.oddsPill.classList.toggle("is-loading", isLoading);
  elements.oddsPill.classList.toggle("is-error", hasError);

  if (isLoading) {
    elements.oddsText.textContent = "Matching lines";
    return;
  }

  if (hasError) {
    elements.oddsText.textContent = "Unavailable";
    return;
  }

  elements.oddsText.textContent = `${state.oddsCoverage} matched`;
}

function showError(error) {
  elements.syncPill.classList.remove("is-loading");
  elements.syncPill.classList.add("is-error");
  elements.syncText.textContent = "Live data unavailable";
  showMessage(error.message || "The live fixture API could not be reached.");
}

function showMessage(message) {
  elements.stateMessage.hidden = false;
  elements.stateMessage.textContent = message;
}

function clearMessage() {
  elements.stateMessage.hidden = true;
  elements.stateMessage.textContent = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatAmericanOdds(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value > 0 ? `+${value}` : String(value);
}

function formatDecimalOdds(value) {
  const decimal = americanToDecimal(value);
  if (!Number.isFinite(decimal)) {
    return "-";
  }

  return decimal.toFixed(2);
}

function americanToDecimal(value) {
  if (!Number.isFinite(value) || value === 0) {
    return NaN;
  }

  return value > 0 ? value / 100 + 1 : 100 / Math.abs(value) + 1;
}

function americanToProbability(value) {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }

  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

function formatPoints(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
}

function formatSignedPoints(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value > 0 ? `+${formatPoints(value)}` : formatPoints(value);
}

function formatStat(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(2);
}

function formatSignedStat(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value > 0 ? `+${formatStat(value)}` : formatStat(value);
}

function titleCase(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}

async function refreshFixtures() {
  try {
    await loadFixtures();
  } catch (error) {
    setLoading(false);
    showError(error);
  }
}

elements.refreshButton.addEventListener("click", refreshFixtures);

elements.oddsMovementPanel?.addEventListener("click", (event) => {
  const button = event.target.closest("#oddsMovementButton");
  if (!button || button.disabled) {
    return;
  }

  openOddsMovementDetails();
});

elements.fixturesList.addEventListener("click", (event) => {
  const card = event.target.closest(".fixture-card[data-match-id]");
  if (!card || card.classList.contains("skeleton-card")) {
    return;
  }

  openMatchDetails(card.dataset.matchId);
});

elements.fixturesList.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) {
    return;
  }

  const card = event.target.closest(".fixture-card[data-match-id]");
  if (!card || card.classList.contains("skeleton-card")) {
    return;
  }

  event.preventDefault();
  openMatchDetails(card.dataset.matchId);
});

elements.drawerClose.addEventListener("click", closeMatchDetails);
elements.drawerBackdrop.addEventListener("click", closeMatchDetails);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.drawer.hidden) {
    closeMatchDetails();
  }
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  applyFilters();
});

elements.competitionFilter.addEventListener("change", (event) => {
  state.selectedCompetition = event.target.value;
  applyFilters();
});

elements.rangeOptions.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.classList.contains("is-active")) {
      return;
    }

    state.rangeDays = Number(button.dataset.range);
    elements.rangeOptions.forEach((option) => option.classList.toggle("is-active", option === button));
    refreshFixtures();
  });
});

elements.dateRail.addEventListener("click", (event) => {
  const button = event.target.closest(".date-button");
  if (!button) {
    return;
  }

  const target = document.getElementById(button.dataset.target);
  if (!target) {
    return;
  }

  elements.dateRail
    .querySelectorAll(".date-button")
    .forEach((item) => item.classList.toggle("is-active", item === button));
  target.scrollIntoView({ behavior: "smooth", block: "start" });
});

function startClock() {
  if (state.timer) {
    clearInterval(state.timer);
  }

  state.timer = setInterval(() => {
    if (state.allMatches.length) {
      renderStats();
    }
  }, 30000);
}

elements.timezoneLabel.textContent = (Intl.DateTimeFormat().resolvedOptions().timeZone || "Local").replaceAll(
  "_",
  " ",
);

refreshFixtures();
startClock();
