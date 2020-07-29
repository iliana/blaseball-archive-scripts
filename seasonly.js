const fs = require('fs');
const process = require('process');

const database = require('./database');

(async () => {
  // TODO in order to get the current season ID, we need to pull the first message off of the websocket
  // for now, just going to accept a command line argument
  // XXX "Season 1" is actually season ID 0
  const season = process.argv[2];
  if (season === undefined) { throw new Error('specify season ID as argument'); }
  const stream = fs.createWriteStream(`blaseball-season-${season}.json`, { flags: 'wx' });

  const recap = await database.get(stream, 'offseasonRecap', { season });
  await database.get(stream, 'bonusResults', { ids: recap.bonusResults });
  await database.get(stream, 'decreeResults', { ids: recap.decreeResults });

  // unsure where to follow the `rounds` ids but let's fetch it anyway
  await database.get(stream, 'playoffs', { number: season });
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
