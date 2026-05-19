#!/usr/bin/env node
// clean-database.js - Clean all tables for fresh deployment

const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  user: process.env.DB_USERNAME || 'grantos',
  password: process.env.DB_PASSWORD || 'grantos_secret_2025',
  database: process.env.DB_NAME || 'grantos_service',
});

async function cleanDatabase() {
  try {
    await client.connect();
    console.log('✓ Connected to database');

    // Delete all data from tables (in correct order to respect foreign keys)
    const tables = [
      'notifications',
      'milestone_warnings',
      'milestone_submissions',
      'grants',
      'web_proofs'
    ];

    for (const table of tables) {
      const result = await client.query(`DELETE FROM ${table}`);
      console.log(`✓ Cleaned ${table}: ${result.rowCount} rows deleted`);
    }

    // Reset sequences
    await client.query(`ALTER SEQUENCE grants_id_seq RESTART WITH 1`);
    await client.query(`ALTER SEQUENCE milestone_submissions_id_seq RESTART WITH 1`);
    await client.query(`ALTER SEQUENCE milestone_warnings_id_seq RESTART WITH 1`);
    console.log('✓ Reset sequences');

    console.log('\n✅ Database cleaned successfully!');
  } catch (error) {
    console.error('❌ Error cleaning database:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

cleanDatabase();
