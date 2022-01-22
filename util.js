import Bottleneck from "bottleneck";
import chunk from "lodash.chunk";
import manakin from "manakin";
import nodeFetch, { AbortError } from "node-fetch";

const { local: console } = manakin;

export const BASE_URL = "https://api.blaseball.com";

// 20 requests per second, at most 8 concurrent requests
const limiter = new Bottleneck({ minTime: 1000 / 20, maxConcurrent: 8 });

export const fetch = limiter.wrap(async (originalUrl, query = {}) => {
  const plainUrl = originalUrl.startsWith("/") ? `${BASE_URL}${originalUrl}` : originalUrl;
  const url = new URL(plainUrl);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const qs = Object.entries(query).map(([k, v]) => {
    const vDesc = v.toString().includes(",") ? `{${v.split(",").length}}` : v;
    return `${k}=${vDesc}`;
  });
  console.info(`fetching ${plainUrl} ${qs}`.trim());

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  const ret = {};
  try {
    ret.res = await nodeFetch(url, {
      headers: {
        "user-agent": `blaseball-archive-scripts/2.0.0 (https://github.com/iliana/blaseball-archive-scripts; iliana@sibr.dev)`,
      },
      signal: controller.signal,
    });
    if (!ret.res.ok) {
      throw new Error(`${plainUrl} returned ${ret.res.status}`);
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
