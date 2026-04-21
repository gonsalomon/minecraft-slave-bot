import BotBase from './bot_base'

class BotMinero extends BotBase {
  constructor(username) {
    super(username)
    this.initMinerEvents()
  }

  initMinerEvents() {
    // Escaneo de mundo: si Pedro encuentra un cofre en la mina, lo reporta
    this.bot.on('blockUpdate', (oldB, newB) => {
      if (newB && newB.name === 'chest') {
        this.saveToGlobalMemory('chests', { 
          x: newB.position.x, 
          y: newB.position.y, 
          z: newB.position.z,
          type: 'mina'
        })
      }
    })
  }
  
  // Aquí iría tu lógica de chunk-mining que ya tenés,
  // pero llamando a super.checkHomeostasis() para no morir.
}

new BotMinero('Bot_Pedro')