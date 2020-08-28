const { createGzip } = require('zlib');
const { createReadStream, createWriteStream, unlink } = require('fs');
const { EventSource } = require('launchdarkly-eventsource');
const { pipeline } = require('stream');
const { v4: uuidv4 } = require('uuid');

// Generate UUID to identify client responsible for batch
const clientProcessId = uuidv4();

let stream;
let batchStartTimestamp = Date.now();
function newStream() {
  stream = createWriteStream(`blaseball-log-${batchStartTimestamp}.json`, {
    flags: 'wx',
  });

  console.log(`Beginning batch process ${batchStartTimestamp}`);

  stream.on('finish', () => {
    console.log(`Ending batch process ${batchStartTimestamp}`);

    // compress data if any exists
    if (stream.bytesWritten > 0) {
      const gzip = createGzip();
      const source = createReadStream(stream.path);
      const destination = createWriteStream(`${stream.path}.gz`);

      console.log(`Compressing batch process ${batchStartTimestamp}`);

      pipeline(source, gzip, destination, (err) => {
        if (err) {
          console.error('An error occurred:', err);
          process.exitCode = 1;
        }
      });
    }

    // delete uncompressed data file
    unlink(stream.path, (err) => {
      if (err) {
        console.error('An error occurred:', err);
        process.exitCode = 1;
      }
    });

    // start a new batch stream
    batchStartTimestamp = Date.now();
    newStream();
  });

  stream.on('error', (err) => {
    console.error(err);
    newStream();
  });
}
newStream();

const evtSource = new EventSource('https://www.blaseball.com/events/streamData', {
  initialRetryDelayMillis: 2000,
  maxBackoffMillis: 5000,
  errorFilter: function errorFilter() {
    return true;
  },
});
let latestGameDataState = {};
evtSource.on('message', (evt) => {
  const data = JSON.parse(evt.data).value.games;
  const { lastUpdateTime, ...dataExcludingLastUpdateTime } = data;

  // check if updated state data exists
  if (JSON.stringify(dataExcludingLastUpdateTime) !== JSON.stringify(latestGameDataState)) {
    latestGameDataState = dataExcludingLastUpdateTime;

    stream.write(
      `${JSON.stringify({
        ...data,
        clientMeta: {
          timestamp: lastUpdateTime,
          processId: clientProcessId,
          lastEventId: evt.lastEventId
        }
      })}\n`
    );
  }

  // close current batch after one hour
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - batchStartTimestamp > ONE_HOUR) {
    stream.end();
  }
});

evtSource.on('error', (evt) => {
  console.log(`${evt.type} in batch process ${batchStartTimestamp}: ${evt.message}`);
});

evtSource.on('retrying', (evt) => {
  console.log(`${evt.type} in batch process ${batchStartTimestamp}`);
});
