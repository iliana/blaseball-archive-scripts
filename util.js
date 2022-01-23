import Bottleneck from "bottleneck";
import MurmurHash3 from "imurmurhash";
import chunk from "lodash.chunk";
import manakin from "manakin";
import nodeFetch, { AbortError } from "node-fetch";

const { local: console } = manakin;

export const BASE_URL = "https://api.blaseball.com";

// 20 requests per second, at most 8 concurrent requests
const limiter = new Bottleneck({ minTime: 1000 / 20, maxConcurrent: 8 });

const etags = new Map();

export const fetch = limiter.wrap(async (originalUrl, query = {}) => {
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

  const qs = Object.entries(query).map(([k, v]) => {
    const vDesc = v.toString().includes(",") ? `{${v.split(",").length}}` : v;
    return `${k}=${vDesc}`;
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

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
      // limit the map to the 100 most recently-inserted keys
      [...Array(Math.max(etags.size - 100, 0))].forEach(() =>
        etags.delete(etags.keys().next().value)
      );
    }
    ret.body = await ret.res.json();
  } catch (e) {
    if (e instanceof AbortError) {
      console.warn(`timeout ${plainUrl} ${qs}`);
    } else {
      throw e;
    }
  } finally {
    clearTimeout(timeout);
  }
  return ret;
});

export async function fetchIds(url, ids) {
  return Promise.all(chunk(ids, 200).map((c) => fetch(url, { ids: c.join(",") })));
}
