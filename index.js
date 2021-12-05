import 'log-timestamp';
import 'dotenv/config';
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

const streamData = {};
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
  const data = JSON.parse(event.data);
  writeEntry({
    endpoint: ENDPOINT_STREAM,
    id: null,
    data,
  });

  streamData.games = data.value?.games ?? streamData.games;
  streamData.leagues = data.value?.leagues ?? streamData.leagues;
  if (resolveStreamData !== undefined) {
    resolveStreamData();
    resolveStreamData = undefined;
  }
});
source.on('error', (err) => {
  console.error(err);
});

/*
async function allTeams() {
  await streamDataReady;
  const teams = streamData?.leagues?.teams;
  if (teams === undefined) {
    console.warn('teams not found in stream data, fetching instead');
    return (await fetch('/database/allTeams')).body;
  }
  return teams;
}
*/

function logSingle(url, query) {
  return async () => { await fetch(url, query).then(write); };
}

async function logPlayers() {
  await fetch('/database/playerNamesIds')
    .then((res) => res.body.map((x) => x.id))
    .then((players) => fetchIds('/database/players', players))
    .then(flatWriteList);
}

async function logGameStatsheets() {
  await streamDataReady;
  const games = streamData?.games?.schedule;
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

/*
async function logSeasonStatsheet() {
  await streamDataReady;
  const season = streamData?.games?.season;
  if (season === undefined) {
    throw new Error('season not found in stream data');
  }

  await fetchIds('/database/seasonStatsheets', [season.stats]).then(flatWriteList);
}
*/

async function logOffseasonRecap() {
  await streamDataReady;
  const season = streamData?.games?.sim?.season;
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

async function logRenos() {
  await streamDataReady;
  const stadiums = streamData?.leagues?.stadiums;
  if (stadiums === undefined) {
    throw new Error('stadiums not found in stream data');
  }

  const renos = [...new Set(stadiums.flatMap(
    (stadium) => [...stadium.renoHand, ...stadium.renoDiscard],
  ))];
  await fetchIds('/database/renovations', renos).then(flatWriteList);
}

/*
async function logRenoProgress() {
  const teams = await allTeams();
  await Promise.all(teams
    .filter((team) => team.stadium !== null)
    .map((team) => fetch('/database/renovationProgress', { id: team.stadium })
      .then((res) => write(res, team.stadium))));
}

async function logTeamElectionStats() {
  const teams = await allTeams();
  await Promise.all(teams
    .map((team) => fetch('/database/teamElectionStats', { id: team.id })
      .then((res) => write(res, team.id))));
}
*/

async function logFeed() {
  // fetch the last 10 minutes every 5 minutes. simple!
  const start = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await fetch('/database/feed/global', { start, sort: 1 }).then(writeList);
  // also fetch the top 50k events sorted by peanuts, for now, until we figure
  // something out better for logging upnuts
  await fetch('/database/feed/global', { sort: 2, limit: 50000 }).then(writeList);
}

async function logAvailableBets() {
  await streamDataReady;
  const today = streamData?.games?.sim?.day;
  await Promise.all([...Array(10).keys()]
    .map((day) => day + today)
    .map((day) => fetch('/bets/availableBets', { day })
      .then((res) => write(res, day))));
}

async function logConfigs() {
  const base = 'https://blaseball-configs.s3.us-west-2.amazonaws.com/';
  const paths = [
    'attributes.json',
    'fanart.json',
    'glossary_words.json',
    'library.json',
    'sponsor_data.json',
    'stadium_prefabs.json',
    'feed_season_list.json',
    'the_beat.json',
    'the_book.json',
  ];
  return Promise.all(paths
    .map((path) => fetch(`${base}${path}`)
      .then((res) => write(res))));
}

async function logTutorialData() {
  const paths = [
    '/tutorial/onboardingA',
    ...[...Array(15)].map((_, i) => `/tutorial/gamedata/onboardingA/${i}`),
  ];
  return Promise.all(paths.map((path) => fetch(path).then((res) => write(res))));
}

[
  [logPlayers, 1],
  [logGameStatsheets, 1],
  // [logSeasonStatsheet, 1],
  [logOffseasonRecap, 1],
  [logSingle('/api/championCallout'), 5],
  [logSingle('/api/daysSinceLastIncineration'), 5],
  [logSingle('/api/games/schedule'), 1],
  [logSingle('/api/getTribute'), 1],
  [logSingle('/championbets/availableBets'), 5],
  [logSingle('/database/fuelProgress'), 5],
  [logSingle('/database/globalEvents'), 1],
  [logSingle('/database/offseasonSetup'), 1],
  [logSingle('/database/giftProgress'), 5],
  [logRenos, 5],
  // [logRenoProgress, 5],
  // [logTeamElectionStats, 5],
  [logAvailableBets, 5],
  [logConfigs, 1],
  [logTutorialData, 15],

  [logFeed, 5],
].forEach(([f, min]) => {
  setIntervalAsync(f, min * 60 * 1000);
  f().then(() => {});
});
