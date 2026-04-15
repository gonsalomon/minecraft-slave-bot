// =====================
//   BOT MINERO - DESCENDENTE POR SEGMENTOS
// =====================
// Comandos:
//   minar chunk - Mina el chunk actual en segmentos de 16 bloques de altura, preguntando antes de cada segmento
//   minar chunk completo - Mina todo el chunk hasta bedrock sin preguntar
//   minar capa <Y> - Mina solo las capas Y e Y+1 en el chunk actual
//   espiral <Y> - Mina en espiral infinita en capa Y (pregunta antes de cada chunk)
//   linea <Y> <dir> - Mina en línea recta en capa Y
//   seguime, quieto, auto, parar, aiuda, data, pos, deposita, dormi, salud
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
  'chest', 'crafting_table', 'furnace', 'bed', 'enchanting_table', 'torch',
  'glass', 'glass_pane'
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
let mineLocation = null
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
    mineLocation = data.mineLocation ?? null
    console.log('📂 Estado cargado:', data)
  } catch { 
    console.log('📂 Sin estado previo') 
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, bedLocation, mineLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

// ===================== UTILS =====================
function sendPrivateMessage(message) {
  if (MASTER && bot.players[MASTER]) {
    bot.chat(`/tell ${MASTER} ${message}`)
  } else {
    console.log(`[No enviado a ${MASTER}]: ${message}`)
  }
}

function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)) 
}

async function safeGoto(x, y, z, range = 2) {
  console.log(`🔍 safeGoto target=(${x},${y},${z}) range=${range} current=(${bot.entity.position.x.toFixed(2)},${bot.entity.position.y.toFixed(2)},${bot.entity.position.z.toFixed(2)})`)
  // Esperar si hay lock activo
  let waited = 0
  while (pathfindingLock && waited < 30) {
    await sleep(100)
    waited++
  }
  
  if (pathfindingLock) {
    console.log('⚠️ pathfindingLock timeout, forzando reset')
    pathfindingLock = false
    try {
      if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null)
    } catch (err) {
      if (!err.message?.includes('GoalChanged')) throw err
    }
    await sleep(200)
  }

  // Limpiar goal previo si existe
  if (bot.pathfinder?.goal) {
    try {
      bot.pathfinder.setGoal(null)
    } catch (err) {
      if (!err.message?.includes('GoalChanged')) throw err
    }
    await sleep(200)
  }

  setSprintMode(false)
  try {
    pathfindingLock = true
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
  } catch (err) {
    // Si es GoalChanged, no es un error real - solo otra parte del código cambió el destino
    if (err.message?.includes('GoalChanged')) {
      console.log('🔄 GoalChanged en safeGoto - normal durante minería')
      return
    }
    // Timeout - intentar una vez más
    if (err.message?.includes('Timeout')) {
      console.log(`⏱️ Timeout en pathfinder hacia (${x},${y},${z}), reintentando...`)
      await sleep(500)
      try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
      } catch (e) {
        if (e.message?.includes('GoalChanged')) return
        if (e.message?.includes('Timeout')) {
          console.error(`❌ Timeout persistente en safeGoto hacia (${x},${y},${z}) range=${range}`)
          return
        }
        throw e
      }
      return
    }
    // Cualquier otro error - propagar
    throw err
  } finally {
    setSprintMode(true)
    pathfindingLock = false
  }
}

function setSprintMode(enabled) {
  const movements = new Movements(bot)
  movements.allowSprinting = enabled
  bot.pathfinder.setMovements(movements)
}

async function safeSetGoal(goal, priority = false) {
  if (pathfindingLock) {
    pendingGoal = { goal, priority }
    return false
  }
  try {
    pathfindingLock = true
    if (goal === null) {
      bot.pathfinder.setGoal(null)
    } else {
      bot.pathfinder.setGoal(goal, priority)
    }
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
    }, 200)
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
  
  if (equipped && equipped.name.includes('pickaxe') && 
      (PICKAXE_TIER[equipped.name] || 0) >= requiredTier) {
    return true
  }
  
  const available = bot.inventory.items()
    .filter(i => i.name.includes('pickaxe'))
    .sort((a, b) => (PICKAXE_TIER[b.name] || 0) - (PICKAXE_TIER[a.name] || 0))
  
  const suitable = available.find(i => (PICKAXE_TIER[i.name] || 0) >= requiredTier)
  
  if (suitable) {
    await bot.equip(suitable, 'hand')
    return true
  }
  
  sendPrivateMessage(`❌ No tengo pico suficiente para ${blockName}`)
  return false
}

