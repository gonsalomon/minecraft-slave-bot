// =====================
//   BOT LEÑADOR - COMIDA, SEGUIMIENTO, COMANDOS
// =====================
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
  username: process.env.MC_USERNAME ?? 'leñador',
  version: process.env.MC_VERSION ?? '1.21.1'
})

bot.loadPlugin(pathfinder)

// ===================== CONSTANTES =====================
const WOOD_BLOCKS = new Set([
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
])

const LEAVES_BLOCKS = new Set([
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'azalea_leaves', 'flowering_azalea_leaves'
])

const TREE_HEIGHT_LIMIT = 12 // Altura máxima a talar
const MIN_FREE_SLOTS = 4 // Espacios libres mínimos

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'piglin_brute', 'hoglin', 'wither_skeleton',
  'enderman', 'silverfish', 'phantom', 'drowned', 'husk',
  'stray', 'bogged', 'breeze'
]
const PROTECTED_BLOCKS = new Set([
  'oak_stairs', 'spruce_stairs', 'birch_stairs', 'jungle_stairs',
  'acacia_stairs', 'dark_oak_stairs', 'mangrove_stairs', 'cherry_stairs',
  'bamboo_stairs', 'stone_stairs', 'cobblestone_stairs', 'stone_brick_stairs',
  'sandstone_stairs', 'granite_stairs', 'diorite_stairs', 'andesite_stairs',
  'brick_stairs', 'nether_brick_stairs', 'quartz_stairs', 'red_sandstone_stairs',
  'purpur_stairs', 'prismarine_stairs', 'prismarine_brick_stairs', 'dark_prismarine_stairs',
  'polished_granite_stairs', 'polished_diorite_stairs', 'polished_andesite_stairs',
  'mossy_cobblestone_stairs', 'mossy_stone_brick_stairs', 'smooth_sandstone_stairs',
  'smooth_quartz_stairs', 'end_stone_brick_stairs', 'blackstone_stairs',
  'polished_blackstone_stairs', 'polished_blackstone_brick_stairs', 'cut_copper_stairs',
  'exposed_cut_copper_stairs', 'weathered_cut_copper_stairs', 'oxidized_cut_copper_stairs',
  'waxed_cut_copper_stairs', 'oak_slab', 'spruce_slab', 'cobblestone_slab',
  'stone_slab', 'ladder', 'scaffolding'
])

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'bread',
  'baked_potato', 'carrot', 'apple', 'melon_slice', 'cookie',
  'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken',
  'raw_salmon', 'raw_cod', 'rotten_flesh'
]

// ===================== ESTADO GLOBAL =====================
let chestLocation = null
let craftingTableLocation = null
let bedLocation = null
let explorationActive = false
let woodcuttingActive = false
let following = false
let followInterval = null
let autoFollowEnabled = false
let pathfindingLock = false
let pendingGoal = null
let isEating = false
let lastChunkX = 0, lastChunkZ = 0
let exploredChunks = new Set()

// ===================== PERSISTENCIA =====================
const STATE_FILE = './lumberjack_state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation = data.chestLocation ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    console.log('📂 Estado cargado:', data)
  } catch { console.log('📂 Sin estado previo') }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

// ========== COMIDA Y SALUD ==========
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
      sendPrivateMessage(`⚠️ che no tengo comida, traeme`)
      return
    }
    await bot.equip(food, 'hand')
    await bot.consume()
    await sleep(500) // esperar a que termine de comer
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

// ========== SEGUIMIENTO CON ESQUIVA LATERAL ==========
function getStrafeDirection(targetPos) {
  // Moverse hacia el jugador pero con desplazamiento lateral aleatorio para evitar mobs
  const toTarget = targetPos.minus(bot.entity.position)
  const perpendicular = new Vec3(-toTarget.z, 0, toTarget.x).normalize()
  const strafe = Math.sin(Date.now() / 500) * 2 // oscila entre -2 y 2
  return bot.entity.position.plus(toTarget.normalize().scaled(2)).plus(perpendicular.scaled(strafe))
}

async function followPlayer() {
  if (!following) return
  const target = bot.players[MASTER]?.entity
  if (!target) return
  const dist = target.position.distanceTo(bot.entity.position)
  if (dist > 3) {
    // Esquivar mobs sin perder objetivo: moverse en arco
    const moveTo = getStrafeDirection(target.position)
    await safeSetGoal(new goals.GoalNear(moveTo.x, moveTo.y, moveTo.z, 2), true)
  }
}

