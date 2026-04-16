// =====================
//   BOT COMERCIANTE - BASE
// =====================
// Este bot es la base para el comerciante aldeano.
// Iteración 0: movimiento, comida, depósito, dormir, exploración básica y defensa.

const fs = require('fs')
const Vec3 = require('vec3')
require('dotenv').config()
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcData = require('minecraft-data')('1.21.1')

const MASTER = process.env.MC_MASTER ?? 'gonsalomon'

const bot = mineflayer.createBot({
  host: process.env.MC_HOST ?? 'localhost',
  port: parseInt(process.env.MC_PORT) ?? 25565,
  username: process.env.MC_USERNAME ?? 'comerciante',
  version: process.env.MC_VERSION ?? '1.21.1'
})

bot.loadPlugin(pathfinder)

// ===================== CONSTANTES =====================
const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'bread',
  'apple', 'carrot', 'baked_potato', 'cooked_mutton', 'cooked_chicken',
  'cooked_salmon', 'cooked_cod'
]

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'hoglin', 'wither_skeleton', 'enderman', 'silverfish',
  'phantom', 'drowned', 'husk', 'stray'
]

const VILLAGE_BLOCKS = new Set([
  'bed', 'cartography_table', 'lectern', 'composter', 'blast_furnace',
  'smoker', 'loom', 'grindstone', 'stonecutter', 'barrel',
  'fletching_table', 'smithing_table', 'bell'
])

const VILLAGE_RADIUS = 64 // Radio de búsqueda en bloques

// ===================== ESTADO GLOBAL =====================
let chestLocation = null
let craftingTableLocation = null
let bedLocation = null
let villageLocation = null
let villageBedLocation = null
let villagerTrades = {} // Almacena trades por UUID de aldeano
let explorationActive = false
let followingPlayer = false
let followInterval = null
let autoFollowEnabled = true
let pathfindingLock = false
let pendingGoal = null
let isEating = false
let dodgeInterval = null

const STATE_FILE = './trader_state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation = data.chestLocation ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    bedLocation = data.bedLocation ?? null
    villageLocation = data.villageLocation ?? null
    villageBedLocation = data.villageBedLocation ?? null
    villagerTrades = data.villagerTrades ?? {}
    console.log('📂 Estado cargado:', data)
  } catch {
    console.log('📂 Sin estado previo')
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, bedLocation, villageLocation, villageBedLocation, villagerTrades }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

// ===================== UTILIDADES =====================
function sendPrivateMessage(message) {
  if (MASTER && bot.players[MASTER]) {
    bot.chat(`/tell ${MASTER} ${message}`)
  } else {
    console.log(`[No enviado a ${MASTER}]: ${message}`)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function safeSetGoal(goal, priority = false) {
  if (pathfindingLock) {
    pendingGoal = { goal, priority }
    return false
  }
  try {
    pathfindingLock = true
    bot.pathfinder.setGoal(goal, priority)
    return true
  } catch (err) {
    console.error('safeSetGoal error:', err)
    return false
  } finally {
    setTimeout(() => {
      pathfindingLock = false
      if (pendingGoal) {
        const { goal, priority } = pendingGoal
        pendingGoal = null
        safeSetGoal(goal, priority)
      }
    }, 1000)
  }
}

async function safeGoto(x, y, z, range = 2) {
  let waited = 0
  while (pathfindingLock && waited < 30) {
    await sleep(100)
    waited++
  }
  if (pathfindingLock) {
    console.log('⚠️ pathfindingLock timeout en safeGoto, forzando reset')
    pathfindingLock = false
    if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null)
    await sleep(50)
  }

  if (bot.pathfinder?.goal) {
    bot.pathfinder.setGoal(null)
    await sleep(50)
  }

  // Detectar bloques protegidos alrededor del destino
  const protectedBlocks = detectProtectedBlocks(x, y, z, 16)
  setSprintMode(false, protectedBlocks)
  try {
    pathfindingLock = true
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
  } catch (err) {
    if (err.message?.includes('GoalChanged')) {
      console.log('🔄 GoalChanged ignorado, reintentando...')
      await sleep(100)
      try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
      } catch (e) {
        if (!e.message?.includes('GoalChanged')) throw e
      }
    } else if (err.message?.includes('Timeout')) {
      console.log('⏱️ Timeout en pathfinder, reintentando una vez...')
      await sleep(500)
      try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
      } catch (e) {
        if (!e.message?.includes('Timeout')) throw e
      }
    } else if (!err.message?.includes('GoalChanged')) {
      throw err
    }
  } finally {
    // Al final, volver al modo sprint pero permitiendo bloques protegidos
    const protectedBlocks = detectProtectedBlocks(x, y, z, 16)
    setSprintMode(true, protectedBlocks)
    pathfindingLock = false
  }
}

