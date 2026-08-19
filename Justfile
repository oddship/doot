set dotenv-load := true

default:
  @just --list

setup:
  npm ci

dev:
  npm run dev

build:
  npm run build

start:
  npm run start

test:
  npm test

lint:
  npm run lint

format:
  npm run format

check:
  npm run check

ui-check:
  npm run test:ui

demo-build:
  npm run demo:build

demo-screenshot:
  npm run demo:screenshot

audit:
  npm run audit:prod

db:
  sqlite3 "${DOOT_DATABASE_PATH:-email-cache.sqlite3}"

docker-build:
  docker compose build

docker-up:
  docker compose up --build

docker-down:
  docker compose down

docker-logs:
  docker compose logs --follow doot

docs-build:
  moat build docs _site

docs-serve:
  moat serve docs
