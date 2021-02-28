import 'log-timestamp';
import { EventSource } from 'launchdarkly-eventsource';
import manakin from 'manakin';
import { dynamic as setIntervalAsyncDynamic } from 'set-interval-async';
import { BASE_URL, fetchJson } from './util.js';
import {
  cache, writeEntry, writeResponse, writeResponses,
} from './writer.js';

const { local: console } = manakin;
const { setIntervalAsync } = setIntervalAsyncDynamic;

const ENDPOINT_STREAM = '/events/streamData';
const ENDPOINT_PLAYERS = '/database/players';

let streamData;
let resolveStreamData;
const streamDataReady = new Promise((resolve) => {
  resolveStreamData = resolve;
});

// set up event source logging
const source = new EventSource(`${BASE_URL}${ENDPOINT_STREAM}`, {
  initialRetryDelayMillis: 2000,
  maxBackoffMillis: 5000,
  errorFilter: function errorFilter() {
    return true;
  },
});
source.on('open', () => {
  console.info(`listening on ${ENDPOINT_STREAM}`);
});
source.on('message', (event) => {
  streamData = JSON.parse(event.data);
  writeEntry({
    endpoint: ENDPOINT_STREAM,
    id: null,
    data: streamData,
  });
  if (resolveStreamData !== undefined) {
    resolveStreamData();
    resolveStreamData = undefined;
  }
});
source.on('error', (err) => {
  console.error(err);
});

function logSingle(endpoint) {
  return async () => writeResponse(await fetchJson(endpoint));
}

async function logPlayers() {
  await streamDataReady;
  let teams = streamData?.value?.leagues?.teams;
  if (teams === undefined) {
    console.warn('teams not found in stream data, fetching instead');
    teams = (await fetchJson('/database/allTeams')).body;
  }
  writeResponses(await fetchJson(ENDPOINT_PLAYERS, [...new Set([
    ...Object.keys(cache[ENDPOINT_PLAYERS] ?? {}),
    ...teams.flatMap((team) => team.lineup),
    ...teams.flatMap((team) => team.rotation),
    ...teams.flatMap((team) => team.bullpen),
    ...teams.flatMap((team) => team.bench),
  ])]));
}

async function logGameStatsheets() {
  await streamDataReady;
  const games = streamData?.value?.games?.schedule;
  if (games === undefined) {
    console.error('schedule not found in stream data');
    return;
  }

  const gameStatsheets = writeResponses(await fetchJson('/database/gameStatsheets',
    games.map((game) => game.statsheet)));
  const teamStatsheets = writeResponses(await fetchJson('/database/teamStatsheets',
    gameStatsheets.flatMap((sheet) => [sheet.awayTeamStats, sheet.homeTeamStats])));
  writeResponses(await fetchJson('/database/playerStatsheets',
    teamStatsheets.flatMap((sheet) => sheet.playerStats)));
}

async function logSeasonStatsheet() {
  await streamDataReady;
  const season = streamData?.value?.games?.season;
  if (season === undefined) {
    console.error('season not found in stream data');
    return;
  }

  writeResponses(await fetchJson('/database/seasonStatsheets', [season.stats]));
}

async function logOffseasonRecap() {
  await streamDataReady;
  const season = streamData?.value?.games?.season?.seasonNumber;
  if (season === undefined) {
    console.error('season number not found in stream data');
    return;
  }

  const recap = writeResponse((await fetchJson('/database/offseasonRecap', [season], 'season'))[0]);
  await Promise.all(['bonusResults', 'decreeResults', 'eventResults'].map((key) => fetchJson(`/database/${key}`, recap[key]).then(writeResponses)));
}

async function metalog() {
  return Promise.all([
    logPlayers,
    logGameStatsheets,
    logSeasonStatsheet,
    logOffseasonRecap,
    logSingle('/api/getIdols'),
    logSingle('/api/getTribute'),
    logSingle('/database/globalEvents'),
    logSingle('/database/offseasonSetup'),
  ].map((p) => p().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })));
}

// all other logging, per-minute:
setIntervalAsync(metalog, 60 * 1000);
metalog().then(() => {});
