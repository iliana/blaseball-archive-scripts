import Bottleneck from "bottleneck";
import MurmurHash3 from "imurmurhash";
import chunk from "lodash.chunk";
import manakin from "manakin";
import { nanoid } from "nanoid";
import nodeFetch, { AbortError } from "node-fetch";

const { local: console } = manakin;

export const BASE_URL = "https://api.blaseball.com";

const etags = new Map();

async function fetchInner(originalUrl, query = {}) {
  const headers = {
    "user-agent": `blaseball-archive-scripts/2.0.0 (https://github.com/iliana/blaseball-archive-scripts; iliana@sibr.dev)`,
  };

  const plainUrl = originalUrl.startsWith("/") ? `${BASE_URL}${originalUrl}` : originalUrl;
  const url = new URL(plainUrl);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const hashKey = MurmurHash3(url.toString()).result();
  if (etags.has(hashKey)) {
    headers["if-none-match"] = etags.get(hashKey);
  }

  const qs = Object.entries(query)
    .filter(([k]) => k !== "uncache")
    .map(([k, v]) => {
      const vDesc = v.toString().includes(",") ? `{${v.split(",").length}}` : v;
      return `${k}=${vDesc}`;
    });

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  if (url.searchParams.has("uncache")) {
    url.searchParams.set("uncache", nanoid());
  }

  const ret = {};
  try {
    ret.res = await nodeFetch(url, {
      headers,
      signal: controller.signal,
    });
    const logMsg = `${ret.res.status} ${plainUrl} ${qs}`.trim();

    if (ret.res.status === 304) {
      // not modified. early return with an undefined body
      console.info(logMsg);
      return ret;
    }
    if (!ret.res.ok) {
      throw new Error(logMsg);
    }
    console.info(logMsg);

    if (ret.res.headers.has("etag")) {
      etags.delete(hashKey);
      etags.set(hashKey, ret.res.headers.get("etag"));
      // limit the map to the 200 most recently-inserted keys
      [...Array(Math.max(etags.size - 200, 0))].forEach(() =>
        etags.delete(etags.keys().next().value)
      );
    }

    ret.body = await ret.res.text();
    // if empty response, don't log
    if (!ret.body) {
      ret.body = undefined;
      return ret;
    }
    // attempt to parse as JSON
    try {
      ret.body = JSON.parse(ret.body);
    } catch (e) {
      if (e instanceof SyntaxError) {
        // if not JSON, log the string
      } else {
        throw e;
      }
    }
  } catch (e) {
    // check timeout
    if (e instanceof AbortError) {
      console.warn(`timeout ${plainUrl} ${qs}`);
    } else {
      throw e;
    }
  } finally {
    clearTimeout(timeout);
  }

  return ret;
}

// low-priority queue: 10 requests per second, at most 4 concurrent requests
export const fetch = new Bottleneck({ minTime: 1000 / 10, maxConcurrent: 4 }).wrap(fetchInner);

// high-priority queue: 15 requests per second, at most 6 concurrent requests
// used for fetching current game data (/api/games/:gameId)
export const fetchPriority = new Bottleneck({ minTime: 1000 / 20, maxConcurrent: 6 }).wrap(
  fetchInner
);

export async function fetchIds(url, ids) {
  return Promise.all(chunk(ids, 200).map((c) => fetch(url, { ids: c.join(",") })));
}
