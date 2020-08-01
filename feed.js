const { createGzip } = require('zlib');
const { createReadStream, createWriteStream, unlink } = require('fs');
const io = require('socket.io-client');
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

const socket = io('https://blaseball.com');
let latestGameDataState = {};
socket.on('gameDataUpdate', (data) => {
  // check if updated state data exists
  if (JSON.stringify(data) !== JSON.stringify(latestGameDataState)) {
    latestGameDataState = data;

    stream.write(
      `${JSON.stringify({
        ...latestGameDataState,
        clientMeta: {
          timestamp: Date.now(),
          processId: clientProcessId,
        },
      })}\n`,
    );
  }

  // close current batch after one hour
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - batchStartTimestamp > ONE_HOUR) {
    stream.end();
  }
});
