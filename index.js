import 'log-timestamp';
import 'dotenv/config.js';
import { EventSource } from 'launchdarkly-eventsource';
import manakin from 'manakin';
import { dynamic as setIntervalAsyncDynamic } from 'set-interval-async';
import { BASE_URL, fetch, fetchIds } from './util.js';
import {
  writeEntry, write, writeList, flatWriteList,
} from './writer.js';

const { local: console } = manakin;
const { setIntervalAsync } = setIntervalAsyncDynamic;

const ENDPOINT_STREAM = '/events/streamData';

let streamData;
let resolveStreamData;
const streamDataReady = new Promise((resolve) => {
  resolveStreamData = resolve;
});

const knownPlayers = fetch('https://api.sibr.dev/chronicler/v1/players/names')
  .then((res) => {
    const set = new Set(Object.keys(res.body));
    set.delete('bc4187fa-459a-4c06-bbf2-4e0e013d27ce'); // Everybody do the wave lol 🌊
    console.info(`loaded ${set.size} player IDs from chronicler`);
    return set;
  })
  .catch((err) => {
    console.error(err);
    return new Set();
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

async function allTeams() {
  await streamDataReady;
  const teams = streamData?.value?.leagues?.teams;
  if (teams === undefined) {
    console.warn('teams not found in stream data, fetching instead');
    return (await fetch('/database/allTeams')).body;
  }
  return teams;
}

function logSingle(url, query) {
  return async () => { await fetch(url, query).then(write); };
}

async function logPlayers() {
  const players = await knownPlayers;
  (await allTeams())
    .flatMap((team) => [team.lineup, team.rotation, team.bullpen, team.bench].flat())
    .forEach((id) => players.add(id));
  await fetchIds('/database/players', [...players]).then(flatWriteList);
}

async function logGameStatsheets() {
  await streamDataReady;
  const games = streamData?.value?.games?.schedule;
  if (games === undefined) {
    throw new Error('schedule not found in stream data');
  }

  const gameStatsheets = await fetchIds('/database/gameStatsheets', games.map((game) => game.statsheet))
    .then(flatWriteList);
  const teamStatsheets = await fetchIds('/database/teamStatsheets', gameStatsheets.flatMap((sheet) => [sheet.awayTeamStats, sheet.homeTeamStats]))
    .then(flatWriteList);
  await fetchIds('/database/playerStatsheets', teamStatsheets.flatMap((sheet) => sheet.playerStats))
    .then(flatWriteList);
}

async function logSeasonStatsheet() {
  await streamDataReady;
  const season = streamData?.value?.games?.season;
  if (season === undefined) {
    throw new Error('season not found in stream data');
  }

  await fetchIds('/database/seasonStatsheets', [season.stats]).then(flatWriteList);
}

async function logOffseasonRecap() {
  await streamDataReady;
  const season = streamData?.value?.games?.season?.seasonNumber;
  if (season === undefined) {
    throw new Error('season number not found in stream data');
  }

  const recap = await fetch('/database/offseasonRecap', { season }).then(write);
  if (recap !== undefined) {
    await Promise.all(['bonusResults', 'decreeResults', 'eventResults']
      .filter((key) => recap[key] !== undefined)
      .map((key) => fetchIds(`/database/${key}`, recap[key]).then(flatWriteList)));
  }
}

async function logFeed() {
  // fetch the last 10 minutes every 5 minutes. simple!
  const start = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await fetch('/database/feed/global', { start, sort: 1 }).then(writeList);
}

[
  [logPlayers, 1],
  [logGameStatsheets, 1],
  [logSeasonStatsheet, 1],
  [logOffseasonRecap, 1],
  [logSingle('/api/getIdols'), 1],
  [logSingle('/api/getTribute'), 1],
  [logSingle('/database/globalEvents'), 1],
  [logSingle('/database/offseasonSetup'), 1],

  [logFeed, 5],
].forEach(([f, min]) => {
  setIntervalAsync(f, min * 60 * 1000);
  f().then(() => {});
});
