const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  const res = await client.query('SELECT wallet_address, status, github_login FROM web_proofs');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
check();
