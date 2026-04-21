import BotBase from './bot_base'
import { goals } from 'mineflayer-pathfinder'

class BotSafekeeper extends BotBase {
  constructor(username) {
    super(username)
    this.initSafeEvents()
  }

  initSafeEvents() {
    setInterval(() => this.patrolVillage(), 5000)
  }

  patrolVillage() {
    // Busca zombies cerca de aldeanos
    const zombie = this.bot.nearestEntity(e => 
      e.name === 'zombie' && 
      Object.values(this.bot.entities).some(v => v.name === 'villager' && v.position.distanceTo(e.position) < 10)
    )

    if (zombie) {
      this.bot.chat("¡Protegiendo a los ciudadanos!")
      this.bot.pathfinder.setGoal(new goals.GoalFollow(zombie, 2))
      this.bot.attack(zombie)
    }
  }
}

new BotSafekeeper('Bot_Miguel')