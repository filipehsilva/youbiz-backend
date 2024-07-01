#!/bin/bash

# Matar todos os processos Node.js
pkill node

# Atualizar dependências
npm install
npm update

# Iniciar o servidor
nohup npm start &