const PINNACLE_ROOT = "https://guest.api.arcadia.pinnacle.com/0.1";
const DEFAULT_SOCCER_ID = 29;
const SNAPSHOT_KEY = "odds:snapshot:v1";
const MOVEMENTS_KEY = "odds:movements:v1";
const MAX_MOVEMENTS = 80;
const ODDS_FIELDS = ["home", "draw", "away"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/health") {
        return jsonResponse({ ok: true }, cors);
      }

      if (url.pathname === "/board") {
        return handleBoard(url, env, cors);
      }

      if (url.pathname === "/movements") {
        const movements = await readJson(env, MOVEMENTS_KEY, []);
        return jsonResponse({ movements: normalizeMovements(movements) }, cors);
      }

      if (url.pathname.startsWith("/pinnacle/")) {
        return proxyPinnacle(url, env, cors);
      }

      return jsonResponse({ error: "Not found" }, cors, 404);
    } catch (error) {
      return jsonResponse(
        { error: error?.message || "The Pinnacle worker could not complete the request." },
        cors,
        500,
      );
    }
  },
};

async function handleBoard(url, env, cors) {
  const sportId = Number(url.searchParams.get("sportId")) || DEFAULT_SOCCER_ID;
  const [matchups, markets] = await Promise.all([
    fetchPinnacle(env, `/sports/${sportId}/matchups?withSpecials=false`),
    fetchPinnacle(env, `/sports/${sportId}/markets/straight?primaryOnly=true&withSpecials=false`),
  ]);
  const loadedAt = new Date().toISOString();
  const newMovements = await recordMovements(env, matchups, markets, loadedAt);
  const movements = await readJson(env, MOVEMENTS_KEY, []);

  return jsonResponse(
    {
      matchups: Array.isArray(matchups) ? matchups : [],
      markets: Array.isArray(markets) ? markets : [],
      movements: normalizeMovements(movements),
      latestChangeCount: newMovements.length,
      loadedAt,
    },
    cors,
  );
}

async function proxyPinnacle(url, env, cors) {
  const path = `${url.pathname.slice("/pinnacle".length)}${url.search}`;
  const payload = await fetchPinnacle(env, path);
  return jsonResponse(payload, cors);
}

