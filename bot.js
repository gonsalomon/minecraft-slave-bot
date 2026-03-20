// =====================
//   CARGAR JUEGO
// =====================

const fs = require('fs')
const STATE_FILE = './state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation         = data.chestLocation         ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    mineLocation          = data.mineLocation          ?? null
    console.log('📂 Estado cargado:', data)
  } catch {
    console.log('📂 Sin estado previo, arrancando limpio.')
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, mineLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

//empieza setup variables globales

require('dotenv').config()
const mineflayer  = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcData      = require('minecraft-data')('1.21.1')

const MASTER = process.env.MC_MASTER ?? 'gonsalomon'

const bot = mineflayer.createBot({
  host:     process.env.MC_HOST           ?? 'localhost',
  port:     parseInt(process.env.MC_PORT) ?? 25565,
  username: process.env.MC_USERNAME       ?? 'minero',
  version:  process.env.MC_VERSION        ?? '1.21.1'
})

bot.loadPlugin(pathfinder)

// --- Estado global ---
let chestLocation         = null
let craftingTableLocation = null
let mineLocation = null   // { x, y, z } — entrada de la mina
let miningActive          = false
let miningTarget          = null
let followingPlayer       = false
let followInterval        = null

// --- Pico necesario por bloque ---
const PICKAXE_FOR_BLOCK = {
  'coal_ore':               'stone_pickaxe',
  'deepslate_coal_ore':     'stone_pickaxe',
  'stone':                  'stone_pickaxe',
  'iron_ore':               'stone_pickaxe',
  'deepslate_iron_ore':     'stone_pickaxe',
  'lapis_ore':              'stone_pickaxe',
  'deepslate_lapis_ore':    'stone_pickaxe',
  'gold_ore':               'iron_pickaxe',
  'deepslate_gold_ore':     'iron_pickaxe',
  'diamond_ore':            'iron_pickaxe',
  'deepslate_diamond_ore':  'iron_pickaxe',
  'redstone_ore':           'iron_pickaxe',
  'deepslate_redstone_ore': 'iron_pickaxe',
  'emerald_ore':            'iron_pickaxe',
  'obsidian':               'diamond_pickaxe',
  'ancient_debris':         'diamond_pickaxe',
}

const PICKAXE_MATERIAL = {
  'wooden_pickaxe':  'oak_planks',
  'stone_pickaxe':   'cobblestone',
  'iron_pickaxe':    'iron_ingot',
  'diamond_pickaxe': 'diamond',
}

// =====================
//   MOBS HOSTILES
// =====================
const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'piglin_brute', 'hoglin', 'wither_skeleton',
  'enderman', 'silverfish', 'phantom', 'drowned', 'husk',
  'stray', 'bogged', 'breeze'
]

let huntingActive = false

// =====================
//   SPAWN
// =====================
bot.on('spawn', () => {
  console.log('✅ Bot conectado')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  loadState()
  bot.chat('Listo.')
})

