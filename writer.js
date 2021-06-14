import fs from 'fs';
import path from 'path';
import stream from 'stream';
import url from 'url';
import zlib from 'zlib';
import S3 from 'aws-sdk/clients/s3.js';
import stringify from 'fast-json-stable-stringify';
import MurmurHash3 from 'imurmurhash';
import manakin from 'manakin';
import * as uuid from 'uuid';

const { local: console } = manakin;
const s3 = new S3();

// use this method to look up the id field of an object, in case this changes
// globally (like it did when TGB moved from mongodb to postgres)
function getId(data) {
  // eslint-disable-next-line no-underscore-dangle
  return data.id ?? data._id ?? null;
}

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

      destination.on('finish', () => {
        console.info(`finished ${path.basename(destination.path)}`);

        if (process.env.S3_BUCKET) {
          const Bucket = process.env.S3_BUCKET;
          const Key = `${process.env.S3_PREFIX ?? ''}${path.basename(destination.path)}`;
          s3.upload({ Bucket, Key, Body: fs.createReadStream(destination.path) })
            .promise()
            .then(() => {
              console.info(`uploaded ${path.basename(destination.path)} to s3://${Bucket}/${Key}`);
            })
            .catch((err) => { console.error(err); });
        }
      });

      stream.pipeline(source, gzip, destination, handleErr);
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

const cache = {};

export function writeEntry({
  endpoint, id, time, data,
}) {
  const hash = new MurmurHash3(stringify(data)).result();
  if (cache[endpoint] === undefined) {
    cache[endpoint] = {};
  } else if (cache[endpoint][id] === hash) {
    return data;
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
  return data;
}

function resMeta(res) {
  return {
    endpoint: res.req.path.split('?')[0],
    time: res.headers.date === undefined ? undefined : new Date(res.headers.date).getTime(),
  };
}

export function write(res, id) {
  if (res.body) {
    writeEntry({
      ...resMeta(res),
      id: id ?? getId(res.body),
      data: res.body,
    });
  }
  return res.body;
}

export function writeList(res) {
  const meta = resMeta(res);
  if (res.body) {
    res.body.forEach((data) => writeEntry({
      ...meta,
      id: getId(data),
      data,
    }));
  }
  return res.body;
}

export function flatWriteList(responses) {
  return responses.flatMap(writeList);
}
