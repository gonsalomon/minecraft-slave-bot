// =====================
//   BOT MINERO - DESCIDENTE POR SEGMENTOS
// =====================
// Comandos:
//   minar chunk - Mina el chunk actual en segmentos de 16 bloques de altura, preguntando antes de cada segmento
//   minar chunk completo - Mina todo el chunk hasta bedrock sin preguntar
//   minar capa <Y> - Mina solo las capas Y e Y+1 en el chunk actual
//   espiral <Y> - Mina en espiral infinita en capa Y (pregunta antes de cada chunk)
//   linea <Y> <dir> - Mina en línea recta en capa Y
//   sigueme, quieto, auto, parar, aiuda, data, pos, deposita, dormi, salud
//   cofre x y z, mesa x y z, cama x y z

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
  username: process.env.MC_USERNAME ?? 'minero',
  version: process.env.MC_VERSION ?? '1.21.1'
})

bot.loadPlugin(pathfinder)

// ===================== CONSTANTES =====================
const PROTECTED_BLOCKS = new Set([
  'oak_stairs', 'spruce_stairs', 'birch_stairs', 'jungle_stairs',
  'acacia_stairs', 'dark_oak_stairs', 'mangrove_stairs', 'cherry_stairs',
  'stone_stairs', 'cobblestone_stairs', 'ladder', 'scaffolding',
  'chest', 'crafting_table', 'furnace', 'bed', 'enchanting_table'
])

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'bread',
  'apple', 'carrot', 'baked_potato'
]

const PICKAXE_REQUIRED = {
  'stone': 'wooden_pickaxe', 'cobblestone': 'wooden_pickaxe',
  'coal_ore': 'wooden_pickaxe', 'iron_ore': 'stone_pickaxe',
  'diamond_ore': 'iron_pickaxe', 'obsidian': 'diamond_pickaxe'
}
const PICKAXE_TIER = {
  'wooden_pickaxe': 1, 'stone_pickaxe': 2, 'iron_pickaxe': 3,
  'diamond_pickaxe': 4, 'netherite_pickaxe': 5
}

// ===================== ESTADO GLOBAL =====================
let chestLocation = null
let craftingTableLocation = null
let bedLocation = null
let miningActive = false
let miningMode = null
let currentLayerY = null
let pendingConfirmation = null
let pathfindingLock = false
let pendingGoal = null
let isEating = false

// Seguimiento
let followingPlayer = false
let followInterval = null
let autoFollowEnabled = false

// ===================== PERSISTENCIA =====================
const STATE_FILE = './miner_state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation = data.chestLocation ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    bedLocation = data.bedLocation ?? null
    console.log('📂 Estado cargado:', data)
  } catch { console.log('📂 Sin estado previo') }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, bedLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
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
      sendPrivateMessage(`⚠️ che no tengo comida, traeme`)
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

// ===================== PICOS Y MINERÍA =====================
async function ensurePickaxe(blockName) {
  const required = PICKAXE_REQUIRED[blockName] || 'stone_pickaxe'
  const requiredTier = PICKAXE_TIER[required]
  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('pickaxe') && (PICKAXE_TIER[equipped.name] || 0) >= requiredTier) return true
  const available = bot.inventory.items().filter(i => i.name.includes('pickaxe')).sort((a,b) => (PICKAXE_TIER[b.name]||0) - (PICKAXE_TIER[a.name]||0))
  const suitable = available.find(i => (PICKAXE_TIER[i.name] || 0) >= requiredTier)
  if (suitable) {
    await bot.equip(suitable, 'hand')
    return true
  }
  sendPrivateMessage(`❌ No tengo pico suficiente para ${blockName}`)
  return false
}

async function safeDig(block) {
  if (!block || block.type === 0) return false
  if (PROTECTED_BLOCKS.has(block.name)) {
    sendPrivateMessage(`🛑 Bloque protegido: ${block.name} en ${block.position}. Deteniendo minería.`)
    miningActive = false
    return false
  }
  await ensurePickaxe(block.name)
  try {
    await bot.dig(block, true)
    return true
  } catch { return false }
}

// ===================== MINERÍA DESCENDENTE POR CAPAS COMPLETAS =====================
// Mina un área de 16x16 en dos capas (Y y Y+1)
async function mineTwoLayersAtY(chunkX, chunkZ, y) {
  const startX = chunkX * 16
  const startZ = chunkZ * 16
  for (let layer = 0; layer < 2; layer++) {
    const currentY = y + layer
    for (let dx = 0; dx < 16; dx++) {
      for (let dz = 0; dz < 16; dz++) {
        if (!miningActive) return
        const block = bot.blockAt(new Vec3(startX + dx, currentY, startZ + dz))
        if (block && block.diggable && !PROTECTED_BLOCKS.has(block.name)) {
          await safeGoto(block.position.x, block.position.y, block.position.z, 1)
          await safeDig(block)
          await sleep(20)
        }
      }
    }
  }
}

