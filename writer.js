import fs from 'fs';
import path from 'path';
import stream from 'stream';
import url from 'url';
import zlib from 'zlib';
import stringify from 'fast-json-stable-stringify';
import MurmurHash3 from 'imurmurhash';
import manakin from 'manakin';
import * as uuid from 'uuid';
import { getId } from './util.js';

const { local: console } = manakin;

function handleErr(err) {
  if (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

const dirname = path.dirname(url.fileURLToPath(import.meta.url));
fs.mkdir(path.join(dirname, 'log'), { recursive: true }, handleErr);

let currentLog;
function newStream() {
  currentLog = fs.createWriteStream(path.join(dirname, 'log', `${Date.now()}.json`), { flags: 'wx' });
  console.info(`started ${path.basename(currentLog.path)}`);

  currentLog.on('finish', () => {
    // swap out the current logger for a new one
    const oldLog = currentLog;
    newStream();

    // if the log isn't empty, compress it
    if (oldLog.bytesWritten > 0) {
      const gzip = zlib.createGzip();
      const source = fs.createReadStream(oldLog.path);
      const destination = fs.createWriteStream(`${oldLog.path}.gz`);

      stream.pipeline(source, gzip, destination, handleErr);
      console.info(`finished ${path.basename(destination.path)}`);
    } else {
      console.info(`removing empty ${path.basename(oldLog.path)}`);
    }

    // remove the uncompressed log
    fs.unlink(oldLog.path, handleErr);
  });

  currentLog.on('error', (err) => {
    handleErr(err);
    newStream();
  });
}
if (currentLog === undefined) {
  newStream();
}
// every 15 minutes, open a new log file (by closing the current one)
setInterval(() => currentLog.end(), 15 * 60 * 1000);

const processId = (() => {
  const p = path.join(dirname, '.client_id');
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      const id = uuid.v4();
      fs.writeFileSync(p, id, 'utf8');
      return id;
    }
    throw err;
  }
})();

export const cache = {};

export function writeEntry({
  endpoint, id, time, data,
}) {
  const hash = new MurmurHash3(stringify(data)).result();
  if (cache[endpoint] === undefined) {
    cache[endpoint] = {};
  } else if (cache[endpoint][id] === hash) {
    return;
  }
  cache[endpoint][id] = hash;

  const entry = {
    version: '2',
    processId,
    endpoint,
    id,
    time: (time ?? Date.now()) / 1000,
    data,
  };
  currentLog.write(`${JSON.stringify(entry)}\n`);
}

export function writeEntries(endpoint, responses) {
  responses.forEach((res) => {
    const time = res.headers.date === undefined ? undefined : new Date(res.headers.date).getTime();
    res.body.forEach((data) => writeEntry({
      endpoint,
      id: getId(data),
      time,
      data,
    }));
  });
}
