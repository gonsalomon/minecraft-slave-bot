import BotBase from './bot_base'
import { goals } from 'mineflayer-pathfinder'

class BotLogistico extends BotBase {
  constructor(username) {
    super(username)
    this.initLogisticEvents()
  }

  initLogisticEvents() {
    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return
      
      const msg = message.toLowerCase()
      // Si un hermano bot o ángel pide algo
      if (msg.includes("necesito")) {
        const item = msg.split(' ').pop()
        this.supplyResource(username, item)
      }
    })
  }

  async supplyResource(targetName, itemName) {
    this.bot.chat(`[Logística] Entendido ${targetName}, busco ${itemName}.`)
    // Aquí Lucas consultaría el 'mundo_conocido.json' para ver qué cofre tiene el item
    // y procedería a buscarlo y entregarlo.
  }
}

new BotLogistico('Bot_Lucas')