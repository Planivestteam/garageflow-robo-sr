import fetch from 'node-fetch';
import config from '../src/config/index.js';

const url = `http://localhost:${config.port}/health`;

fetch(url)
  .then(async (res) => {
    const body = await res.json();
    console.log(JSON.stringify(body, null, 2));
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(`Healthcheck falhou: ${err.message}`);
    process.exit(1);
  });