function detectProtectedBlocks(posX, posY, posZ, radius = 16) {
  const protectedBlocks = new Set()
  for (let x = posX - radius; x <= posX + radius; x++) {
    for (let y = Math.max(0, posY - 5); y <= Math.min(255, posY + 5); y++) {
      for (let z = posZ - radius; z <= posZ + radius; z++) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (block && VILLAGE_BLOCKS.has(block.name)) {
          protectedBlocks.add(block.name)
        }
      }
    }
  }
  return protectedBlocks
}

function setSprintMode(enabled, forbiddenBlocks = new Set()) {
  const movements = new Movements(bot)
  movements.allowSprinting = enabled
  movements.allowParkour = true
  movements.allowSneaking = true
  movements.allowBreakingBlocks = false   // NUNCA romper bloques

  // No romper bloques prohibidos de protección
  if (forbiddenBlocks.size > 0) {
    movements.blocksToAvoid.clear()
    for (const blockName of forbiddenBlocks) {
      const blockId = mcData.blocksByName[blockName]?.id
      if (blockId !== undefined) {
        movements.blocksToAvoid.add(blockId)
      }
    }
  }

  bot.pathfinder.setMovements(movements)
}

// ===================== COMIDA Y SALUD =====================
function findBestFood() {
  for (const name of FOOD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  return null
}

async function getFoodFromChest() {
  if (!chestLocation) return false
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
  const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
  if (!chestBlock || !chestBlock.name.includes('chest')) return false
  const chest = await bot.openChest(chestBlock)
  let found = false
  for (const name of FOOD_PRIORITY) {
    const item = chest.containerItems().find(i => i.name === name)
    if (item) {
      await chest.withdraw(item.type, null, Math.min(item.count, 16))
      found = true
      break
    }
  }
  chest.close()
  return found
}

async function eatFood() {
  if (isEating) return
  isEating = true
  try {
    let food = findBestFood()
    if (!food && chestLocation) {
      const got = await getFoodFromChest()
      if (got) food = findBestFood()
    }
    if (!food) {
      sendPrivateMessage('⚠️ No tengo comida. Necesito más.')
      return
    }
    await bot.equip(food, 'hand')
    await bot.consume()
    await sleep(500)
  } catch (err) {
    console.error('Error comiendo:', err)
  } finally {
    isEating = false
  }
}

async function checkHealthAndHunger() {
  if (bot.food < 18 || bot.health < 14) {
    await eatFood()
  }
}

// ===================== DEPÓSITO EN COFRE =====================
function getInventoryHash() {
  return bot.inventory.items()
    .filter(i => !i.name.includes('pickaxe') && !i.name.includes('sword') && !FOOD_PRIORITY.includes(i.name))
    .map(i => `${i.name}:${i.count}`)
    .sort()
    .join('|')
}

async function getItemFromChest(itemName, count) {
  if (!chestLocation) return false
  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) return false
    const chest = await bot.openChest(chestBlock)
    const item = chest.containerItems().find(i => i.name === itemName)
    if (!item) {
      chest.close()
      return false
    }
    await chest.withdraw(item.type, null, Math.min(item.count, count))
    chest.close()
    return true
  } catch {
    return false
  }
}

const depositState = { active: false, lastRun: 0, lastInventoryHash: null, cooldown: 5000 }

