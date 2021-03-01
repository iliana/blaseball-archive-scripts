import Bottleneck from 'bottleneck';
import chunk from 'lodash.chunk';
import manakin from 'manakin';
import superagent from 'superagent';

const { local: console } = manakin;

export const BASE_URL = 'https://www.blaseball.com';

// 20 requests per second, at most 8 concurrent requests
const limiter = new Bottleneck({ minTime: 1000 / 20, maxConcurrent: 8 });

export const fetch = limiter.wrap(async (url, query) => {
  const req = superagent.get(url.startsWith('/') ? `${BASE_URL}${url}` : url)
    .query(query)
    .timeout({ response: 2000, deadline: 15000 })
    .retry(5);
  const qs = Object.entries(req.qs).map(([k, v]) => {
    const vDesc = v.toString().includes(',') ? `{${v.split(',').length}}` : v;
    return `${k}=${vDesc}`;
  });
  console.info(`fetching ${url} ${qs}`.trim());
  return req.then((res) => {
    // res.body is a little too smart. let's explicitly handle the JSON response
    res.body = undefined;
    if (res.text) {
      try {
        res.body = JSON.parse(res.text);
      } catch {
        // ignore
      }
    }
    return res;
  });
});

export async function fetchIds(url, ids) {
  return Promise.all(chunk(ids, 200).map((c) => fetch(url, { ids: c.join(',') })));
}
