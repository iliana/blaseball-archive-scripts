import "log-timestamp";
import "dotenv/config";
import manakin from "manakin";
import Pusher from "pusher-js";
import { dynamic as setIntervalAsyncDynamic } from "set-interval-async";
import { fetch, fetchIds } from "./util.js";
import { write, writeEntry, writeList, flatWriteList } from "./writer.js";

const { local: console } = manakin;
const { setIntervalAsync } = setIntervalAsyncDynamic;

const pusher = new Pusher("ddb8c477293f80ee9c63", { cluster: "us3" });

function pusherSubscribe(channel) {
  pusher.subscribe(channel).bind_global((event, data) => {
    try {
      writeEntry({
        endpoint: "pusher",
        id: { channel, event },
        data,
      });
    } catch (e) {
      console.error(e);
    }
  });
  console.info(`subscribed to ${channel} via pusher`);
}

["sim-data", "temporal", "ticker"].forEach(pusherSubscribe);

/* TODO genericize this thing */
let simData = {};
let resolveSimData;
const simDataReady = new Promise((resolve) => {
  resolveSimData = resolve;
});

const playerIds = new Set();
let resolvePlayerIds;
const playerIdsReady = new Promise((resolve) => {
  resolvePlayerIds = resolve;
});

async function logConfigs() {
  const base = "https://blaseball-configs.s3.us-west-2.amazonaws.com/";
  const paths = [
    "attributes.json",
    "fanart.json",
    "glossary_words.json",
    "library.json",
    "sponsor_data.json",
    "stadium_prefabs.json",
    "feed_season_list.json",
    "the_beat.json",
    "the_book.json",
  ];
  await Promise.all(paths.map((path) => fetch(`${base}${path}`).then((res) => write(res))));
}

function logList(url, query) {
  return async () => {
    await fetch(url, query).then(writeList);
  };
}

async function logOffseasonRecap() {
  await simDataReady;
  const { season } = simData;
  if (season === undefined) {
    throw new Error("season number not found in simulation data");
  }

  const recap = await fetch("/database/offseasonRecap", { season }).then(write);
  if (recap !== undefined) {
    await Promise.all(
      ["bonusResults", "decreeResults", "eventResults"]
        .filter((key) => recap[key] !== undefined)
        .map((key) => fetchIds(`/database/${key}`, recap[key]).then(flatWriteList))
    );
  }
}

async function logPlayerIds() {
  await fetch("/database/playerNamesIds").then(({ body }) => {
    if (body !== undefined) {
      body.forEach(({ id }) => {
        playerIds.add(id);
      });
    }
    if (resolvePlayerIds !== undefined) {
      resolvePlayerIds();
      resolvePlayerIds = undefined;
    }
  });
}

async function logPlayers() {
  await playerIdsReady;
  await fetchIds("/database/players", [...playerIds]).then(flatWriteList);
}

async function logSimData() {
  await fetch("/database/simulationData")
    .then(write)
    .then((body) => {
      if (body) {
        simData = body;
        if (resolveSimData !== undefined) {
          resolveSimData();
          resolveSimData = undefined;
        }
      }
    });
}

function logSingle(url, query) {
  return async () => {
    await fetch(url, query).then(write);
  };
}

function logTutorialData(id) {
  return async () => {
    const paths = [
      `/tutorial/${id}`,
      ...[...Array(15)].map((_, i) => `/tutorial/gamedata/${id}/${i}`),
    ];
    await Promise.all(paths.map((path) => fetch(path).then((res) => write(res))));
  };
}

/* todo:
 * /database/games, plus subscribing to pusher for active games
 * /database/{game,team,player}Statsheets
 * /database/league
 */

[
  [logConfigs, 1],
  [logList("/database/allDivisions"), 1],
  [logList("/database/allSubleagues"), 1],
  [logList("/database/allTeams"), 1],
  [logOffseasonRecap, 5],
  [logPlayerIds, 1],
  [logPlayers, 1],
  [logSimData, 1],
  [logSingle("/api/championCallout"), 1],
  [logSingle("/api/daysSinceLastIncineration"), 1],
  [logSingle("/api/elections"), 1],
  [logSingle("/api/getPeanutPower"), 1],
  [logSingle("/api/getTribute"), 1],
  [logSingle("/api/sim"), 1],
  [logSingle("/api/standings"), 1],
  [logSingle("/api/temporal"), 1 / 4],
  [logSingle("/api/tournament/bracket"), 1],
  [logSingle("/championbets/availableBets"), 5],
  [logSingle("/database/fuelProgress"), 5],
  [logSingle("/database/globalEvents"), 1],
  [logSingle("/database/offseasonSetup"), 1],
  [logTutorialData("onboardingA"), 15],
].forEach(([f, min]) => {
  const wrapped = () =>
    f().catch((e) => {
      console.error(e.message);
    });
  setIntervalAsync(wrapped, min * 60 * 1000);
  wrapped();
});
