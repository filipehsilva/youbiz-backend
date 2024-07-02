#!/bin/bash

# Limpar cache do npm
npm cache clean --force

# Remover node_modules e package-lock.json
rm -rf node_modules package-lock.json

# Instalar pacotes novamente
npm install --force

# Atualizar pacotes
npm update