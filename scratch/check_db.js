const { DataSource } = require('typeorm');
require('dotenv').config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  username: process.env.DB_USERNAME || 'grantos',
  password: process.env.DB_PASSWORD || 'grantos_secret_2025',
  database: process.env.DB_NAME || 'grantos_service',
  entities: [],
  synchronize: false,
});

async function main() {
  await AppDataSource.initialize();
  const results = await AppDataSource.query(`
    SELECT request_id, github_login, status, error_message, updated_at 
    FROM web_proofs 
    ORDER BY updated_at DESC 
    LIMIT 5;
  `);
  console.log(JSON.stringify(results, null, 2));
  await AppDataSource.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