function reportPickaxes() {
  const picks = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
    .map(n => ({ 
      n, 
      c: bot.inventory.items().filter(i => i.name === n).reduce((s, i) => s + i.count, 0) 
    }))
    .filter(p => p.c > 0)
  
  sendPrivateMessage(picks.length ? 
    `⛏️ Picos: ${picks.map(p => `${p.n}:${p.c}`).join(' | ')}` : 
    '⛏️ No tengo picos'
  )
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
  } catch { 
    return false 
  }
}

// Movimiento directo sin pathfinder para distancias cortas
async function moveToBlock(x, y, z) {
  const current = bot.entity.position
  const dx = x - current.x
  const dz = z - current.z
  const dist = Math.sqrt(dx * dx + dz * dz)
  
  if (dist < 1.5) return
  
  // Detener pathfinder antes de usar controles manuales
  try {
    if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null)
  } catch {}
  
  await bot.lookAt(new Vec3(x, y, z))
  bot.setControlState('forward', true)
  await sleep(Math.min(300, dist * 150))
  bot.setControlState('forward', false)
  await sleep(50)
}

// ===================== MINERÍA DESCENDENTE POR CAPAS COMPLETAS =====================
async function mineLayerSerpentine(baseX, baseZ, y) {
  let x = baseX
  let z = baseZ
  let dx = 1

  for (let row = 0; row < 16; row++) {
    const endX = (dx === 1) ? baseX + 15 : baseX
    
    while (x !== endX + dx) {
      if (!miningActive) break
      
      const block = bot.blockAt(new Vec3(x, y, z))
      if (block && block.diggable && !PROTECTED_BLOCKS.has(block.name)) {
        if (Math.abs(bot.entity.position.x - x) > 1 || 
            Math.abs(bot.entity.position.z - z) > 1) {
          await safeGoto(x, y, z, 1)
        } else {
          await moveToBlock(x, y, z)
        }
        await safeDig(block)
        await sleep(50)
      }
      x += dx
    }
    
    if (!miningActive) break
    
    z++
    dx = -dx
    x = (dx === 1) ? baseX : baseX + 15
    await sleep(100)
  }
}

async function mineTwoLayersSerpentine(chunkX, chunkZ, bottomY) {
  const startX = chunkX * 16
  const startZ = chunkZ * 16
  await mineLayerSerpentine(startX, startZ, bottomY)
  await mineLayerSerpentine(startX, startZ, bottomY + 1)
}

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
    await sleep(100)
  }
}

async function getSurfaceY(x, z) {
  for (let y = 255; y >= 0; y--) {
    const block = bot.blockAt(new Vec3(x, y, z))
    if (block && block.name !== 'air') {
      return y + 1
    }
  }
  return 64
}

async function mineChunkDescending(askEachSegment = true) {
  const chunkX = Math.floor(bot.entity.position.x / 16)
  const chunkZ = Math.floor(bot.entity.position.z / 16)
  const centerX = chunkX * 16 + 8
  const centerZ = chunkZ * 16 + 8
  const surfaceY = await getSurfaceY(centerX, centerZ)
  let currentTopY = surfaceY

  sendPrivateMessage(`⛏️ Minando chunk [${chunkX},${chunkZ}] desde Y=${surfaceY} descendiendo...`)

  while (currentTopY > -58 && miningActive) {
    const segmentBottomY = Math.max(currentTopY - 16, -60)
    sendPrivateMessage(`📉 Minando segmento de Y=${currentTopY} hasta Y=${segmentBottomY}`)

    for (let y = currentTopY; y > segmentBottomY; y -= 2) {
      if (!miningActive) break
      await mineTwoLayersSerpentine(chunkX, chunkZ, y - 1)
      await checkHealthAndHunger()
      if (bot.inventory.emptySlotCount() < 5) await depositInChest()
    }

    if (!miningActive) break
    currentTopY = segmentBottomY

    if (currentTopY <= -60) {
      sendPrivateMessage(`✅ Llegado a bedrock. Minería completada.`)
      break
    }

    if (askEachSegment) {
      const answer = await askConfirmation(`He minado hasta Y=${currentTopY}. ¿Continuar con los próximos 16 bloques?`)
      if (!answer) {
        sendPrivateMessage(`🛑 Minería detenida por usuario en Y=${currentTopY}. Subiendo a superficie...`)
        break
      }
    }
  }

  await climbToSurface(surfaceY)
  sendPrivateMessage(`✅ Proceso de minería finalizado.`)
}

async function mineChunkFullDescending() {
  await mineChunkDescending(false)
}

async function mineLayerInCurrentChunk(y) {
  const chunkX = Math.floor(bot.entity.position.x / 16)
  const chunkZ = Math.floor(bot.entity.position.z / 16)
  await mineTwoLayersSerpentine(chunkX, chunkZ, y - 1)
  sendPrivateMessage(`✅ Capas Y=${y} y Y=${y + 1} minadas en chunk [${chunkX},${chunkZ}]`)
}