async function depositInChest() {
  if (!chestLocation) { sendPrivateMessage('⚠️ No hay cofre registrado.'); return }
  if (depositState.active) { while (depositState.active) await sleep(50); return }

  const currentHash = getInventoryHash()
  if (currentHash !== '' && currentHash === depositState.lastInventoryHash) {
    console.log('📦 Inventario sin cambios, salteando.')
    return
  }

  const now = Date.now()
  if (now - depositState.lastRun < depositState.cooldown) {
    await sleep(depositState.cooldown - (now - depositState.lastRun))
  }

  depositState.active = true
  depositState.lastRun = Date.now()

  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) {
      sendPrivateMessage('No encuentro el cofre.')
      return
    }

    const keepTypes = new Set()
    for (const item of bot.inventory.items()) {
      const isFood = FOOD_PRIORITY.includes(item.name) && bot.food < 18
      const isTool = item.name.includes('pickaxe') || item.name.includes('sword') || item.name.includes('axe')
      if (isFood || isTool) keepTypes.add(item.type)
    }

    const chest = await bot.openChest(chestBlock)
    let depositedCount = 0
    for (const item of bot.inventory.items()) {
      if (keepTypes.has(item.type)) continue
      await chest.deposit(item.type, null, item.count)
      depositedCount += item.count
    }
    chest.close()

    if (depositedCount > 0) sendPrivateMessage(`✅ Depositados ${depositedCount} items`)
    depositState.lastInventoryHash = getInventoryHash()
  } catch (err) {
    if (!err.message?.includes('GoalChanged')) console.error('depositInChest error:', err)
  } finally {
    depositState.active = false
  }
}

// ===================== INTERACCIÓN CON ALDEANOS =====================

function getNearestVillager(maxDistance = 64, profession = null) {
  let nearest = null
  let minDist = maxDistance

  Object.values(bot.entities).forEach(entity => {
    if (entity.name === 'villager' || entity.name === 'villager_v2') {
      if (profession && entity.metadata && entity.metadata[18]) {
        const professionData = entity.metadata[18]
        if (professionData.profession !== profession) return
      }
      // Saltar nitwit o sin oficio
      if (entity.metadata && entity.metadata[18]) {
        const professionData = entity.metadata[18]
        if (professionData.profession === 'none' || professionData.profession === 'nitwit') {
          return
        }
      }
      const dist = entity.position.distanceTo(bot.entity.position)
      if (dist < minDist) {
        minDist = dist
        nearest = entity
      }
    }
  })
  return nearest
}

/**
 * Obtiene los trades de un aldeano de forma fiable (sin eventos, con reintentos).
 */
async function fetchVillagerTrades(villagerEntity) {
  let villagerWindow = null
  let trades = null
  let attempts = 0

  while (attempts < 3 && (!trades || trades.length === 0)) {
    try {
      villagerWindow = await bot.openVillager(villagerEntity)
      // Dar tiempo a que carguen los trades (aumentado a 200ms para mayor seguridad)
      await sleep(200)
      trades = villagerWindow.trades
      if (trades && trades.length > 0) {
        return { trades, window: villagerWindow }
      }
      // Si no hay trades, cerrar y reintentar
      villagerWindow.close()
      await sleep(500)
      attempts++
    } catch (err) {
      console.error(`Intento ${attempts+1} fallido:`, err.message)
      if (villagerWindow) villagerWindow.close()
      attempts++
      await sleep(1000)
    }
  }
  return { trades: null, window: null }
}

async function readVillagerTrades(profession = null) {
  const villager = getNearestVillager(64, profession)
  if (!villager) {
    sendPrivateMessage(`❌ No hay aldeanos${profession ? ` ${profession}` : ' con oficio'} cerca.`)
    return
  }

  try {
    await safeGoto(villager.position.x, villager.position.y, villager.position.z, 2)
    await sleep(500)

    const { trades, window } = await fetchVillagerTrades(villager)
    if (!trades || trades.length === 0) {
      sendPrivateMessage(`❌ No se pudieron obtener trades después de 3 intentos.`)
      return
    }

    villagerTrades[villager.id] = trades
    saveState()
    sendPrivateMessage(`✅ Aldeano registrado con ${trades.length} ofertas.`)
    if (window) window.close()
  } catch (err) {
    console.error('Error leyendo trades:', err.message)
    sendPrivateMessage(`❌ Error: ${err.message}`)
  }
}

