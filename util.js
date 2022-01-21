import chunk from "lodash.chunk";
import manakin from "manakin";
import superagent from "superagent";
import Throttle from "superagent-throttle";

const { local: console } = manakin;

export const BASE_URL = "https://api.blaseball.com";

// 20 requests per second, at most 8 concurrent requests
const throttle = new Throttle({
  active: true,
  rate: 20,
  ratePer: 1000,
  concurrent: 8,
});

export async function fetch(url, query) {
  return superagent
    .get(url.startsWith("/") ? `${BASE_URL}${url}` : url)
    .use(throttle.plugin())
    .use((req) => {
      const qs = Object.entries(req.qs).map(([k, v]) => {
        const vDesc = v.toString().includes(",") ? `{${v.split(",").length}}` : v;
        return `${k}=${vDesc}`;
      });
      console.info(`fetching ${req.url} ${qs}`.trim());
    })
    .query(query)
    .timeout({ response: 15000, deadline: 30000 })
    .retry(5)
    .then((res) => {
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
}

export async function fetchIds(url, ids) {
  return Promise.all(chunk(ids, 200).map((c) => fetch(url, { ids: c.join(",") })));
}
