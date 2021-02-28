import 'log-timestamp';
import { EventSource } from 'launchdarkly-eventsource';
import { dynamic as setIntervalAsyncDynamic } from 'set-interval-async';
import { BASE_URL, fetchJson } from './util.js';
import { cache, writeEntry, writeEntries } from './writer.js';

const { setIntervalAsync } = setIntervalAsyncDynamic;

const ENDPOINT_PLAYERS = '/database/players';
const ENDPOINT_STREAM = '/events/streamData';

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
  console.log(`listening on ${ENDPOINT_STREAM}`);
});
source.on('message', (event) => {
  writeEntry({
    endpoint: ENDPOINT_STREAM,
    id: null,
    data: JSON.parse(event.data),
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
  return async () => {
    writeEntry({
      endpoint,
      id: null,
      data: (await fetchJson(endpoint)).body,
    });
  };
}

async function streamData() {
  await streamDataReady;
  return cache[ENDPOINT_STREAM]?.null?.value;
}

async function logPlayers() {
  const teams = (await streamData())?.leagues?.teams ?? (await fetchJson('/database/allTeams')).body;
  writeEntries(ENDPOINT_PLAYERS, await fetchJson(ENDPOINT_PLAYERS, [...new Set([
    ...Object.keys(cache[ENDPOINT_PLAYERS] ?? {}),
    ...teams.flatMap((team) => team.lineup),
    ...teams.flatMap((team) => team.rotation),
    ...teams.flatMap((team) => team.bullpen),
    ...teams.flatMap((team) => team.bench),
  ])]));
}

async function metalog() {
  return Promise.all([
    logPlayers,
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