async function investigateAllVillagers() {
  // Obtener todos los aldeanos con oficio en radio 64
  const villagers = Object.values(bot.entities).filter(e => {
    if (e.name !== 'villager' && e.name !== 'villager_v2') return false
    if (!e.metadata || !e.metadata[18]) return false
    const prof = e.metadata[18].profession
    return prof !== 'none' && prof !== 'nitwit'
  })

  if (villagers.length === 0) {
    sendPrivateMessage('❌ No hay aldeanos con oficio en radio de 64 bloques.')
    return
  }

  sendPrivateMessage(`🔍 Investigando ${villagers.length} aldeanos con oficio...`)
  let registered = 0
  let skippedErrors = 0

  for (let i = 0; i < villagers.length; i++) {
    const villager = villagers[i]
    const dist = villager.position.distanceTo(bot.entity.position)
    console.log(`[${i + 1}/${villagers.length}] Investigando aldeano a ${Math.floor(dist)} bloques...`)

    try {
      // Intentar llegar al aldeano con timeout
      await Promise.race([
        safeGoto(villager.position.x, villager.position.y, villager.position.z, 3),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      ])
      
      await sleep(500)

      const { trades, window } = await fetchVillagerTrades(villager)
      if (trades && trades.length > 0) {
        villagerTrades[villager.id] = trades
        registered++
        console.log(`✅ Aldeano ${i+1}: ${trades.length} trades`)
      } else {
        console.log(`⚠️ Aldeano ${i+1}: sin trades`)
      }
      if (window) window.close()
    } catch (err) {
      console.error(`Error con aldeano ${i+1}:`, err.message)
      skippedErrors++
      // Intentar cancelar pathfinding si hay error
      try {
        bot.pathfinder.setGoal(null)
      } catch {}
    }

    // Delay más largo entre aldeanos para no sobrecargar
    if (i < villagers.length - 1) await sleep(1500)
  }

  saveState()
  sendPrivateMessage(`📊 Investigación completada: ${registered}/${villagers.length} registrados (${skippedErrors} con errores). Usa 'trades' para ver.`)
}

// ===================== ALDEA =====================
async function findVillage() {
  const startX = Math.floor(bot.entity.position.x)
  const startY = Math.floor(bot.entity.position.y)
  const startZ = Math.floor(bot.entity.position.z)

  const beds = []
  const workBlocks = []
  const bells = []
  const villagers = []

  sendPrivateMessage('🔍 Buscando aldea en radio de 64 bloques...')

  for (let x = startX - VILLAGE_RADIUS; x <= startX + VILLAGE_RADIUS; x++) {
    for (let z = startZ - VILLAGE_RADIUS; z <= startZ + VILLAGE_RADIUS; z++) {
      for (let y = Math.max(0, startY - 10); y <= Math.min(255, startY + 10); y++) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (!block) continue
        if (block.name === 'bed') {
          beds.push({ x, y, z })
        } else if (VILLAGE_BLOCKS.has(block.name)) {
          if (block.name === 'bell') {
            bells.push({ x, y, z })
          } else {
            workBlocks.push({ x, y, z })
          }
        }
      }
    }
  }

  Object.values(bot.entities).forEach(entity => {
    if (entity.type === 'mob' && (entity.name === 'villager' || entity.name === 'villager_v2')) {
      const dist = entity.position.distanceTo(bot.entity.position)
      if (dist <= VILLAGE_RADIUS) villagers.push(entity)
    }
  })

  const totalIndicators = beds.length + workBlocks.length + bells.length + villagers.length
  if (totalIndicators < 3) {
    sendPrivateMessage('❌ No encontré suficientes indicadores de aldea.')
    return false
  }

  const allPoints = [...beds, ...workBlocks, ...bells, ...villagers.map(v => v.position)]
  const centerX = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length
  const centerY = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length
  const centerZ = allPoints.reduce((sum, p) => sum + p.z, 0) / allPoints.length

  villageLocation = { x: Math.floor(centerX), y: Math.floor(centerY), z: Math.floor(centerZ) }

  let nearestBed = null
  let minDist = Infinity
  for (const bed of beds) {
    const dist = Math.sqrt((bed.x - centerX) ** 2 + (bed.z - centerZ) ** 2)
    if (dist < minDist) {
      minDist = dist
      nearestBed = bed
    }
  }
  villageBedLocation = nearestBed

  saveState()
  sendPrivateMessage(`🏘️ Aldea encontrada en ${villageLocation.x} ${villageLocation.y} ${villageLocation.z}`)
  sendPrivateMessage(`🛏️ Cama de aldea: ${villageBedLocation ? `${villageBedLocation.x} ${villageBedLocation.y} ${villageBedLocation.z}` : 'ninguna'}`)
  return true
}

