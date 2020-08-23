const Bottleneck = require('bottleneck');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

// Generate UUID to identify client responsible for batch
const clientProcessId = uuidv4();

// at most 1 concurrent request, 5 requests per second
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 200 });

module.exports.get = async (stream, endpoint, params) => {
  const url = new URL(`https://www.blaseball.com/database/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([name, value]) => {
      url.searchParams.set(name, Array.isArray(value) ? value.join(',') : value);
    });
  }

  const [response, data] = await limiter.schedule(() => fetch(url).then(
    (r) => r.json().then((d) => [r, d]),
  ));
  const etag = response.headers.get('etag');

  stream.write(
    `${JSON.stringify({
      endpoint,
      params,
      etag,
      data,
      clientMeta: {
        timestamp: Date.now(),
        processId: clientProcessId,
      },
    })}\n`,
  );
  return data;
};