function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  following = true
  followInterval = setInterval(() => {
    if (!following && autoFollowEnabled ) {
      const target = bot.players[MASTER]?.entity
      if (target && target.position.distanceTo(bot.entity.position) > 3) {
        safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
      }
      return
    }
    if (!following) return
    const target = bot.players[username]?.entity
    if (target) safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
  }, 1000)
}

function stopFollowing() {
  following = false
  if (followInterval) clearInterval(followInterval)
  followInterval = null
  bot.pathfinder.setGoal(null)
}

// ========== DORMIR ==========
async function sleepInBed() {
  if (!bedLocation) { sendPrivateMessage('❌ No hay cama registrada.'); return }
  await safeGoto(bedLocation.x, bedLocation.y, bedLocation.z, 2)
  const bed = bot.blockAt(new Vec3(bedLocation.x, bedLocation.y, bedLocation.z))
  if (!bed?.name.includes('bed')) { sendPrivateMessage('❌ No encuentro la cama.'); return }
  try {
    await bot.sleep(bed)
    sendPrivateMessage('💤 Durmiendo...')
    bot.once('wake', () => sendPrivateMessage('☀️ Buenos días!'))
  } catch (err) {
    sendPrivateMessage(`❌ No puedo dormir: ${err.message}`)
  }
}

// ===================== UTILS =====================
function sendPrivateMessage(message) {
  if (MASTER && bot.players[MASTER]) bot.chat(`/tell ${MASTER} ${message}`)
  else console.log(`[No enviado a ${MASTER}]: ${message}`)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function safeSetGoal(goal, priority = false) {
  if (pathfindingLock) { pendingGoal = { goal, priority }; return false }
  try {
    pathfindingLock = true
    bot.pathfinder.setGoal(goal, priority)
    return true
  } finally {
    setTimeout(() => {
      pathfindingLock = false
      if (pendingGoal) { const { goal, priority } = pendingGoal; pendingGoal = null; safeSetGoal(goal, priority) }
    }, 1000)
  }
}

async function safeGoto(x, y, z, range = 2) {
  let waited = 0
  while (pathfindingLock && waited < 30) { await sleep(100); waited++ }
  if (pathfindingLock) { pathfindingLock = false; bot.pathfinder.setGoal(null); await sleep(50) }
  if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null)
  try {
    pathfindingLock = true
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
  } finally {
    pathfindingLock = false
  }
}

function getInventoryUsedSlots() {
  return bot.inventory.items().length
}

function hasFreeSlots(required = MIN_FREE_SLOTS) {
  return (36 - getInventoryUsedSlots()) >= required
}

async function depositExcessIfNeeded() {
  if (hasFreeSlots()) return
  if (!chestLocation) { sendPrivateMessage('⚠️ Inventario lleno y sin cofre. No puedo seguir.'); return }
  await depositInChest()
}

async function depositInChest() {
  if (!chestLocation) return
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
  const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
  if (!chestBlock || !chestBlock.name.includes('chest')) { sendPrivateMessage('No encuentro el cofre.'); return }
  const chest = await bot.openChest(chestBlock)
  // Depositar todo excepto herramientas de madera, hachas, comida básica
  const keepTypes = new Set()
  for (const item of bot.inventory.items()) {
    if (item.name.includes('axe') || item.name === 'stick' || FOOD_PRIORITY.includes(item.name)) keepTypes.add(item.type)
  }
  let deposited = 0
  for (const item of bot.inventory.items()) {
    if (!keepTypes.has(item.type)) {
      await chest.deposit(item.type, null, item.count)
      deposited += item.count
    }
  }
  chest.close()
  if (deposited > 0) sendPrivateMessage(`✅ Depositados ${deposited} items`)
}