async function fetchPinnacle(env, path) {
  if (!env.PINNACLE_API_KEY) {
    throw new Error("PINNACLE_API_KEY is not set on the Worker.");
  }

  const response = await fetch(`${PINNACLE_ROOT}${path}`, {
    headers: {
      Accept: "application/json",
      "X-API-Key": env.PINNACLE_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Pinnacle returned ${response.status}`);
  }

  return response.json();
}

async function recordMovements(env, matchups, markets, detectedAt) {
  const previousSnapshot = await readJson(env, SNAPSHOT_KEY, {});
  const currentSnapshot = buildSnapshot(matchups, markets);
  const mergedSnapshot = { ...previousSnapshot };
  const movements = [];
  let snapshotChanged = false;

  for (const [key, current] of Object.entries(currentSnapshot)) {
    const previous = previousSnapshot[key];
    const changes = buildChanges(previous, current);

    if (!previous || !sameOdds(previous.odds, current.odds)) {
      mergedSnapshot[key] = current;
      snapshotChanged = true;
    }

    if (changes.length) {
      movements.push({
        id: `${key}-${Date.parse(detectedAt)}-${changes.map((change) => change.designation).join("-")}`,
        matchupId: key,
        detectedAt,
        fixture: current.fixture,
        home: current.home,
        away: current.away,
        competition: current.competition,
        kickoff: current.kickoff,
        changes,
      });
    }
  }

  const prunedSnapshot = pruneSnapshot(mergedSnapshot, Date.parse(detectedAt));
  if (snapshotChanged || Object.keys(prunedSnapshot).length !== Object.keys(mergedSnapshot).length) {
    await writeJson(env, SNAPSHOT_KEY, prunedSnapshot);
  }

  if (movements.length) {
    const existingMovements = await readJson(env, MOVEMENTS_KEY, []);
    const nextMovements = normalizeMovements([...movements, ...existingMovements]).slice(0, MAX_MOVEMENTS);
    await writeJson(env, MOVEMENTS_KEY, nextMovements);
  }

  return movements;
}

function buildSnapshot(matchups, markets) {
  const matchupById = new Map(
    (matchups || [])
      .filter((matchup) => matchup?.type === "matchup" && !matchup.isLive && matchup.status === "pending")
      .map((matchup) => [String(matchup.id), matchup]),
  );
  const snapshot = {};

  for (const market of markets || []) {
    if (
      market?.type !== "moneyline" ||
      market.period !== 0 ||
      market.status !== "open" ||
      market.isAlternate
    ) {
      continue;
    }

    const matchupId = String(market.matchupId || "");
    const matchup = matchupById.get(matchupId);
    const prices = Object.fromEntries((market.prices || []).map((price) => [price.designation, price.price]));

    if (!matchup || !ODDS_FIELDS.every((field) => Number.isFinite(Number(prices[field])))) {
      continue;
    }

    const home = matchup.participants?.find((participant) => participant.alignment === "home")?.name || "Home";
    const away = matchup.participants?.find((participant) => participant.alignment === "away")?.name || "Away";
    snapshot[matchupId] = {
      matchupId,
      fixture: `${home} vs ${away}`,
      home,
      away,
      competition: matchup.league?.name || "Pinnacle",
      kickoff: matchup.startTime || "",
      odds: Object.fromEntries(ODDS_FIELDS.map((field) => [field, Number(prices[field])])),
    };
  }

  return snapshot;
}

function buildChanges(previous, current) {
  if (!previous?.odds) {
    return [];
  }

  return ODDS_FIELDS.map((designation) => {
    const previousValue = Number(previous.odds[designation]);
    const currentValue = Number(current.odds[designation]);

    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue) || previousValue === currentValue) {
      return null;
    }

    return {
      designation,
      label: oddsLabel(designation, current),
      previous: previousValue,
      current: currentValue,
      direction: oddsMoveDirection(previousValue, currentValue),
    };
  }).filter(Boolean);
}

function oddsLabel(designation, snapshot) {
  if (designation === "home") {
    return snapshot.home;
  }
  if (designation === "away") {
    return snapshot.away;
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

function americanToDecimal(value) {
  if (!Number.isFinite(value) || value === 0) {
    return NaN;
  }

  return value > 0 ? value / 100 + 1 : 100 / Math.abs(value) + 1;
}

function sameOdds(first = {}, second = {}) {
  return ODDS_FIELDS.every((field) => Number(first[field]) === Number(second[field]));
}

function pruneSnapshot(snapshot, nowMs) {
  const cutoff = nowMs - 45 * 24 * 60 * 60 * 1000;
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, entry]) => {
      const kickoff = Date.parse(entry?.kickoff || "");
      return Number.isFinite(kickoff) ? kickoff >= cutoff : true;
    }),
  );
}

function normalizeMovements(movements) {
  return (Array.isArray(movements) ? movements : [])
    .filter((movement) => movement?.detectedAt && Array.isArray(movement.changes))
    .sort(compareMovements)
    .slice(0, MAX_MOVEMENTS);
}

function compareMovements(first, second) {
  const detectedDelta = dateMs(second.detectedAt) - dateMs(first.detectedAt);
  if (detectedDelta) {
    return detectedDelta;
  }
  return dateMs(first.kickoff) - dateMs(second.kickoff);
}

function dateMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

async function readJson(env, key, fallback) {
  const value = await env.PINNACLE_ODDS_KV.get(key, "json");
  return value ?? fallback;
}

async function writeJson(env, key, value) {
  await env.PINNACLE_ODDS_KV.put(key, JSON.stringify(value));
}

function corsHeaders(request, env) {
  const configuredOrigin = String(env.ALLOWED_ORIGIN || "").trim();
  const requestOrigin = request.headers.get("Origin");
  const allowOrigin = configuredOrigin || requestOrigin || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(payload, cors, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
