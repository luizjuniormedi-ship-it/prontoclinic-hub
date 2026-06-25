#!/bin/bash
# Build script que injeta env vars do .env.production no Vite
# Usado pelo GitHub Actions quando VERCEL_TOKEN não está disponível

set -a
source .env.production
set +a
npm run build