// Subir a la superficie por el hueco minado (simplemente moviéndose hacia arriba)
async function climbToSurface(surfaceY) {
  let currentY = Math.floor(bot.entity.position.y)
  while (currentY < surfaceY && miningActive) {
    const upPos = new Vec3(bot.entity.position.x, currentY + 1, bot.entity.position.z)
    const blockAbove = bot.blockAt(upPos)
    if (blockAbove && blockAbove.diggable && !PROTECTED_BLOCKS.has(blockAbove.name)) {
      await safeDig(blockAbove)
    }
    await safeGoto(upPos.x, upPos.y, upPos.z, 1)
    currentY++
    await sleep(50)
  }
}

// Obtener la altura de superficie real en una posición
async function getSurfaceY(x, z) {
  for (let y = 255; y >= 0; y--) {
    const block = bot.blockAt(new Vec3(x, y, z))
    if (block && block.name !== 'air' && block.diggable !== true) {
      return y + 1
    }
  }
  return 64
}

// Mina el chunk actual en segmentos de 16 bloques de altura, preguntando antes de cada segmento
async function mineChunkDescending(askEachSegment = true) {
  const chunkX = Math.floor(bot.entity.position.x / 16)
  const chunkZ = Math.floor(bot.entity.position.z / 16)
  const centerX = chunkX * 16 + 8
  const centerZ = chunkZ * 16 + 8
  const surfaceY = await getSurfaceY(centerX, centerZ)
  let currentTopY = surfaceY  // desde la superficie hacia abajo

  sendPrivateMessage(`⛏️ Minando chunk [${chunkX},${chunkZ}] desde Y=${surfaceY} descendiendo...`)

  // Segmentos de 16 bloques de altura (8 capas dobles)
  while (currentTopY > -60 && miningActive) {
    const segmentBottomY = Math.max(currentTopY - 16, -60)
    sendPrivateMessage(`📉 Minando segmento de Y=${currentTopY} hasta Y=${segmentBottomY}`)

    // Minar cada capa doble dentro del segmento
    for (let y = currentTopY; y > segmentBottomY; y -= 2) {
      if (!miningActive) break
      await mineTwoLayersAtY(chunkX, chunkZ, y - 1) // porque mineTwoLayersAtY mina y e y+1, pasamos la inferior
      await checkHealthAndHunger()
      if (bot.inventory.emptySlotCount() < 5) await depositInChest()
    }

    if (!miningActive) break
    currentTopY = segmentBottomY

    // Si hemos llegado a bedrock o por debajo, terminar
    if (currentTopY <= -60) {
      sendPrivateMessage(`✅ Llegado a bedrock. Minería completada.`)
      break
    }

    // Preguntar si continuar con el siguiente segmento
    if (askEachSegment) {
      const answer = await askConfirmation(`He minado hasta Y=${currentTopY}. ¿Continuar con los próximos 16 bloques?`)
      if (!answer) {
        sendPrivateMessage(`🛑 Minería detenida por usuario en Y=${currentTopY}. Subiendo a superficie...`)
        break
      }
    }
  }

  // Subir a la superficie
  await climbToSurface(surfaceY)
  sendPrivateMessage(`✅ Proceso de minería finalizado.`)
}

// Función para minar todo el chunk de una vez sin preguntar
async function mineChunkFullDescending() {
  await mineChunkDescending(false)
}

// Función para minar solo dos capas en el chunk actual
async function mineLayerInCurrentChunk(y) {
  const chunkX = Math.floor(bot.entity.position.x / 16)
  const chunkZ = Math.floor(bot.entity.position.z / 16)
  await mineTwoLayersAtY(chunkX, chunkZ, y)
  sendPrivateMessage(`✅ Capas Y=${y} y Y=${y+1} minadas en chunk [${chunkX},${chunkZ}]`)
}

// ===================== ESPIRAL Y LÍNEA (simplificado, igual que antes pero con confirmación por chunk) =====================
async function spiralMining(startY) {
  let chunkX = Math.floor(bot.entity.position.x / 16)
  let chunkZ = Math.floor(bot.entity.position.z / 16)
  let step = 1, stepCount = 0, turnCount = 0, dir = 0
  while (miningActive) {
    const ok = await askConfirmation(`¿Minar capa Y=${startY} en chunk [${chunkX},${chunkZ}]?`)
    if (!ok) break
    await moveToChunkSurface(chunkX, chunkZ)
    await mineTwoLayersAtY(chunkX, chunkZ, startY)
    await depositInChest()
    // mover en espiral...
    if (stepCount < step) {
      if (dir === 0) chunkX++; else if (dir === 1) chunkZ++; else if (dir === 2) chunkX--; else chunkZ--
      stepCount++
    } else {
      dir = (dir + 1) % 4
      turnCount++
      if (turnCount % 2 === 0) step++
      stepCount = 0
      if (dir === 0) chunkX++; else if (dir === 1) chunkZ++; else if (dir === 2) chunkX--; else chunkZ--
      stepCount = 1
    }
  }
}

