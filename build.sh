#!/bin/bash

# Limpar cache do npm
npm cache clean

# Remover node_modules e package-lock.json
rm -rf node_modules package-lock.json

npm install

npm update