// ===================== HOJAS Y REFORESTACIÓN =====================
async function breakLeavesAround(treePos) {
  // Romper hojas adyacentes al tronco superior y alrededores
  const leavesToBreak = []
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -1; dy <= TREE_HEIGHT_LIMIT; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        const pos = treePos.offset(dx, dy, dz)
        const block = bot.blockAt(pos)
        if (block && LEAVES_BLOCKS.has(block.name)) leavesToBreak.push(block)
      }
    }
  }
  // Equipar mano vacía (ninguna herramienta) para romper hojas rápido pero sin gastar durabilidad
  await bot.equip(bot.inventory.slots[36]?.name?.includes('axe') ? bot.inventory.slots[36] : null, 'hand')
  for (const leaf of leavesToBreak) {
    try {
      await safeGoto(leaf.position.x, leaf.position.y, leaf.position.z, 2)
      await bot.dig(leaf)
      await sleep(50)
    } catch (err) { /* ignorar si ya no existe */ }
  }
}

async function plantSapling(originalTreeBase) {
  // Buscar plántula en inventario
  const sapling = bot.inventory.items().find(i => i.name.includes('sapling'))
  if (!sapling) { sendPrivateMessage('🌱 No tengo plántulas para reforestar.'); return false }
  // Colocar en el mismo bloque del tronco base (si está vacío) o en el suelo junto a él
  const plantPos = originalTreeBase
  const groundBlock = bot.blockAt(plantPos)
  if (groundBlock && groundBlock.name !== 'air') {
    // Buscar espacio adyacente
    for (const offset of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
      const adjPos = plantPos.offset(offset[0], offset[1], offset[2])
      if (bot.blockAt(adjPos)?.name === 'air') {
        await safeGoto(adjPos.x, adjPos.y, adjPos.z, 1)
        await bot.equip(sapling, 'hand')
        await bot.placeBlock(bot.blockAt(adjPos.offset(0, -1, 0)), new Vec3(0, 1, 0))
        sendPrivateMessage('🌱 Plantada nueva plántula')
        return true
      }
    }
    return false
  } else {
    await safeGoto(plantPos.x, plantPos.y, plantPos.z, 1)
    await bot.equip(sapling, 'hand')
    await bot.placeBlock(bot.blockAt(plantPos.offset(0, -1, 0)), new Vec3(0, 1, 0))
    sendPrivateMessage('🌱 Plantada nueva plántula')
    return true
  }
}

// ===================== TALA DE ÁRBOL =====================
async function ensureAxe() {
  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('axe')) return true
  const axe = bot.inventory.items().find(i => i.name.includes('axe'))
  if (axe) { await bot.equip(axe, 'hand'); return true }
  // Si no hay hacha, intentar craftear una de piedra
  sendPrivateMessage('🔨 Intentando craftear stone_axe...')
  // ... (código de crafteo similar al original, simplificado)
  return false
}

function findCompleteTree(maxDistance = 20) {
  const log = bot.findBlock({ matching: b => WOOD_BLOCKS.has(b?.name), maxDistance })
  if (!log) return null
  const treeBlocks = []
  for (let y = -1; y <= TREE_HEIGHT_LIMIT; y++) {
    const block = bot.blockAt(log.position.offset(0, y, 0))
    if (block && WOOD_BLOCKS.has(block.name)) treeBlocks.push(block)
  }
  return treeBlocks.length ? { blocks: treeBlocks, basePos: treeBlocks[0].position } : null
}

async function cutTree(tree) {
  woodcuttingActive = true
  if (!await ensureAxe()) { sendPrivateMessage('❌ No tengo hacha'); woodcuttingActive = false; return false }
  // Talar troncos de abajo hacia arriba
  for (const block of tree.blocks) {
    if (!explorationActive && !woodcuttingActive) break
    await safeGoto(block.position.x, block.position.y, block.position.z, 2)
    await bot.dig(block)
    await sleep(100)
    await depositExcessIfNeeded()
  }
  // Romper hojas (con la mano)
  await breakLeavesAround(tree.basePos)
  // Recolectar items caídos
  await pickupNearbyItems()
  // Reforestar
  await plantSapling(tree.basePos)
  woodcuttingActive = false
  return true
}

async function pickupNearbyItems() {
  const items = Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 5)
  for (const item of items) {
    try {
      await safeSetGoal(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1), true)
      await sleep(200)
    } catch {}
  }
}