// ===================== EXPLORACIÓN =====================
async function exploreChunks() {
  if (!explorationActive) return
  const cx = Math.floor(bot.entity.position.x / 16)
  const cz = Math.floor(bot.entity.position.z / 16)
  const nextX = cx + (Math.random() > 0.5 ? 1 : -1)
  const nextZ = cz + (Math.random() > 0.5 ? 1 : -1)
  await safeGoto(nextX * 16 + 8, bot.entity.position.y, nextZ * 16 + 8, 8)
  setTimeout(() => { if (explorationActive) exploreChunks() }, 5000)
}

function startExploration() {
  if (explorationActive) return
  explorationActive = true
  exploreChunks()
}

function stopExploration() {
  explorationActive = false
}

// ===================== DEFENSA Y ESQUIVA =====================
function getNearestHostile(maxDistance) {
  return Object.values(bot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < maxDistance)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
}

function startDodgeSystem() {
  if (dodgeInterval) clearInterval(dodgeInterval)
  dodgeInterval = setInterval(async () => {
    const mob = getNearestHostile(8)
    if (!mob) return
    const wasExploring = explorationActive
    const wasFollowing = followingPlayer
    if (wasExploring) { explorationActive = false; bot.pathfinder.setGoal(null) }
    if (wasFollowing) { followingPlayer = false; if (followInterval) clearInterval(followInterval); followInterval = null; bot.pathfinder.setGoal(null) }
    try { await dodgeMob(mob) } catch (err) { console.error('Error en dodge:', err) }
    finally {
      if (wasExploring && !wasFollowing) { explorationActive = true; exploreChunks() }
      if (wasFollowing) { followingPlayer = true; startFollowing() }
    }
  }, 500)
}

async function dodgeMob(mob) {
  const pos = bot.entity.position
  const mobPos = mob.position
  const dx = pos.x - mobPos.x
  const dz = pos.z - mobPos.z
  const len = Math.sqrt(dx * dx + dz * dz) || 1
  const flee = new Vec3(pos.x + (dx / len) * 8, pos.y, pos.z + (dz / len) * 8)
  await safeSetGoal(new goals.GoalNear(flee.x, flee.y, flee.z, 2), true)
}

// ===================== DORMIR =====================
async function sleepInBed() {
  let bedLoc = bedLocation || villageBedLocation
  if (!bedLoc) {
    sendPrivateMessage('❌ No hay cama registrada (ni personal ni de aldea).')
    return
  }
  await safeGoto(bedLoc.x, bedLoc.y, bedLoc.z, 2)
  const bed = bot.blockAt(new Vec3(bedLoc.x, bedLoc.y, bedLoc.z))
  if (!bed?.name.includes('bed')) {
    sendPrivateMessage('❌ No encuentro la cama.')
    return
  }
  try {
    await bot.sleep(bed)
    sendPrivateMessage('💤 Durmiendo...')
    bot.once('wake', () => sendPrivateMessage('☀️ Buenos días!'))
  } catch (err) {
    sendPrivateMessage(`❌ No puedo dormir: ${err.message}`)
  }
}

// ===================== SEGUIMIENTO =====================
function startFollowing() {
  if (followInterval) clearInterval(followInterval)
  followingPlayer = true
  followInterval = setInterval(() => {
    const target = bot.players[MASTER]?.entity
    if (!target) return
    if (target.position.distanceTo(bot.entity.position) > 3) {
      safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
    }
  }, 1000)
}