async function lineMining(startY, direction) {
  let chunkX = Math.floor(bot.entity.position.x / 16)
  let chunkZ = Math.floor(bot.entity.position.z / 16)
  while (miningActive) {
    const ok = await askConfirmation(`¿Minar capa Y=${startY} en chunk [${chunkX},${chunkZ}]?`)
    if (!ok) break
    await moveToChunkSurface(chunkX, chunkZ)
    await mineTwoLayersAtY(chunkX, chunkZ, startY)
    await depositInChest()
    if (direction === 'x+') chunkX++
    else if (direction === 'x-') chunkX--
    else if (direction === 'z+') chunkZ++
    else chunkZ--
  }
}

async function moveToChunkSurface(chunkX, chunkZ) {
  const centerX = chunkX * 16 + 8
  const centerZ = chunkZ * 16 + 8
  const surfaceY = await getSurfaceY(centerX, centerZ)
  await safeGoto(centerX, surfaceY, centerZ, 5)
}

// ===================== CONFIRMACIÓN =====================
function askConfirmation(question) {
  return new Promise((resolve) => {
    pendingConfirmation = { resolve, question }
    sendPrivateMessage(`❓ ${question} (responde "si" o "no")`)
    setTimeout(() => {
      if (pendingConfirmation && pendingConfirmation.resolve === resolve) {
        pendingConfirmation = null
        sendPrivateMessage(`⏰ Tiempo agotado, asumiendo "no"`)
        resolve(false)
      }
    }, 30000)
  })
}

