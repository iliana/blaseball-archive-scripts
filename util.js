import Bottleneck from 'bottleneck';
import chunk from 'lodash.chunk';
import manakin from 'manakin';
import superagent from 'superagent';

const { local: console } = manakin;

export const BASE_URL = 'https://www.blaseball.com';

// 25 requests per second, at most 10 concurrent requests
const limiter = new Bottleneck({ minTime: 1000 / 25, maxConcurrent: 10 });

const fetchInner = limiter.wrap(async (endpoint, ids, idParam) => {
  console.info(`fetching ${endpoint}${ids ? ` ids=${ids.length}` : ''}`);
  const req = superagent.get(`${BASE_URL}${endpoint}`)
    .timeout({ response: 2000, deadline: 15000 })
    .type('json')
    .retry(5);
  if (ids?.length > 0) {
    req.query({ [idParam ?? 'ids']: ids.join(',') });
  }
  return req;
});

export async function fetchJson(endpoint, ids, idParam) {
  if (ids === undefined) {
    return fetchInner(endpoint, undefined, idParam);
  }
  return Promise.all(chunk(ids, 200).map((c) => fetchInner(endpoint, c, idParam)));
}
