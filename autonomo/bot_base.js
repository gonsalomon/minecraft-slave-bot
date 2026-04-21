import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createBot } from 'mineflayer'
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder'
const mcData = require('minecraft-data')('1.21.1')

class BotBase {
  constructor(username) {
    this.bot = createBot({
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT) || 25565,
      username: username,
      version: '1.21.1'
    })

    this.bot.loadPlugin(pathfinder)
    this.stateFile = 'mundo_conocido.json'
    this.isShielding = false
    this.initBaseEvents()
  }

  initBaseEvents() {
    this.bot.on('spawn', () => {
      const movements = new Movements(this.bot)
      this.bot.pathfinder.setMovements(movements)
      console.log(`[${this.bot.username}] Cimiento biológico activo.`)
      
      setInterval(() => this.checkHomeostasis(), 1000)
    })
  }

  // --- HOMEOSTASIS Y DEFENSA ---
  checkHomeostasis() {
    if (this.bot.health < 1) return
    this.handleCombat()
    this.handleHunger()
  }

  handleCombat() {
    const threat = this.bot.nearestEntity(e => 
      e.type === 'hostile' && this.bot.entity.position.distanceTo(e.position) < 5
    )
    const shield = this.bot.inventory.items().find(i => i.name === 'shield')

    if (threat && shield) {
      if (!this.isShielding) {
        this.bot.equip(shield, 'off-hand')
        this.bot.activateItem(true)
        this.isShielding = true
      }
    } else if (this.isShielding) {
      this.bot.deactivateItem()
      this.isShielding = false
    }
  }

  handleHunger() {
    if (this.bot.food <= 14) {
      const food = this.bot.inventory.items().find(i => ['bread', 'cooked_beef', 'apple'].includes(i.name))
      if (food) this.bot.equip(food, 'hand').then(() => this.bot.consume())
    }
  }

  // --- CONCIENCIA COLECTIVA ---
  saveToGlobalMemory(category, data) {
    let memory = { chests: [], blacklist: [], landmarks: {} }
    if (existsSync(this.stateFile)) {
      memory = JSON.parse(readFileSync(this.stateFile))
    }

    if (category === 'chests') {
      const exists = memory.chests.some(c => c.x === data.x && c.z === data.z)
      if (!exists) {
        memory.chests.push({ ...data, discoveredBy: this.bot.username, date: new Date() })
        writeFileSync(this.stateFile, JSON.stringify(memory, null, 2))
      }
    }
  }
}

export default BotBase