// =====================
//   CHAT
// =====================
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  console.log(`[Chat] ${username}: ${message}`)
  if (username !== MASTER) { bot.chat(`Solo obedezco a ${MASTER}.`); return }

  // --- info sobre bot ---
  //ACCIONES
  if(message === 'aiuda'){
    bot.chat("--DATA--")
    bot.chat("BOT>DATA>YOU")
    bot.chat("where are you (x y z)| status (health/hunger)| equipment (pickaxes on stock)")
    bot.chat("YOU>DATA>BOT")
    bot.chat("chest at [x y z] | table at [x y z] | mine at [x y z]")
    bot.chat("--MOVEMENT--")
    bot.chat("go to [x y z] | follow/stop follow | bring [block_name] | stop (movement/mining)")
    bot.chat("--ACTIONS--")
    bot.chat("eat | hold | hunt/stop hunt")
    bot.chat("bring es para pedirle bloques y mina por si solo")
  }
  //reporta que anda bajito de vida o tiene hambre
  bot.on('health', async() => {
    if (bot.health <= 4) {
      bot.chat(`⚠️ Poca vida: ${Math.round(bot.health)}/20. Cuidado!`)
    }
    if (bot.food <= 5) {
      bot.chat(`⚠️ Tengo hambre: ${Math.round(bot.food)}/20. Dame comida o me muero`)
      await eatFood()
    }
  }
  )

  if (message === 'where are you') {
    const p = bot.entity.position
    bot.chat(`X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
    return
  }

  if (message === 'status') {
  const health = Math.round(bot.health)
  const food   = Math.round(bot.food)

  const healthBar = '❤️'.repeat(Math.ceil(health / 2)) 
  const foodBar   = '🍖'.repeat(Math.ceil(food / 2))

  bot.chat(`Vida: ${health}/20 ${healthBar}`)
  bot.chat(`Hambre: ${food}/20 ${foodBar}`)
  return
  }

  if (message === 'equipment') {
    reportPickaxes()
    return
  }

  // --- info al bot ---

  if (message.startsWith('chest at ')) {
    const [, x, y, z] = message.split(' ').map(Number)
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: cofre <x> <y> <z>'); return }
    chestLocation = { x, y, z }
    bot.chat(`Cofre registrado en X:${x} Y:${y} Z:${z}`)
    saveState()
    return
  }

  if (message.startsWith('table at ')) {
    const [, x, y, z] = message.split(' ').map(Number)
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: crafteo <x> <y> <z>'); return }
    craftingTableLocation = { x, y, z }
    bot.chat(`Mesa registrada en X:${x} Y:${y} Z:${z}`)
    saveState()
    return
  }
  
  if (message.startsWith('mine at ')) {
    const [, x, y, z] = message.split(' ').map(Number)
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: mina <x> <y> <z>'); return }
    mineLocation = { x, y, z }
    bot.chat(`Mina registrada en X:${x} Y:${y} Z:${z}`)
    saveState()
    return
  }

  // --- movimiento ---
  if (message.startsWith('go to ')) {
    const [, x, y, z] = message.split(' ').map(Number)
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: ir <x> <y> <z>'); return }
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2))
    bot.chat(`Voy a X:${Math.floor(x)} Y:${Math.floor(y)} Z:${Math.floor(z)}`)
    return
  }

  if (message === 'follow') {
    const target = bot.players[username]?.entity
    if (!target) { bot.chat('No te veo.'); return }
    followingPlayer = true
    miningActive    = false
    bot.chat('Te sigo.')
    startFollowing(username)
    return
  }

  if (message === 'stop follow') {
    followingPlayer = false
    if (followInterval) clearInterval(followInterval)
    bot.pathfinder.setGoal(null)
    bot.chat('Listo, me quedo acá.')
    return
  }

  if (message.startsWith("bring ")) {
    if (!chestLocation)         { bot.chat('No sé dónde hay cofre (con "cofre <x> <y> <z>").'); return }
    if (!craftingTableLocation) { bot.chat('No sé dónde hay mesa (con "crafteo <x> <y> <z>").'); return }
    if (!mineLocation)          { bot.chat('No sé dónde hay mina (con "mina <x> <y> <z>").'); return }

    const blockName = message.split(' ')[1]
    if (!mcData.blocksByName[blockName]) {
      bot.chat(`No conozco "${blockName}".`)
      return
    }

    const ok = await ensurePickaxe(blockName)
    if (!ok){
      bot.chat("No tengo pico para minar lo que me pediste. Dame uno o no puedo")
      return
    } 

    miningTarget = blockName
    miningActive = true
    bot.chat(`Voy a buscar ${blockName}. Minando sistemáticamente.`)
    miningLoop()
    return
  }

  if (message === 'stop') {
    miningActive    = false
    followingPlayer = false
    if (followInterval) clearInterval(followInterval)
    bot.pathfinder.setGoal(null)
    bot.chat('Parando.')
    return
  }

  // --- ordenes ---
  //que coma
  if (message === 'eat') {
    await eatFood()
    return
  }
  
  //que tenga en mano algo
  if (message.startsWith('hold ')) {
    const itemName = message.split(' ').slice(1).join(' ')
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) {
      bot.chat(`No tengo ${itemName} en el inventario.`)
      return
    }
    try {
      await bot.equip(item, 'hand')
      bot.chat(`Sosteniendo ${itemName}.`)
    } catch (err) {
      bot.chat(`No pude equipar ${itemName}: ${err.message}`)
    }
    return
  }

  //que cace mobs hostiles/que pare
  if (message === 'hunt') {
    huntingActive = true
    miningActive  = false
    followingPlayer = false
    if (followInterval) clearInterval(followInterval)
    bot.chat('Modo caza activado.')
    huntLoop()
    return
  }

  if (message === 'stop hunt') {
    huntingActive = false
    bot.pathfinder.setGoal(null)
    bot.chat('Modo caza desactivado.')
    return
  }

})//CIERRE DE MENSAJES DE CHAT

// =====================
//   FUNCIONES
// =====================

// =====================
//   INFORMACIÓN
// =====================
function reportPickaxes() {
  const allPickaxes = [
    'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
    'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'
  ]

  const found = []
  for (const name of allPickaxes) {
    const items = bot.inventory.items().filter(i => i.name === name)
    if (items.length) {
      const total = items.reduce((s, i) => s + i.count, 0)
      found.push(`${name}: ${total}`)
    }
  }

  if (!found.length) {
    bot.chat('No tengo ningún pico.')
    return
  }

  bot.chat('Picos en inventario:')
  found.forEach(line => bot.chat(line))

}

// =====================
//   EQUIPAMIENTO
// =====================

// ESPADAS
const SWORD_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword',     'golden_sword',  'wooden_sword'
]

//equipo espaditas
async function equipBestSword() {
  // Buscar la mejor espada disponible en inventario
  for (const swordName of SWORD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === swordName)
    if (item) {
      await bot.equip(item, 'hand')
      return swordName
    }
  }

  // Buscar en cofre
  if (chestLocation) {
    for (const swordName of SWORD_PRIORITY) {
      const found = await getItemFromChest(swordName, 1)
      if (found) {
        const item = bot.inventory.items().find(i => i.name === swordName)
        if (item) { await bot.equip(item, 'hand'); return swordName }
      }
    }
  }

  // Craftear stone_sword como último recurso
  bot.chat('No tengo espada. Intentando craftear stone_sword...')
  const crafted = await craftSword('stone_sword')
  if (crafted) {
    const item = bot.inventory.items().find(i => i.name === 'stone_sword')
    if (item) { await bot.equip(item, 'hand'); return 'stone_sword' }
  }

  return null
}

// CRAFTEO espaditas
async function craftSword(swordName) {
  const SWORD_MATERIAL = {
    'wooden_sword': 'oak_planks',
    'stone_sword':  'cobblestone',
    'iron_sword':   'iron_ingot',
    'golden_sword': 'gold_ingot',
    'diamond_sword':'diamond',
  }
  const material = SWORD_MATERIAL[swordName]
  if (!material) return false

  const count = (name) =>
    bot.inventory.items().filter(i => i.name === name).reduce((s,i) => s+i.count, 0)

  if (count(material) < 2) await getItemFromChest(material, 2)
  if (count('stick')   < 1) await getItemFromChest('stick',  1)

  if (count(material) < 2 || count('stick') < 1) {
    bot.chat(`Faltan materiales para ${swordName}.`)
    return false
  }

  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      craftingTableLocation.x,
      craftingTableLocation.y,
      craftingTableLocation.z, 2
    ))
    const tableBlock = bot.blockAt(bot.vec3(
      craftingTableLocation.x,
      craftingTableLocation.y,
      craftingTableLocation.z
    ))
    const itemId  = mcData.itemsByName[swordName].id
    const recipes = bot.recipesFor(itemId, null, 1, tableBlock)
    if (!recipes.length) return false
    await bot.craft(recipes[0], 1, tableBlock)
    bot.chat(`${swordName} crafteada!`)
    return true
  } catch { return false }
}

// ==ASEGURAR PICO==
async function ensurePickaxe(blockName) {
  const needed = PICKAXE_FOR_BLOCK[blockName] ?? 'wooden_pickaxe'
  if (bot.inventory.items().some(i => i.name === needed)) {
    await equipPickaxe(needed); return true
  }
  bot.chat(`Necesito un ${needed}. Buscando en el cofre...`)
  const fromChest = await getItemFromChest(needed, 1)
  if (fromChest) { await equipPickaxe(needed); return true }
  bot.chat(`No hay ${needed} en el cofre. Intentando craftear...`)
  const crafted = await craftPickaxe(needed)
  if (crafted) { await equipPickaxe(needed); return true }
  bot.chat(`No tengo materiales para craftear un ${needed}. Abortando.`)
  return false
}

async function equipPickaxe(name) {
  const item = bot.inventory.items().find(i => i.name === name)
  if (item) await bot.equip(item, 'hand')
}

// ==CRAFTEAR PICO==
async function craftPickaxe(pickaxeName) {
  const material = PICKAXE_MATERIAL[pickaxeName]
  if (!material) return false

  const count = (items, name) =>
    items.filter(i => i.name === name).reduce((s, i) => s + i.count, 0)

  if (count(bot.inventory.items(), material) < 3)
    await getItemFromChest(material, 3)
  if (count(bot.inventory.items(), 'stick') < 2)
    await getItemFromChest('stick', 2)

  if (count(bot.inventory.items(), material) < 3 ||
      count(bot.inventory.items(), 'stick')   < 2) {
    bot.chat('Faltan materiales para craftear.')
    return false
  }

  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      craftingTableLocation.x,
      craftingTableLocation.y,
      craftingTableLocation.z, 2
    ))
    const tableBlock = bot.blockAt(bot.vec3(
      craftingTableLocation.x,
      craftingTableLocation.y,
      craftingTableLocation.z
    ))
    const itemId  = mcData.itemsByName[pickaxeName].id
    const recipes = bot.recipesFor(itemId, null, 1, tableBlock)
    if (!recipes.length) { bot.chat(`No encontré receta para ${pickaxeName}.`); return false }
    await bot.craft(recipes[0], 1, tableBlock)
    bot.chat(`${pickaxeName} crafteado!`)
    return true
  } catch (err) {
    bot.chat(`Error al craftear: ${err.message}`)
    return false
  }
}

// =====================
//   ACCIONES
// =====================
// --- COMIDA ---
// que coma lo que lo llena mas
const FOOD_PRIORITY = [
  'golden_carrot',        // 6 saciedad — el mejor
  'cooked_porkchop',
  'cooked_beef',
  'cooked_mutton',
  'cooked_salmon',
  'cooked_chicken',
  'cooked_cod',
  'bread',
  'baked_potato',
  'carrot',
  'apple',
  'melon_slice',
  'cookie',
  'raw_beef',
  'raw_porkchop',
  'raw_mutton',
  'raw_chicken',
  'raw_salmon',
  'raw_cod',
  'rotten_flesh',         // último recurso
]
//que coma
async function eatFood() {
  if (bot.food >= 20) {
    bot.chat('No tengo hambre.')
    return
  }

  // Buscar en inventario primero
  let foodItem = null
  for (const foodName of FOOD_PRIORITY) {
    foodItem = bot.inventory.items().find(i => i.name === foodName)
    if (foodItem) break
  }

  // Si no tiene nada, buscar en el cofre
  if (!foodItem) {
    if (!chestLocation) {
      bot.chat('No tengo comida y no hay cofre registrado.')
      return
    }

    bot.chat('No tengo comida. Buscando en el cofre...')

    // Ir al cofre y buscar cualquier alimento disponible
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        chestLocation.x, chestLocation.y, chestLocation.z, 2
      ))
      const chest = await bot.openChest(
        bot.blockAt(bot.vec3(chestLocation.x, chestLocation.y, chestLocation.z))
      )

      // Buscar el mejor alimento disponible en el cofre
      let withdrawn = false
      for (const foodName of FOOD_PRIORITY) {
        const chestItem = chest.containerItems().find(i => i.name === foodName)
        if (chestItem) {
          // Sacar hasta 16 unidades para no quedarse sin nada rápido
          const amount = Math.min(chestItem.count, 16)
          await chest.withdraw(chestItem.type, null, amount)
          bot.chat(`Saqué ${amount}x ${foodName} del cofre.`)
          withdrawn = true
          break
        }
      }

      chest.close()

      if (!withdrawn) {
        bot.chat('No hay comida en el cofre tampoco.')
        return
      }

      // Buscar en inventario de nuevo después de sacar del cofre
      for (const foodName of FOOD_PRIORITY) {
        foodItem = bot.inventory.items().find(i => i.name === foodName)
        if (foodItem) break
      }

    } catch (err) {
      bot.chat(`No pude acceder al cofre: ${err.message}`)
      return
    }
  }

  if (!foodItem) {
    bot.chat('No encontré comida en ningún lado.')
    return
  }

  try {
    await bot.equip(foodItem, 'hand')
    await bot.consume()
    bot.chat(`Comí ${foodItem.name}. Hambre: ${Math.round(bot.food)}/20`)
  } catch (err) {
    bot.chat(`No pude comer: ${err.message}`)
  }
}


// =====================
//   SEGUIR JUGADOR
// =====================
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)

  followInterval = setInterval(() => {
    if (!followingPlayer) { clearInterval(followInterval); return }

    const target = bot.players[username]?.entity
    if (!target) return

    bot.pathfinder.setGoal(new goals.GoalNear(
      target.position.x,
      target.position.y,
      target.position.z,
      3  // se mantiene a 3 bloques
    ), true)
  }, 500)
}



async function huntLoop() {
  // Equipar espada antes de salir
  const sword = await equipBestSword()
  if (!sword) {
    bot.chat('No tengo espada ni materiales. Abortando caza.')
    huntingActive = false
    return
  }
  bot.chat(`Cazando con ${sword}.`)

  while (huntingActive) {
    // Salud baja → retirarse a curar
    if (bot.health <= 8) {
      bot.chat('Vida baja, retrocediendo...')
      await eatFood()
      await bot.waitForTicks(40)  // esperar regeneración
      continue
    }

    // Hambre baja → comer antes de seguir
    if (bot.food <= 8) {
      await eatFood()
    }

    // Buscar mob hostil más cercano
    const mob = getNearestHostile(24)

    if (!mob) {
      // No hay mobs cerca → patrullar
      await patrol()
      continue
    }

    // Atacar
    await fightMob(mob)
  }
}

// =====================
//   CAZAR
// =====================

// ==OBTENER MOB MÁS CERCANO==
function getNearestHostile(maxDistance) {
  return Object.values(bot.entities)
    .filter(e =>
      e.type === 'mob' &&
      HOSTILE_MOBS.includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < maxDistance
    )
    .sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    )[0] ?? null
}

// ==COMBATE==
async function fightMob(mob) {
  bot.chat(`Atacando ${mob.name}.`)

  while (
    huntingActive &&
    mob.isValid &&
    bot.health > 4
  ) {
    // Acercarse
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        mob.position.x,
        mob.position.y,
        mob.position.z,
        2
      ))
    } catch {
      break
    }

    // Atacar
    try {
      await bot.attack(mob)
    } catch {
      break
    }

    // Cooldown de espada — 1 tick por golpe crítico (caída libre)
    await bot.waitForTicks(12)

    // Comer si hace falta mid-combate
    if (bot.food <= 6) await eatFood()
  }

  if (!mob.isValid) {
    bot.chat(`${mob.name} eliminado.`)
  } else if (bot.health <= 4) {
    bot.chat('Vida crítica, retirándome!')
    bot.pathfinder.setGoal(null)
  }
}

// ==PATRULLAR (sin mobs cerca)==
async function patrol() {
  const pos  = bot.entity.position
  const dist = 16
  const dx   = (Math.random() - 0.5) * 2 * dist
  const dz   = (Math.random() - 0.5) * 2 * dist

  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      pos.x + dx,
      pos.y,
      pos.z + dz,
      2
    ))
  } catch {
    await bot.waitForTicks(10)
  }
}

// =====================
//   MINAR
// =====================
async function miningLoop() {
  bot.chat("DEBUG entro a miningLoop()")
  console.log("Entro a miningLoop()")
  const at = bot.entity.position
  bot.chat("Estoy en la altura "+Math.floor(at.y)+". Limpio el chunk excepto un bloque!")
  const searchRange = 64

  while (miningActive) {
    // Inventario lleno → depositar
    // se van llenando 36 slots, cuando tengo un stack completo voy y deposito
    if (bot.inventory.emptySlotCount() < 35) {
      console.log("estoy casi lleno, deposito")
      bot.chat("DEBUG 2 trato de depositar el stack que junté")
      await depositInChest()
      if (!miningActive) break
    }

    // Buscar bloque en chunks cargados
    const block = bot.findBlock({
      matching:    mcData.blocksByName[miningTarget].id,
      maxDistance: searchRange
    })

    if (block && !hasLavaNearby(block.position)) {
      // Encontró uno → minar
      bot.chat("DEBUG 3 encontré lo que me pediste")
      try {
        await bot.pathfinder.goto(new goals.GoalNear(
          block.position.x, block.position.y, block.position.z, 1
        ))
        await bot.dig(block)
      } catch {
        await bot.waitForTicks(5)
      }
    } else {
      // No encontró → moverse en espiral para cargar nuevos chunks
      bot.chat(`No veo ${miningTarget} cerca. Explorando...`)
      await mineChunkSystematically(bot.chunkX, bot.chunkZ, bot.pos.y-1)
    }
  }
}

// ==COFRE: SACAR==
async function getItemFromChest(itemName, count) {
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      chestLocation.x, chestLocation.y, chestLocation.z, 2
    ))
    const chest = await bot.openChest(
      bot.blockAt(bot.vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    )
    const item = chest.containerItems().find(i => i.name === itemName)
    if (!item) { chest.close(); return false }
    await chest.withdraw(item.type, null, Math.min(item.count, count))
    chest.close()
    return true
  } catch { return false }
}



// ==MINAR CHUNK EN SERPENTINA==
async function mineChunkSystematically(chunkX, chunkZ, targetY) {
  const startX = chunkX + 16
  const startZ = chunkZ + 16
  let   found  = false

  // Recorre el chunk en patrón serpentina:
  // fila 0: Z=startZ, X de 0 a 15
  // fila 1: Z=startZ+1, X de 15 a 0
  // ... y así hasta Z=startZ+15
  for (let dz = 0; dz < 16; dz++) {
    if (!miningActive) break

    const zPos   = startZ + dz
    const xRange = Array.from({ length: 16 }, (_, i) => startX + i)
    // Invertir cada fila impar → serpentina
    const xRow   = dz % 2 === 0 ? xRange : xRange.reverse()

    for (const xPos of xRow) {
      if (!miningActive) break

      // Inventario lleno → depositar y volver
      if (bot.inventory.emptySlotCount() < 4) {
        await depositInChest()
        if (!miningActive) return found
        await bot.pathfinder.goto(new goals.GoalNear(xPos, targetY, zPos, 2))
      }

      // Navegar a esta celda del chunk
      try {
        await bot.pathfinder.goto(new goals.GoalNear(xPos, targetY, zPos, 1))
      } catch {
        continue
      }

      // Minar bloques en una columna vertical ±2 desde targetY
      // Así cubre variaciones de vena en Y
      for (let dy = -2; dy <= 2; dy++) {
        const checkY = targetY + dy
        const block  = bot.blockAt(bot.vec3(xPos, checkY, zPos))

        if (!block) continue

        // Es el bloque que buscamos?
        if (block.name === miningTarget) {
          if (hasLavaNearby(block.position)) {
            bot.chat('Lava cerca, esquivando.')
            continue
          }
          try {
            await bot.dig(block)
            found = true
          } catch {}
        }

        // También mina roca para avanzar si está bloqueado
        if (['stone', 'deepslate', 'tuff', 'andesite',
             'diorite', 'granite', 'gravel', 'dirt'].includes(block.name)) {
          try { await bot.dig(block) } catch {}
        }
      }
    }
  }

  return found
}

// ==COFRE: DEPOSITAR==
async function depositInChest() {
  bot.chat('Yendo al cofre...')
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      chestLocation.x, chestLocation.y, chestLocation.z, 2
    ))
    const chest = await bot.openChest(
      bot.blockAt(bot.vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    )
    for (const item of bot.inventory.items()) {
      if (item.name.includes('pickaxe') || item.name.includes('sword')) continue
      try { await chest.deposit(item.type, null, item.count) } catch {}
    }
    chest.close()
    bot.chat('Depositado.')
  } catch (err) {
    bot.chat(`No pude depositar: ${err.message}`)
  }
}

// =====================
//   HELPERS DE CHUNK
// =====================
function worldToChunk(x, z) {
  return {
    x: Math.floor(x / 16),
    z: Math.floor(z / 16)
  }
}

// =====================
//   LAVA NEARBY
// =====================
function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    return b && (b.name === 'lava' || b.name === 'flowing_lava')
  })
}

bot.on('error', err => console.error('❌ Error:', err))
bot.on('end',   ()  => console.log('🔌 Bot desconectado'))