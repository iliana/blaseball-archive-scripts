import "log-timestamp";
import "dotenv/config";
import { promisify } from "util";
import { gunzip } from "zlib";
import manakin from "manakin";
import Pusher from "pusher-js";
import { dynamic as setIntervalAsyncDynamic } from "set-interval-async";
import { useState } from "./state.js";
import { fetch, fetchPriority, fetchIds } from "./util.js";
import { write, writeEntry, writeList, flatWriteList } from "./writer.js";

const { local: console } = manakin;
const { setIntervalAsync } = setIntervalAsyncDynamic;

const pusher = new Pusher("ddb8c477293f80ee9c63", { cluster: "us3" });

function pusherSubscribe(channel) {
  if (pusher.channel(channel) === undefined) {
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
}

["sim-data", "temporal", "ticker"].forEach(pusherSubscribe);

const [leagueId, setLeagueId] = useState();
const [tiebreakersId, setTiebreakersId] = useState();
const [today, setToday] = useState();

const playerIds = new Set();
const [playersReady, setPlayersReady] = useState();

function simFilter(sim) {
  return ({ res, body }) => ({
    res,
    body: body !== undefined ? body.filter((game) => game.sim === sim) : undefined,
  });
}

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

async function logFutureGames() {
  // fetch the full current schedule just to see what the highest day number is
  const schedule = JSON.parse(
    await promisify(gunzip)(Buffer.from(await fetch("/api/games/schedule").then(write), "base64"))
  );

  // log all games played after tomorrow
  const { sim, season, day: thatsToday } = await today();
  await Promise.all(
    Object.values(schedule)
      .map(([game]) => game.day)
      .filter((day) => day >= thatsToday + 2)
      .map((day) => fetch("/database/games", { season, day }).then(simFilter(sim)).then(writeList))
  );
}

async function logLeague() {
  const league = await fetch("/database/league", { id: await leagueId() }).then(write);
  if (league) {
    setTiebreakersId(league.tiebreakers);
  }
}

function logList(url, query) {
  return async () => {
    await fetch(url, query).then(writeList);
  };
}

async function logOffseasonRecap() {
  const { season } = await today();
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
  const ids = await fetch("/database/playerNamesIds").then(write);
  if (ids) {
    ids.forEach(({ id }) => {
      playerIds.add(id);
    });
    setPlayersReady();
  }
}

async function logPlayers() {
  await playersReady();
  await fetchIds("/database/players", [...playerIds]).then(flatWriteList);
}

async function logSimData() {
  const body = await fetchPriority("/database/simulationData").then(write);
  if (body) {
    setLeagueId(body.league);
    setToday({ sim: body.id, season: body.season, day: body.day });
  }
}
pusher.channel("sim-data").bind("sim-data", () => {
  logSimData().catch((e) => {
    console.error(e.message);
  });
});

function logSingle(url, query) {
  return async () => {
    await fetch(url, query).then(write);
  };
}

function logSinglePriority(url, query) {
  return async () => {
    await fetchPriority(url, query).then(write);
  };
}

async function logTiebreakers() {
  await fetch("/database/tiebreakers", { id: await tiebreakersId() }).then(writeList);
}

// TODO /database/{game,team,player}Statsheets
async function logToday() {
  const { sim, season, day } = await today();
  const games = await fetchPriority("/database/games", { season, day, uncache: "" })
    .then(simFilter(sim))
    .then(writeList);
  if (games !== undefined) {
    if (games.every((game) => game.finalized)) {
      games.forEach((game) => {
        pusher.unsubscribe(`game-feed-${game.id}`);
      });
    } else {
      games.forEach((game) => {
        pusherSubscribe(`game-feed-${game.id}`);
      });
    }
  }
}

async function logTomorrow() {
  const { sim, season, day } = await today();
  const games = await fetch("/database/games", { season, day: day + 1 })
    .then(simFilter(sim))
    .then(writeList);
  if (games !== undefined) {
    games.forEach((game) => {
      pusherSubscribe(`game-feed-${game.id}`);
    });
  }
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

[
  [logConfigs, 1],
  [logFutureGames, 15],
  [logLeague, 5],
  [logList("/database/allDivisions"), 5],
  [logList("/database/allSubleagues"), 5],
  [logList("/database/allTeams"), 1],
  [logOffseasonRecap, 5],
  [logPlayerIds, 1],
  [logPlayers, 1],
  [logSimData, 1 / 4],
  [logSingle("/api/championCallout"), 1],
  [logSingle("/api/daysSinceLastIncineration"), 1],
  [logSingle("/api/elections"), 1],
  [logSingle("/api/getPeanutPower"), 1],
  [logSingle("/api/getTribute"), 1],
  [logSingle("/api/sim"), 1],
  [logSingle("/api/standings"), 1],
  [logSingle("/api/tournament/bracket"), 1],
  [logSingle("/championbets/availableBets"), 5],
  [logSingle("/database/fuelProgress"), 5],
  [logSingle("/database/globalEvents"), 1],
  [logSingle("/database/offseasonSetup"), 1],
  [logSinglePriority("/api/temporal"), 1 / 4],
  [logTiebreakers, 5],
  [logToday, 1 / 30],
  [logTomorrow, 1],
  [logTutorialData("onboardingA"), 15],
].forEach(([f, min]) => {
  const wrapped = () =>
    f().catch((e) => {
      console.error(e.message);
    });
  setIntervalAsync(wrapped, min * 60 * 1000);
  wrapped();
});
