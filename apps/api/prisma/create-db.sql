-- One-time local setup: creates the app's dev login and database on the local PostgreSQL server.
-- Run as the postgres superuser (psql prompts for its password):
--   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -f apps/api/prisma/create-db.sql
-- The credentials match DATABASE_URL in apps/api/.env.example. Local development only.
-- CREATEDB lets `prisma migrate dev` create its temporary shadow database.

SELECT 'CREATE ROLE sms LOGIN CREATEDB PASSWORD ''sms_dev_password'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sms')\gexec

SELECT 'CREATE DATABASE sms OWNER sms'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sms')\gexec
