const { Client } = require('pg');
const client = new Client({
  host: 'localhost',
  port: 5433,
  user: 'grantos',
  password: 'grantos_secret_2025',
  database: 'grantos_service'
});
async function run() {
  await client.connect();
  const res = await client.query(`SELECT request_id, wallet_address, wallet_address_hi, wallet_address_lo, status FROM web_proofs WHERE request_id = 'ed0ae159-bd01-4974-bf4e-b3d54dcc3f25';`);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