// ===================== DEPÓSITO =====================
async function depositInChest() {
  if (!chestLocation) return
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
  const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
  if (!chestBlock || !chestBlock.name.includes('chest')) { sendPrivateMessage('No encuentro el cofre.'); return }
  const chest = await bot.openChest(chestBlock)
  const keepTypes = new Set()
  for (const item of bot.inventory.items()) {
    if (item.name.includes('pickaxe') || item.name.includes('sword') || FOOD_PRIORITY.includes(item.name))
      keepTypes.add(item.type)
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

// ===================== SEGUIMIENTO =====================
function getStrafeDirection(targetPos) {
  const toTarget = targetPos.minus(bot.entity.position)
  const perpendicular = new Vec3(-toTarget.z, 0, toTarget.x).normalize()
  const strafe = Math.sin(Date.now() / 500) * 2
  return bot.entity.position.plus(toTarget.normalize().scaled(2)).plus(perpendicular.scaled(strafe))
}

async function followPlayer() {
  if (!followingPlayer) return
  const target = bot.players[MASTER]?.entity
  if (!target) return
  const dist = target.position.distanceTo(bot.entity.position)
  if (dist > 3) {
    const moveTo = getStrafeDirection(target.position)
    await safeSetGoal(new goals.GoalNear(moveTo.x, moveTo.y, moveTo.z, 2), true)
  }
}

function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  followInterval = setInterval(() => {
    if (!followingPlayer && autoFollowEnabled && !miningActive) {
      const target = bot.players[MASTER]?.entity
      if (target && target.position.distanceTo(bot.entity.position) > 3) {
        safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
      }
      return
    }
    if (!followingPlayer) return
    if (miningActive ||  pathfindingLock) return
    const target = bot.players[username]?.entity
    if (target) safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
  }, 1000)
}

function stopFollowing() {
  followingPlayer = false
  if (followInterval) clearInterval(followInterval)
  followInterval = null
  bot.pathfinder.setGoal(null)
  sendPrivateMessage('🚫 Dejé de seguir')
}

// ===================== DORMIR =====================
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

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const parts = message.split(' ')
  const cmd = parts[0].toLowerCase()

  // Responder confirmación pendiente
  if (pendingConfirmation && (cmd === 'si' || cmd === 'confirmar')) {
    pendingConfirmation.resolve(true)
    pendingConfirmation = null
    return
  }
  if (pendingConfirmation && (cmd === 'no' || cmd === 'cancelar')) {
    pendingConfirmation.resolve(false)
    pendingConfirmation = null
    return
  }

  // Comandos de minería
  if (cmd === 'minar' && parts[1] === 'chunk' && parts[2] === 'completo') {
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    if (followingPlayer) stopFollowing()
    miningActive = true
    sendPrivateMessage('⛏️ Minando chunk completo hasta bedrock sin preguntar...')
    await mineChunkFullDescending()
    miningActive = false
  }
  else if (cmd === 'minar' && parts[1] === 'chunk') {
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    if (followingPlayer) stopFollowing()
    miningActive = true
    sendPrivateMessage('⛏️ Minando chunk por segmentos (preguntando cada 16 bloques)...')
    await mineChunkDescending(true)
    miningActive = false
  }
  else if (cmd === 'minar' && parts[1] === 'capa' && parts.length === 3) {
    const y = parseInt(parts[2])
    if (isNaN(y)) return
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    if (followingPlayer) stopFollowing()
    miningActive = true
    await mineLayerInCurrentChunk(y)
    miningActive = false
  }
  else if (cmd === 'espiral' && parts.length === 2) {
    const y = parseInt(parts[1])
    if (isNaN(y)) return
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    if (followingPlayer) stopFollowing()
    miningActive = true
    sendPrivateMessage(`🌀 Minando en espiral en capa Y=${y}...`)
    await spiralMining(y)
    miningActive = false
  }
  else if (cmd === 'linea' && parts.length === 3) {
    const y = parseInt(parts[1])
    const dir = parts[2]
    if (isNaN(y) || !['x+','x-','z+','z-'].includes(dir)) return
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    if (followingPlayer) stopFollowing()
    miningActive = true
    sendPrivateMessage(`➡️ Minando en línea recta (${dir}) en capa Y=${y}...`)
    await lineMining(y, dir)
    miningActive = false
  }
  else if (cmd === 'parar') {
    miningActive = false
    if (pendingConfirmation) {
      pendingConfirmation.resolve(false)
      pendingConfirmation = null
    }
    bot.pathfinder.setGoal(null)
    sendPrivateMessage('🛑 Minería detenida.')
  }

  // Seguimiento
  else if (cmd === 'sigueme') {
    if (miningActive) { sendPrivateMessage('⚠️ Detén la minería con "parar" primero.'); return }
    startFollowing()
  }
  else if (cmd === 'quieto') {
    stopFollowing()
  }
  else if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo autónomo ACTIVADO' : '❌ Modo autónomo DESACTIVADO')
    if (autoFollowEnabled && !followingPlayer && !miningActive) startFollowing()
  }

  // Información
  else if (cmd === 'aiuda' || cmd === 'help') {
    sendPrivateMessage('📋 COMANDOS MINERO:')
    sendPrivateMessage('⛏️ minar chunk, minar chunk completo, minar capa <Y>')
    sendPrivateMessage('🌀 espiral <Y>, linea <Y> x+|x-|z+|z-')
    sendPrivateMessage('🚶 sigueme, quieto, auto, parar')
    sendPrivateMessage('📦 cofre x y z, mesa x y z, cama x y z, data')
    sendPrivateMessage('📍 pos, deposita, dormi, salud')
    sendPrivateMessage('✅ si/confirmar, no/cancelar')
  }
  else if (cmd === 'data') {
    sendPrivateMessage(`📦 Cofre: ${chestLocation ? `${chestLocation.x} ${chestLocation.y} ${chestLocation.z}` : 'no'}`)
    sendPrivateMessage(`📐 Mesa: ${craftingTableLocation ? `${craftingTableLocation.x} ${craftingTableLocation.y} ${craftingTableLocation.z}` : 'no'}`)
    sendPrivateMessage(`🛏️ Cama: ${bedLocation ? `${bedLocation.x} ${bedLocation.y} ${bedLocation.z}` : 'no'}`)
  }
  else if (cmd === 'pos' || cmd === 'dondetas') {
    const p = bot.entity.position
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
  }
  else if (cmd === 'deposita') {
    await depositInChest()
  }
  else if (cmd === 'dormi') {
    if (miningActive) miningActive = false
    if (followingPlayer) stopFollowing()
    await sleepInBed()
  }
  else if (cmd === 'salud') {
    sendPrivateMessage(`❤️ Vida:${Math.round(bot.health)}/20 🍗 Hambre:${Math.round(bot.food)}/20`)
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
  else {
    sendPrivateMessage(`❌ Comando desconocido. Usa "aiuda" para ayuda.`)
  }
}

// ===================== EVENTOS =====================
bot.on('spawn', () => {
  console.log('✅ Bot minero conectado')
  sendPrivateMessage('⛏️ Bot minero listo. Usa "aiuda" para comandos.')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  loadState()
  setInterval(checkHealthAndHunger, 5000)
  if (autoFollowEnabled && !followingPlayer && !miningActive) startFollowing()
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