function stopFollowing() {
  followingPlayer = false
  if (followInterval) clearInterval(followInterval)
  followInterval = null
  try { bot.pathfinder.setGoal(null) } catch {}
}

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const parts = message.split(' ')
  const cmd = parts[0].toLowerCase()

  if (cmd === 'aiuda' || cmd === 'help') {
    sendPrivateMessage('📋 COMANDOS COMERCIANTE:')
    sendPrivateMessage('🚶 explora, explorar, sigue, bancá, quieto, auto')
    sendPrivateMessage('🏘️ busca aldea, ofertas, averiguar, trades, entidades, dormi, cofre x y z, cama x y z, mesa x y z')
    sendPrivateMessage('📦 deposita, pos, salud, data')
    return
  }

  if (cmd === 'pos') {
    const p = bot.entity.position
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
    return
  }

  if (cmd === 'salud') {
    sendPrivateMessage(`❤️ Vida:${Math.round(bot.health)}/20 🍗 Hambre:${Math.round(bot.food)}/20`)
    return
  }

  if (cmd === 'data') {
    sendPrivateMessage(`📦 Cofre: ${chestLocation ? `${chestLocation.x} ${chestLocation.y} ${chestLocation.z}` : 'no'}`)
    sendPrivateMessage(`🛏️ Cama: ${bedLocation ? `${bedLocation.x} ${bedLocation.y} ${bedLocation.z}` : 'no'}`)
    sendPrivateMessage(`🏘️ Aldea: ${villageLocation ? `${villageLocation.x} ${villageLocation.y} ${villageLocation.z}` : 'no'}`)
    sendPrivateMessage(`🛏️ Cama aldea: ${villageBedLocation ? `${villageBedLocation.x} ${villageBedLocation.y} ${villageBedLocation.z}` : 'no'}`)
    return
  }

  if (cmd === 'cofre' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    chestLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cofre guardado en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'mesa' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    craftingTableLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Mesa guardada en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'cama' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    bedLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cama guardada en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'explora' || cmd === 'explorar') {
    if (explorationActive) {
      stopExploration()
      sendPrivateMessage('🛑 Exploración detenida.')
    } else {
      startExploration()
      sendPrivateMessage('🧭 Exploración iniciada.')
    }
    return
  }

  if (cmd === 'seguime' || cmd === 'sigue') {
    autoFollowEnabled = true
    startFollowing()
    sendPrivateMessage('🏃 Siguiendo al maestro...')
    return
  }

  if (cmd === 'quieto' || cmd === 'bancá' || cmd === 'banca') {
    autoFollowEnabled = false
    stopFollowing()
    sendPrivateMessage('🚫 Me quedo quieto.')
    return
  }

  if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo auto ACTIVADO' : '❌ Modo auto DESACTIVADO')
    if (autoFollowEnabled && !followingPlayer) startFollowing()
    return
  }

  if (cmd === 'deposita') {
    await depositInChest()
    return
  }

  if (cmd === 'busca aldea') {
    await findVillage()
    return
  }

  if (cmd === 'ofertas') {
    const profession = parts.length > 1 ? parts[1] : null
    await readVillagerTrades(profession)
    return
  }

  if (cmd === 'averiguar') {
    await investigateAllVillagers()
    return
  }

  if (cmd === 'dormi') {
    await sleepInBed()
    return
  }

  if (cmd === 'trades') {
    const uuids = Object.keys(villagerTrades)
    if (uuids.length === 0) {
      sendPrivateMessage('❌ No hay aldeanos registrados. Usa "ofertas" para registrar uno.')
      return
    }
    if (parts.length === 1) {
      sendPrivateMessage(`📜 Aldeanos registrados (${uuids.length}):`)
      uuids.forEach((uuid, index) => {
        const trades = villagerTrades[uuid]
        sendPrivateMessage(`  ${index + 1}. UUID: ${uuid.slice(-8)} - ${trades.length} ofertas`)
      })
      sendPrivateMessage('Usa "trades <número>" para ver detalles de uno.')
    } else {
      const num = parseInt(parts[1]) - 1
      if (isNaN(num) || num < 0 || num >= uuids.length) {
        sendPrivateMessage('❌ Número inválido.')
        return
      }
      const uuid = uuids[num]
      const trades = villagerTrades[uuid]
      sendPrivateMessage(`📜 Ofertas del aldeano ${num + 1} (UUID: ${uuid.slice(-8)}):`)
      for (let i = 0; i < trades.length; i += 3) {
        const batch = trades.slice(i, i + 3)
        batch.forEach((trade, index) => {
          const input1 = trade.inputItem1 ? `${trade.inputItem1.count}x ${trade.inputItem1.name}` : '?'
          const input2 = trade.inputItem2 ? ` + ${trade.inputItem2.count}x ${trade.inputItem2.name}` : ''
          const output = trade.outputItem ? `${trade.outputItem.count}x ${trade.outputItem.name}` : '?'
          const uses = `${trade.uses}/${trade.maxUses}`
          const xp = trade.xp || 0
          sendPrivateMessage(`  ${i + index + 1}. ${input1}${input2} → ${output} (usos: ${uses}, XP: ${xp})`)
        })
        if (i + 3 < trades.length) await sleep(1000)
      }
    }
    return
  }

  if (cmd === 'entidades') {
    const entities = Object.values(bot.entities).filter(e => e.position.distanceTo(bot.entity.position) < 32)
    const counts = {}
    entities.forEach(e => {
      counts[e.name] = (counts[e.name] || 0) + 1
    })
    const summary = Object.entries(counts).map(([name, count]) => `${count}x ${name}`).join(', ')
    sendPrivateMessage(`📋 Entidades cercanas: ${summary || 'ninguna'}`)
    return
  }

  sendPrivateMessage('❌ Comando desconocido. Usa "aiuda" para ver comandos.')
}

