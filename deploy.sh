#!/bin/bash

# Matar todos os processos Node.js


# Atualizar dependências
npm install
npm update

# Iniciar o servidor
pkill node && npm start