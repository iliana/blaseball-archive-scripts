import Bottleneck from 'bottleneck';
import chunk from 'lodash.chunk';
import superagent from 'superagent';

export const BASE_URL = 'https://www.blaseball.com';

// 25 requests per second, at most 10 concurrent requests
const limiter = new Bottleneck({ minTime: 1000 / 25, maxConcurrent: 10 });

const fetchInner = limiter.wrap(async (endpoint, ids) => {
  console.log(`fetching ${endpoint}${ids ? ` ids=${ids.length}` : ''}`);
  const req = superagent.get(`${BASE_URL}${endpoint}`)
    .timeout({ response: 2000, deadline: 15000 })
    .type('json')
    .retry(5);
  if (ids?.length > 0) {
    req.query({ ids: ids.join(',') });
  }
  return req;
});

export async function fetchJson(endpoint, ids) {
  if (ids === undefined) {
    return fetchInner(endpoint);
  }
  return Promise.all(chunk(ids, 200).map((c) => fetchInner(endpoint, c)));
}

// use this method to look up the id field of an object, in case this changes
// globally (like it did when TGB moved from mongodb to postgres)
export function getId(data) {
  // eslint-disable-next-line no-underscore-dangle
  return data.id ?? data._id;
}