// ===================== EXPLORACIÓN POR CHUNKS =====================
async function exploreChunks() {
  while (explorationActive) {
    await checkHealthAndHunger()
    const tree = findCompleteTree(16)
    if (tree && !woodcuttingActive) {
      await cutTree(tree)
      await depositExcessIfNeeded()
      continue
    }
    // mover al siguiente chunk
    const cx = Math.floor(bot.entity.position.x / 16)
    const cz = Math.floor(bot.entity.position.z / 16)
    let nextX = (cx + 1) * 16 + 8
    let nextZ = cz * 16 + 8
    if (Math.abs(cx - lastChunkX) > 5) {
      nextX = cx * 16 + 8
      nextZ = (cz + 1) * 16 + 8
    }
    lastChunkX = cx; lastChunkZ = cz
    await safeGoto(nextX, bot.entity.position.y, nextZ, 8)
    await sleep(2000)
  }
}

// ========== COMANDOS ==========
async function handleCommand(message) {
  const msg = message.toLowerCase().trim()
  const parts = message.split(' ')
  const cmd = parts[0].toLowerCase()

  if (cmd === 'explora') {
    if (following) stopFollowing()
    explorationActive = true
    woodcuttingActive = false
    sendPrivateMessage('🌲 Modo leñador activado.')
    exploreChunks()
  }
  else if (cmd === 'para') {
    explorationActive = false
    woodcuttingActive = false
    stopFollowing()
    bot.pathfinder.setGoal(null)
    sendPrivateMessage('🛑 Detenido.')
  }
  else if (cmd === 'sigueme') {
    explorationActive = false
    woodcuttingActive = false
    startFollowing()
    sendPrivateMessage(`🚶 Siguiendo a ${MASTER}.`)
  }
  else if (cmd === 'quieto') {
    stopFollowing()
    sendPrivateMessage('🚫 Me quedo quieto.')
  }
  if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo autónomo ACTIVADO' : '❌ Modo autónomo DESACTIVADO')
    if (autoFollowEnabled && !following) {
      following = true
      startFollowing(MASTER)
      sendPrivateMessage(`🚶 Siguiendo a ${MASTER}...`)
    }
    return
  }
  else if (cmd === 'pos' || cmd === 'dondetas') {
    const p = bot.entity.position
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
  }
  else if (cmd === 'deposita') {
    await depositInChest()
  }
  else if (cmd === 'dormi') {
    explorationActive = false
    stopFollowing()
    await sleepInBed()
  }
  else if (cmd === 'cofre' && parts.length === 4) {
    const [x,y,z] = parts.slice(1).map(Number)
    if ([x,y,z].some(isNaN)) return
    chestLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cofre guardado en ${x} ${y} ${z}`)
  }
  else if (cmd === 'mesa' && parts.length === 4) {
    const [x,y,z] = parts.slice(1).map(Number)
    if ([x,y,z].some(isNaN)) return
    craftingTableLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Mesa guardada en ${x} ${y} ${z}`)
  }
  else if (cmd === 'cama' && parts.length === 4) {
    const [x,y,z] = parts.slice(1).map(Number)
    if ([x,y,z].some(isNaN)) return
    bedLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cama guardada en ${x} ${y} ${z}`)
  }
  else if (cmd === 'salud') {
    sendPrivateMessage(`❤️ ${Math.round(bot.health)}/20 🍗 ${Math.round(bot.food)}/20`)
  }
  else {
    sendPrivateMessage(`❌ Comando no reconocido. Usa: explora, para, sigueme, quieto, pos, deposita, dormi, cofre x y z, mesa x y z, cama x y z, salud`)
  }
}

// ========== EVENTOS ==========
bot.on('spawn', () => {
  console.log('✅ Bot leñador conectado')
  sendPrivateMessage('🌲 Leñador listo. Comandos: explora, sigueme, pos, etc.')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  loadState()
  setInterval(checkHealthAndHunger, 5000)
  setInterval(() => { if (!explorationActive && !following) depositExcessIfNeeded() }, 30000)
})

bot.on('whisper', async (username, message) => {
  if (username !== MASTER) { bot.chat(`/tell ${username} Solo respondo a ${MASTER}.`); return }
  await handleCommand(message)
})

bot.on('chat', async (username, message) => {
  if (username === bot.username || username !== MASTER) return
  await handleCommand(message)
})

bot.on('health', () => { if (bot.health < 14 || bot.food < 18) checkHealthAndHunger() })
bot.on('error', err => console.error('❌ Error:', err))
bot.on('end', () => console.log('🔌 Bot desconectado'))