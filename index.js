import "log-timestamp";
import "dotenv/config";
import manakin from "manakin";
import { dynamic as setIntervalAsyncDynamic } from "set-interval-async";
import { fetch, fetchIds } from "./util.js";
import { write, writeList, flatWriteList } from "./writer.js";

const { local: console } = manakin;
const { setIntervalAsync } = setIntervalAsyncDynamic;

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

async function logPlayers() {
  await fetch("/database/playerNamesIds")
    .then((res) => res.body.map((x) => x.id))
    .then((players) => fetchIds("/database/players", players))
    .then(flatWriteList);
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

[
  [logConfigs, 1],
  [logList("/database/allDivisions"), 1],
  [logList("/database/allSubleagues"), 1],
  [logList("/database/allTeams"), 1],
  [logPlayers, 1],
  [logSingle("/api/championCallout"), 1],
  [logSingle("/api/daysSinceLastIncineration"), 1],
  [logSingle("/api/games/schedule"), 5],
  [logSingle("/api/getPeanutPower"), 1],
  [logSingle("/api/getTribute"), 1],
  [logSingle("/championbets/availableBets"), 5],
  [logSingle("/database/fuelProgress"), 5],
  [logSingle("/database/giftProgress"), 5],
  [logSingle("/database/globalEvents"), 1],
  [logSingle("/database/offseasonSetup"), 1],
  [logTutorialData("onboardingA"), 15],
].forEach(([f, min]) => {
  const wrapped = () =>
    f().catch((e) => {
      console.error(`${e.message} ${e.response?.req?.path}`);
    });
  setIntervalAsync(wrapped, min * 60 * 1000);
  wrapped();
});
