#!/bin/bash
rm -rf node_modules
rm -rf .vite
rm -rf dist
npm cache clean --force
npm install
npm run dev