// ===================== EVENTOS =====================
bot.on('spawn', () => {
  console.log('✅ Bot comerciante conectado')
  sendPrivateMessage('🛒 Bot comerciante listo. Usa "aiuda" para comandos.')

  // Configurar movements base (NUNCA romper bloques)
  const movements = new Movements(bot)
  movements.allowSprinting = true
  movements.allowParkour = true
  movements.allowSneaking = true
  movements.allowBreakingBlocks = false
  bot.pathfinder.setMovements(movements)

  loadState()
  setInterval(checkHealthAndHunger, 5000)
  startDodgeSystem()

  const isNight = bot.time.timeOfDay > 12000
  if (isNight) {
    sendPrivateMessage('🌙 Es de noche. Me quedo quieto y esquivo mobs para sobrevivir.')
    autoFollowEnabled = false
    stopFollowing()
  } else {
    sendPrivateMessage('☀️ Es de día. Usa "sigue" o "auto" para que te siga.')
  }
})

bot.on('whisper', async (username, message) => {
  if (username !== MASTER) {
    bot.chat(`/tell ${username} Solo respondo a ${MASTER}.`)
    return
  }
  await handleCommand(message)
})

bot.on('chat', async (username, message) => {
  if (username === bot.username || username !== MASTER) return
  await handleCommand(message)
})

bot.on('time', async () => {
  const isNight = bot.time.timeOfDay > 12000
  if (isNight && followingPlayer) {
    stopFollowing()
    if (bedLocation || villageBedLocation) {
      sendPrivateMessage('🌙 Se hizo de noche. Voy a dormir en la cama.')
      await sleepInBed()
    } else {
      sendPrivateMessage('🌙 Se hizo de noche. Me quedo quieto para sobrevivir.')
    }
  } else if (!isNight && !followingPlayer && autoFollowEnabled) {
    sendPrivateMessage('☀️ Amaneció. Voy hacia ti esquivando mobs.')
    startFollowing()
  }
})

bot.on('error', err => {
  if (err.message && err.message.includes('GoalChanged')) {
    console.log('🔄 GoalChanged ignorado')
    pathfindingLock = false
    return
  }
  console.error('❌ Error:', err)
  sendPrivateMessage(`❌ Error: ${err.message}`)
})

bot.on('end', () => console.log('🔌 Bot desconectado'))