// ===================== ESPIRAL Y LÍNEA =====================
async function spiralMining(startY) {
  let chunkX = Math.floor(bot.entity.position.x / 16)
  let chunkZ = Math.floor(bot.entity.position.z / 16)
  let step = 1, stepCount = 0, turnCount = 0, dir = 0
  
  while (miningActive) {
    const ok = await askConfirmation(`¿Minar capa Y=${startY} en chunk [${chunkX},${chunkZ}]?`)
    if (!ok) break
    
    await moveToChunkSurface(chunkX, chunkZ)
    await mineTwoLayersSerpentine(chunkX, chunkZ, startY)
    await depositInChest()
    
    if (stepCount < step) {
      if (dir === 0) chunkX++
      else if (dir === 1) chunkZ++
      else if (dir === 2) chunkX--
      else chunkZ--
      stepCount++
    } else {
      dir = (dir + 1) % 4
      turnCount++
      if (turnCount % 2 === 0) step++
      stepCount = 0
      if (dir === 0) chunkX++
      else if (dir === 1) chunkZ++
      else if (dir === 2) chunkX--
      else chunkZ--
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
    await mineTwoLayersSerpentine(chunkX, chunkZ, startY)
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
  
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    sendPrivateMessage('No encuentro el cofre.')
    return
  }
  
  const chest = await bot.openChest(chestBlock)
  const keepTypes = new Set()
  
  for (const item of bot.inventory.items()) {
    if (item.name.includes('pickaxe') || 
        item.name.includes('sword') || 
        FOOD_PRIORITY.includes(item.name)) {
      keepTypes.add(item.type)
    }
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

async function getItemFromChest(itemName, count) {
  if (!chestLocation) return false
  
  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chest = await bot.openChest(
      bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    )
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

// ===================== SEGUIMIENTO =====================
function startFollowing() {
  if (followInterval) clearInterval(followInterval)
  
  followInterval = setInterval(() => {
    if (followingPlayer && !miningActive) {
      const target = bot.players[MASTER]?.entity
      if (target && target.position.distanceTo(bot.entity.position) > 3) {
        safeSetGoal(
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3),
          true
        )
      }
    }
  }, 100)
}

function stopFollowing() {
  followingPlayer = false
  
  if (followInterval) {
    clearInterval(followInterval)
    followInterval = null
  }
  
  try {
    bot.pathfinder.setGoal(null)
  } catch (err) {
    if (!err.message?.includes('GoalChanged')) console.error(err)
  }
  
  sendPrivateMessage('🚫 Dejé de seguir')
}

// ===================== DORMIR =====================
async function sleepInBed() {
  if (!bedLocation) {
    sendPrivateMessage('❌ No hay cama registrada.')
    return
  }
  
  await safeGoto(bedLocation.x, bedLocation.y, bedLocation.z, 2)
  const bed = bot.blockAt(new Vec3(bedLocation.x, bedLocation.y, bedLocation.z))
  
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

  // Comando goto
  if (cmd === 'goto') {
    const [x, y, z] = message.split(' ').slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    
    autoFollowEnabled = false
    followingPlayer = false
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2))
    sendPrivateMessage(`🚶 Yendo a ${x} ${y} ${z}...`)
    return
  }

  // Comandos de minería
  if (cmd === 'minar' && parts[1] === 'chunk' && parts[2] === 'completo') {
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (followingPlayer) stopFollowing()
    
    miningActive = true
    sendPrivateMessage('⛏️ Minando chunk completo hasta bedrock sin preguntar...')
    await mineChunkFullDescending()
    miningActive = false
  }
  else if (cmd === 'minar' && parts[1] === 'chunk') {
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (followingPlayer) stopFollowing()
    
    miningActive = true
    sendPrivateMessage('⛏️ Minando chunk por segmentos (preguntando cada 16 bloques)...')
    await mineChunkDescending(true)
    miningActive = false
  }
  else if (cmd === 'minar' && parts[1] === 'capa' && parts.length === 3) {
    const y = parseInt(parts[2])
    if (isNaN(y)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (followingPlayer) stopFollowing()
    
    miningActive = true
    await mineLayerInCurrentChunk(y)
    sendPrivateMessage(`✅ Listo! Capa ${y} minada.`)
    miningActive = false
  }
  else if (cmd === 'espiral' && parts.length === 2) {
    const y = parseInt(parts[1])
    if (isNaN(y)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (followingPlayer) stopFollowing()
    
    miningActive = true
    sendPrivateMessage(`🌀 Minando en espiral en capa Y=${y}...`)
    await spiralMining(y)
    miningActive = false
  }
  else if (cmd === 'linea' && parts.length === 3) {
    const y = parseInt(parts[1])
    const dir = parts[2]
    if (isNaN(y) || !['x+', 'x-', 'z+', 'z-'].includes(dir)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (followingPlayer) stopFollowing()
    
    miningActive = true
    sendPrivateMessage(`➡️ Minando en línea recta (${dir}) en capa Y=${y}...`)
    await lineMining(y, dir)
    miningActive = false
  }
  else if (cmd === 'agarra') {
    if (!chestLocation) {
      sendPrivateMessage('❌ No hay cofre registrado')
      return
    }
    
    const item = message.split(' ').slice(1).join(' ')
    if (await getItemFromChest(item, 1)) {
      sendPrivateMessage(`✅ Saqué ${item} del cofre`)
    }
  }
  // Seguimiento
  else if (cmd === 'seguime') {
    if (miningActive) {
      sendPrivateMessage('⚠️ Detén la minería con "parar" primero.')
      return
    }
    
    followingPlayer = true
    autoFollowEnabled = true
    startFollowing()
    sendPrivateMessage('🏃 Te sigo!')
  }
  else if (cmd === 'parar' || cmd === 'quieto') {
    // Detener TODA actividad
    miningActive = false
    followingPlayer = false
    autoFollowEnabled = false
    
    // Cancelar confirmaciones pendientes
    if (pendingConfirmation) {
      pendingConfirmation.resolve(false)
      pendingConfirmation = null
    }
    
    // Detener interval de seguimiento
    if (followInterval) {
      clearInterval(followInterval)
      followInterval = null
    }
    
    // Detener pathfinder de forma segura
    await safeSetGoal(null)
    
    // Mensaje apropiado
    if (cmd === 'parar') {
      sendPrivateMessage('🛑 Todo detenido.')
    } else {
      sendPrivateMessage('🚫 Me quedo quieto.')
    }
  }
  else if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(
      autoFollowEnabled ? 
      '✅ Modo autónomo ACTIVADO' : 
      '❌ Modo autónomo DESACTIVADO'
    )
    
    if (autoFollowEnabled && !followingPlayer && !miningActive) {
      startFollowing()
    }
  }
  // Información
  else if (cmd === 'aiuda' || cmd === 'help') {
    sendPrivateMessage('📋 COMANDOS MINERO:')
    sendPrivateMessage('⛏️ minar chunk, minar chunk completo, minar capa <Y>')
    sendPrivateMessage('🌀 espiral <Y>, linea <Y> x+|x-|z+|z-')
    sendPrivateMessage('🚶 seguime, quieto, auto, parar')
    sendPrivateMessage('📦 cofre x y z, mesa x y z, cama x y z, data')
    sendPrivateMessage('📍 pos, deposita, dormi, salud, equipo')
    sendPrivateMessage('✅ si/confirmar, no/cancelar')
  }
  else if (cmd === 'data') {
    sendPrivateMessage(
      `📦 Cofre: ${chestLocation ? 
        `${chestLocation.x} ${chestLocation.y} ${chestLocation.z}` : 
        'no'}`
    )
    sendPrivateMessage(
      `📐 Mesa: ${craftingTableLocation ? 
        `${craftingTableLocation.x} ${craftingTableLocation.y} ${craftingTableLocation.z}` : 
        'no'}`
    )
    sendPrivateMessage(
      `🛏️ Cama: ${bedLocation ? 
        `${bedLocation.x} ${bedLocation.y} ${bedLocation.z}` : 
        'no'}`
    )
  }
  else if (cmd === 'equipo') {
    reportPickaxes()
  }
  else if (cmd === 'pos' || cmd === 'dondetas') {
    const p = bot.entity.position
    sendPrivateMessage(
      `📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`
    )
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
    sendPrivateMessage(
      `❤️ Vida:${Math.round(bot.health)}/20 🍗 Hambre:${Math.round(bot.food)}/20`
    )
  }
  else if (cmd === 'cofre' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    
    chestLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cofre guardado en ${x} ${y} ${z}`)
  }
  else if (cmd === 'mesa' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    
    craftingTableLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Mesa guardada en ${x} ${y} ${z}`)
  }
  else if (cmd === 'cama' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    
    bedLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Cama guardada en ${x} ${y} ${z}`)
  }
  else if (cmd === 'mina' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    
    mineLocation = { x, y, z }
    saveState()
    sendPrivateMessage(`✅ Mina guardada en ${x} ${y} ${z}`)
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
  movements.allowLadder = true
  bot.pathfinder.setMovements(movements)
  
  loadState()
  setInterval(checkHealthAndHunger, 500)
  
  if (autoFollowEnabled && !followingPlayer && !miningActive) {
    startFollowing()
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

bot.on('health', () => {
  if (bot.health < 14 || bot.food < 18) {
    checkHealthAndHunger()
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