const fs = require('fs');
const chunk = require('lodash.chunk');
const process = require('process');

const database = require('./database');

(async () => {
  const stream = fs.createWriteStream(`blaseball-hourly-${Date.now()}.json`, { flags: 'wx' });

  await database.get(stream, 'globalEvents');
  await database.get(stream, 'offseasonSetup');

  const teams = await database.get(stream, 'allTeams');
  // individual teams can be fetched with `team?id=` but it doesn't yield any additional data

  await Promise.all(chunk([...new Set(teams.flatMap(
    (t) => t.lineup.concat(t.rotation, t.bullpen, t.bench),
  ))], 50).map((ids) => database.get(stream, 'players', { ids })));

  // TODO fetch league info, root league ID is in websocket message
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
