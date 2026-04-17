# Minecraft Bot

Bot de Mineflayer para minería automatizada con control vía MCP.

## Setup

1. Clonar el repo
2. `npm install`
3. Generar tu propio .env con tus datos:
-MC_HOST: localhost si jugás en local, la IP o dominio que tengas del servidor
-MC_PORT: el puerto en el que está el servidor (si abriste en local, lo definís vos)
-MC_USERNAME: el nombre que va a tomar el bot in-game
-MC_VERSION: la versión de MC que están usando
-MC_MASTER: tu nick en MC, así sólo te hace caso a vos
4. `node bot.js`

## Requisitos

- Node.js 18+
- Servidor Minecraft con online-mode=false
- Username del bot en la whitelist del servidor