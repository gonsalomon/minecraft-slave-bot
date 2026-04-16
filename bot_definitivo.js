// =====================
//   BOT DEFINITIVO - LEÑADOR + COMERCIANTE
//   Corta madera, craftea palos y maximiza flecheros
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
  username: process.env.MC_USERNAME ?? 'definitivo',
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

const TREE_HEIGHT_LIMIT = 12
const MIN_FREE_SLOTS = 4

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'bread',
  'baked_potato', 'carrot', 'apple', 'melon_slice', 'cookie',
  'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken',
  'raw_salmon', 'raw_cod', 'rotten_flesh'
]

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'piglin_brute', 'hoglin', 'wither_skeleton',
  'enderman', 'silverfish', 'phantom', 'drowned', 'husk',
  'stray', 'bogged', 'breeze'
]

const VILLAGE_BLOCKS = new Set([
  'bed', 'cartography_table', 'lectern', 'composter', 'blast_furnace',
  'smoker', 'loom', 'grindstone', 'stonecutter', 'barrel',
  'fletching_table', 'smithing_table', 'bell'
])

const VILLAGE_RADIUS = 64

// ===================== ESTADO GLOBAL =====================
let chestLocation = null
let craftingTableLocation = null
let bedLocation = null
let villageLocation = null
let villageBedLocation = null
let villagerTrades = {}
let explorationActive = false
let woodcuttingActive = false
let tradingActive = false
let following = false
let followInterval = null
let autoFollowEnabled = false
let pathfindingLock = false
let pendingGoal = null
let isEating = false
let lastChunkX = 0, lastChunkZ = 0
let exploredChunks = new Set()

const STATE_FILE = './definitivo_state.json'

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
  } catch { console.log('📂 Sin estado previo') }
}

function saveState() {
  const data = {
    chestLocation,
    craftingTableLocation,
    bedLocation,
    villageLocation,
    villageBedLocation,
    villagerTrades
  }
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
      sendPrivateMessage(`⚠️ No tengo comida, traeme`)
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

// ========== SEGUIMIENTO ==========
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  following = true
  followInterval = setInterval(() => {
    if (!following && autoFollowEnabled) {
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
  let bedLoc = bedLocation || villageBedLocation
  if (!bedLoc) { sendPrivateMessage('❌ No hay cama registrada.'); return }
  await safeGoto(bedLoc.x, bedLoc.y, bedLoc.z, 2)
  const bed = bot.blockAt(new Vec3(bedLoc.x, bedLoc.y, bedLoc.z))
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
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pathfinding timeout')), 15000))
    ])
  } catch (err) {
    console.error('Error en pathfinding:', err.message)
    bot.pathfinder.setGoal(null)
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
  // Depositar logs para liberar espacio
  await depositLogs()
}

async function depositLogs() {
  if (!chestLocation) return
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
  const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
  if (!chestBlock || !chestBlock.name.includes('chest')) return
  const chest = await bot.openChest(chestBlock)
  
  // Depositar solo logs, mantener sticks y comida
  let depositedLogs = 0
  for (const item of bot.inventory.items()) {
    if (item.name.includes('_log')) {
      await chest.deposit(item.type, null, item.count)
      depositedLogs += item.count
    }
  }
  chest.close()
  if (depositedLogs > 0) console.log(`✅ Depositados ${depositedLogs} logs en cofre`)
}

async function depositInChest() {
  if (!chestLocation) return
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
  const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
  if (!chestBlock || !chestBlock.name.includes('chest')) { sendPrivateMessage('No encuentro el cofre.'); return }
  const chest = await bot.openChest(chestBlock)
  // Depositar todo excepto herramientas, comida, sticks y madera
  const keepTypes = new Set()
  for (const item of bot.inventory.items()) {
    if (item.name.includes('axe') || item.name === 'stick' || item.name.includes('_log') ||
        FOOD_PRIORITY.includes(item.name)) keepTypes.add(item.type)
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
  // Leaves don't need a tool, just break them normally
  for (const leaf of leavesToBreak) {
    try {
      await safeGoto(leaf.position.x, leaf.position.y, leaf.position.z, 2)
      await bot.dig(leaf)
      await sleep(50)
    } catch {}
  }
}

async function plantSapling(originalTreeBase) {
  const sapling = bot.inventory.items().find(i => i.name.includes('sapling'))
  if (!sapling) { sendPrivateMessage('🌱 No tengo plántulas para reforestar.'); return false }
  const plantPos = originalTreeBase
  const groundBlock = bot.blockAt(plantPos)
  if (groundBlock && groundBlock.name !== 'air') {
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

// ===================== AUTO-DETECCIÓN DE UBICACIONES =====================
async function autoDetectLocations() {
  sendPrivateMessage('🔍 Auto-detectando ubicaciones...')

  // Buscar cofre
  if (!chestLocation) {
    const chest = bot.findBlock({ matching: b => b && b.name.includes('chest'), maxDistance: 32 })
    if (chest) {
      chestLocation = { x: chest.position.x, y: chest.position.y, z: chest.position.z }
      sendPrivateMessage(`✅ Cofre encontrado en ${chestLocation.x} ${chestLocation.y} ${chestLocation.z}`)
    }
  }

  // Buscar mesa de crafteo
  if (!craftingTableLocation) {
    const table = bot.findBlock({ matching: b => b && b.name === 'crafting_table', maxDistance: 32 })
    if (table) {
      craftingTableLocation = { x: table.position.x, y: table.position.y, z: table.position.z }
      sendPrivateMessage(`✅ Mesa encontrada en ${craftingTableLocation.x} ${craftingTableLocation.y} ${craftingTableLocation.z}`)
    }
  }

  // Buscar cama
  if (!bedLocation) {
    const bed = bot.findBlock({ matching: b => b && b.name.includes('bed'), maxDistance: 32 })
    if (bed) {
      bedLocation = { x: bed.position.x, y: bed.position.y, z: bed.position.z }
      sendPrivateMessage(`✅ Cama encontrada en ${bedLocation.x} ${bedLocation.y} ${bedLocation.z}`)
    }
  }

  saveState()
}

// ===================== TALA DE ÁRBOLES =====================
async function ensureAxe() {
  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('axe')) return true
  const axe = bot.inventory.items().find(i => i.name.includes('axe'))
  if (axe) { await bot.equip(axe, 'hand'); return true }
  sendPrivateMessage('❌ No tengo hacha')
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
  if (!await ensureAxe()) { woodcuttingActive = false; return false }
  for (const block of tree.blocks) {
    if (!explorationActive && !woodcuttingActive) break
    try {
      await safeGoto(block.position.x, block.position.y, block.position.z, 2)
      await bot.dig(block)
      await sleep(100)
      await depositExcessIfNeeded()
    } catch (err) {
      if (err.message?.includes('Digging aborted')) {
        console.log('⚠️ Dig interrupted, reintentando...')
        await sleep(500)
      } else {
        console.error('Error cortando árbol:', err)
      }
    }
  }
  try {
    await breakLeavesAround(tree.basePos)
    await pickupNearbyItems()
    await plantSapling(tree.basePos)
  } catch (err) {
    console.error('Error procesando árbol:', err)
  }
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

// ===================== CRAFTEO =====================
async function equipToHotbar(itemName) {
  // Buscar item en inventario
  const item = bot.inventory.items().find(i => i.name === itemName)
  if (!item) return false
  
  // Equipar a la mano para que esté listo
  try {
    await bot.equip(item, 'hand')
    console.log(`✅ Equipado ${itemName} en la mano`)
    return true
  } catch (err) {
    console.error('Error equipando item:', err.message)
    return false
  }
}

async function craftPlanks(logType) {
  if (!craftingTableLocation) {
    sendPrivateMessage('❌ No hay mesa de crafteo registrada')
    return false
  }

  const planksType = logType.replace('_log', '_planks')

  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    if (!table || !table.name.includes('crafting_table')) {
      sendPrivateMessage('❌ No encuentro la mesa de crafteo')
      return false
    }

    // Equipar el log en la mano antes de craftear
    await equipToHotbar(logType)
    await sleep(200)

    const recipes = bot.recipesFor(mcData.itemsByName[planksType].id, null, null, table)
    if (recipes.length > 0) {
      await bot.craft(recipes[0], null, table)
      console.log(`✅ Crafteadas tablas de ${planksType}`)
      return true
    } else {
      console.log(`⚠️ No hay receta para ${planksType}`)
      return false
    }
  } catch (err) {
    console.error('Error crafting planks:', err.message)
    return false
  }
}

async function craftSticks() {
  try {
    // Verificar si tenemos planks
    const planks = bot.inventory.items().find(i => i.name.includes('_planks'))
    if (!planks) {
      console.log('⚠️ No tengo planks para craftear sticks')
      return false
    }

    // Buscar receta de sticks en inventario (sin necesidad de crafting table)
    const recipes = bot.recipesFor(mcData.itemsByName.stick.id)
    if (recipes.length === 0) {
      console.log('⚠️ No hay receta disponible para sticks')
      return false
    }

    // Usar la primera receta disponible
    await bot.craft(recipes[0], 1)
    console.log('✅ Crafteados sticks')
    return true
  } catch (err) {
    console.error('Error crafting sticks:', err.message)
    return false
  }
}

async function processWoodToSticks() {
  // Verificar si tenemos logs
  const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
  if (logs.length === 0) {
    console.log('⚠️ No hay logs para procesar')
    return
  }

  console.log(`📦 Procesando ${logs.reduce((s, l) => s + l.count, 0)} logs...`)

  // Convertir cada tipo de log a planks
  for (const log of logs) {
    const result = await craftPlanks(log.name)
    if (!result) {
      console.log(`⚠️ Fallo craftear ${log.name}, continuando...`)
    }
    await sleep(500)
  }

  // Intentar craftear sticks con las planks
  await sleep(1000)
  const result = await craftSticks()
  if (!result) {
    console.log('⚠️ Fallo craftear sticks, pero continuamos')
  }
}

// ===================== EXPLORACIÓN =====================
async function exploreChunks() {
  while (explorationActive) {
    await checkHealthAndHunger()
    const tree = findCompleteTree(16)
    if (tree && !woodcuttingActive) {
      await cutTree(tree)
      await processWoodToSticks()
      await depositExcessIfNeeded()
      continue
    }
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

// ===================== FUNCIONES DE ALDEANOS =====================
function getNearestVillager(maxDistance = 64, profession = null) {
  let nearest = null
  let minDist = maxDistance

  Object.values(bot.entities).forEach(entity => {
    if (entity.name === 'villager' || entity.name === 'villager_v2') {
      if (profession && entity.metadata && entity.metadata[18]) {
        const professionData = entity.metadata[18]
        if (professionData.profession !== profession) return
      }
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

async function fetchVillagerTrades(villagerEntity) {
  let attempts = 0

  while (attempts < 2) {
    try {
      // Use Promise.race to limit openVillager timeout
      const villagerWindow = await Promise.race([
        bot.openVillager(villagerEntity),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout abriendo aldeano')), 8000)
        )
      ])

      await sleep(200)
      const trades = villagerWindow.trades

      if (trades && trades.length > 0) {
        return { trades, window: villagerWindow }
      }

      villagerWindow.close()
      attempts++
      await sleep(500)
    } catch (err) {
      attempts++
      console.error(`Intento ${attempts} fallido: ${err.message}`)
      if (attempts < 2) {
        await sleep(1500)
      }
    }
  }

  return { trades: null, window: null }
}

async function investigateAllVillagers() {
  const villagers = Object.values(bot.entities).filter(e => {
    if (e.name !== 'villager' && e.name !== 'villager_v2') return false
    if (!e.metadata || !e.metadata[18]) return false
    const prof = e.metadata[18].profession
    return prof !== 'none' && prof !== 'nitwit'
  })

  if (villagers.length === 0) {
    console.log('❌ No hay aldeanos con oficio en radio de 64 bloques.')
    return
  }

  console.log(`🔍 Investigando ${villagers.length} aldeanos con oficio...`)

  let registered = 0
  let skippedErrors = 0

  for (let i = 0; i < villagers.length; i++) {
    const villager = villagers[i]
    const dist = villager.position.distanceTo(bot.entity.position)
    console.log(`[${i + 1}/${villagers.length}] Investigando aldeano a ${Math.floor(dist)} bloques...`)

    try {
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
      try {
        bot.pathfinder.setGoal(null)
      } catch {}
    }

    if (i < villagers.length - 1) await sleep(1500)
  }

  saveState()
  console.log(`📊 Investigación completada: ${registered}/${villagers.length} registrados (${skippedErrors} con errores).`)
}

// ===================== OPTIMIZACIÓN COMPLETA =====================
async function optimizeVillage() {
  sendPrivateMessage('🎯 Iniciando optimización de aldea...')
  
  // Paso 1: Investigar aldeanos UNA SOLA VEZ (sin romper si hay error)
  try {
    sendPrivateMessage('📋 Escaneando aldeanos...')
    await investigateAllVillagers()
    await sleep(2000)
  } catch (err) {
    console.error('Error en investigación:', err.message)
    sendPrivateMessage('⚠️ Investigación parcial completada')
    await sleep(1000)
  }
  
  // Paso 2: Comenzar trading loop
  sendPrivateMessage('🏹 Iniciando trading...')
  tradingActive = true
  explorationActive = false
  await sleep(1000)
  
  // Paso 3: Loop principal - solo cortar y tradear
  let optimizationCycles = 0
  while (tradingActive && optimizationCycles < 100) {
    optimizationCycles++
    
    try {
      await checkHealthAndHunger()

      const sticksCount = bot.inventory.items()
        .filter(i => i.name === 'stick')
        .reduce((sum, i) => sum + i.count, 0)

      console.log(`📊 Ciclo ${optimizationCycles}: ${sticksCount} sticks disponibles`)

      // FASE 1: Cortar madera
      if (sticksCount < 128) {
        console.log('🌲 Cortando madera...')
        const tree = findCompleteTree(30)
        if (tree) {
          await cutTree(tree)
          await sleep(1000)
        } else {
          console.log('⚠️ No hay árboles cerca, buscando...')
          const cx = Math.floor(bot.entity.position.x / 16)
          const cz = Math.floor(bot.entity.position.z / 16)
          const nextX = (cx + 1) * 16 + 8
          const nextZ = cz * 16 + 8
          await safeGoto(nextX, bot.entity.position.y, nextZ, 8)
          await sleep(5000)
          continue
        }
      }

      // FASE 2: Buscar y tradear con flecheros
      console.log('🏹 Buscando flecheros para trade...')
      const fletchers = await findFletchers()
      
      if (fletchers.length === 0) {
        console.log('❌ Sin flecheros. Esperando...')
        await sleep(10000)
        continue
      }

      let cycleCompletedTrades = 0
      for (const fletcher of fletchers) {
        try {
          const traded = await tradeWithFletcher(fletcher)
          if (traded) cycleCompletedTrades++
          await sleep(1500)
        } catch (err) {
          console.error('Error en trade:', err.message)
        }
      }

      console.log(`✅ Ciclo ${optimizationCycles}: ${cycleCompletedTrades} trades completados`)
      await sleep(5000)
    } catch (err) {
      console.error('Error en ciclo de optimización:', err.message)
      await sleep(2000)
    }
  }

  sendPrivateMessage('🎯 Optimización completada')
  tradingActive = false
}

// ===================== COMERCIO CON FLECHEROS =====================
async function findFletchers() {
  const fletchers = Object.values(bot.entities).filter(e => {
    if (e.name !== 'villager' && e.name !== 'villager_v2') return false
    if (!e.metadata || !e.metadata[18]) return false
    return e.metadata[18].profession === 'fletcher'
  })

  return fletchers
}

async function tradeWithFletcher(fletcher) {
  if (!villagerTrades[fletcher.id]) {
    sendPrivateMessage('❌ No tengo trades registrados para este flechero')
    return false
  }

  const trades = villagerTrades[fletcher.id]
  let tradesCompleted = 0

  try {
    await safeGoto(fletcher.position.x, fletcher.position.y, fletcher.position.z, 3)
    await sleep(500)

    const { trades: currentTrades, window } = await fetchVillagerTrades(fletcher)
    if (!currentTrades || !window) {
      sendPrivateMessage('❌ No pude abrir ventana de comercio')
      return false
    }

    for (const trade of currentTrades) {
      // Solo trades que requieren sticks
      if (trade.inputItem1?.name === 'stick' || trade.inputItem2?.name === 'stick') {
        const sticksNeeded = (trade.inputItem1?.name === 'stick' ? trade.inputItem1.count : 0) +
                           (trade.inputItem2?.name === 'stick' ? trade.inputItem2.count : 0)

        const sticksAvailable = bot.inventory.items()
          .filter(i => i.name === 'stick')
          .reduce((sum, i) => sum + i.count, 0)

        if (sticksAvailable >= sticksNeeded && trade.uses < trade.maxUses) {
          try {
            await bot.trade(window, currentTrades.indexOf(trade), 1)
            tradesCompleted++
            await sleep(500)
          } catch (err) {
            console.error('Error en trade:', err)
          }
        }
      }
    }

    window.close()
    if (tradesCompleted > 0) {
      sendPrivateMessage(`✅ Completados ${tradesCompleted} trades con flechero`)
    }
    return tradesCompleted > 0

  } catch (err) {
    console.error('Error tradando con flechero:', err)
    return false
  }
}

async function maxOutFletchers() {
  const fletchers = await findFletchers()
  if (fletchers.length === 0) {
    sendPrivateMessage('❌ No hay flecheros cerca')
    return
  }

  sendPrivateMessage(`🏹 Encontrados ${fletchers.length} flecheros. Maximizando...`)

  let totalTrades = 0
  for (const fletcher of fletchers) {
    const trades = await tradeWithFletcher(fletcher)
    if (trades) totalTrades += trades
    await sleep(2000) // Esperar entre flecheros
  }

  sendPrivateMessage(`🎯 Total trades completados: ${totalTrades}`)
}

// ===================== MODO TRADING =====================
async function startTradingMode() {
  tradingActive = true
  sendPrivateMessage('🏹 Modo trading activado - Buscando flecheros...')

  while (tradingActive) {
    await checkHealthAndHunger()

    // Asegurar que tenemos sticks
    const sticksCount = bot.inventory.items()
      .filter(i => i.name === 'stick')
      .reduce((sum, i) => sum + i.count, 0)

    if (sticksCount < 64) {
      // Cortar madera y craftear sticks
      const tree = findCompleteTree(20)
      if (tree) {
        await cutTree(tree)
        await processWoodToSticks()
      } else {
        sendPrivateMessage('⚠️ No hay árboles cerca para sticks')
        await sleep(5000)
        continue
      }
    }

    // Buscar y trade con flecheros
    await maxOutFletchers()

    // Esperar antes de siguiente ciclo
    await sleep(10000)
  }
}

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const msg = message.toLowerCase().trim()
  const parts = message.split(' ')
  const cmd = parts[0].toLowerCase()

  if (cmd === 'optimize' || cmd === 'optimizar') {
    if (explorationActive || tradingActive || following) {
      stopFollowing()
      explorationActive = false
      tradingActive = false
      await sleep(1000)
    }
    await optimizeVillage()
  }
  else if (cmd === 'explora') {
    if (following) stopFollowing()
    explorationActive = true
    woodcuttingActive = false
    tradingActive = false
    sendPrivateMessage('🌲 Modo leñador activado.')
    exploreChunks()
  }
  else if (cmd === 'trade') {
    if (following) stopFollowing()
    explorationActive = false
    woodcuttingActive = false
    tradingActive = true
    sendPrivateMessage('🏹 Modo trading activado.')
    startTradingMode()
  }
  else if (cmd === 'para') {
    explorationActive = false
    woodcuttingActive = false
    tradingActive = false
    stopFollowing()
    bot.pathfinder.setGoal(null)
    sendPrivateMessage('🛑 Detenido.')
  }
  else if (cmd === 'sigueme') {
    explorationActive = false
    woodcuttingActive = false
    tradingActive = false
    startFollowing()
    sendPrivateMessage(`🚶 Siguiendo a ${MASTER}.`)
  }
  else if (cmd === 'quieto') {
    stopFollowing()
    sendPrivateMessage('🚫 Me quedo quieto.')
  }
  else if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo autónomo ACTIVADO' : '❌ Modo autónomo DESACTIVADO')
    if (autoFollowEnabled && !following) {
      following = true
      startFollowing(MASTER)
      sendPrivateMessage(`🚶 Siguiendo a ${MASTER}...`)
    }
    return
  }
  else if (cmd === 'pos') {
    const p = bot.entity.position
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
  }
  else if (cmd === 'deposita') {
    await depositInChest()
  }
  else if (cmd === 'dormi') {
    explorationActive = false
    tradingActive = false
    stopFollowing()
    await sleepInBed()
  }
  else if (cmd === 'detectar') {
    await autoDetectLocations()
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
  else if (cmd === 'averiguar') {
    await investigateAllVillagers()
  }
  else if (cmd === 'salud') {
    sendPrivateMessage(`❤️ ${Math.round(bot.health)}/20 🍗 ${Math.round(bot.food)}/20`)
  }
  else {
    sendPrivateMessage(`❌ Comando no reconocido. Usa: optimize, explora, trade, averiguar, etc.`)
  }
}

// ===================== EVENTOS =====================
bot.on('spawn', async () => {
  console.log('✅ Bot definitivo conectado')
  sendPrivateMessage('🌲🏹 Bot definitivo listo. Auto-detectando ubicaciones...')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  movements.allowParkour = false
  movements.allowSneaking = false
  bot.pathfinder.setMovements(movements)
  loadState()
  
  // Auto-detectar ubicaciones
  await sleep(2000)
  await autoDetectLocations()
  
  setInterval(checkHealthAndHunger, 5000)
  setInterval(() => { if (!explorationActive && !tradingActive && !following) depositExcessIfNeeded() }, 30000)
})

bot.on('whisper', async (username, message) => {
  if (username !== MASTER) { bot.chat(`/tell ${username} Solo respondo a ${MASTER}.`); return }
  try {
    await handleCommand(message)
  } catch (err) {
    console.error('Error en comando:', err)
    sendPrivateMessage(`⚠️ Error: ${err.message}`)
  }
})

bot.on('chat', async (username, message) => {
  if (username === bot.username || username !== MASTER) return
  try {
    await handleCommand(message)
  } catch (err) {
    console.error('Error en comando:', err)
    sendPrivateMessage(`⚠️ Error: ${err.message}`)
  }
})

bot.on('health', () => { if (bot.health < 14 || bot.food < 18) checkHealthAndHunger() })

bot.on('error', err => {
  if (err.message?.includes('GoalChanged') || err.message?.includes('Digging aborted')) {
    console.log('🔄 Error ignorado:', err.message)
    pathfindingLock = false
    return
  }
  console.error('❌ Error:', err)
  sendPrivateMessage(`⚠️ Error del sistema`)
})

bot.on('end', () => {
  console.log('🔌 Bot desconectado')
  explorationActive = false
  tradingActive = false
  woodcuttingActive = false
  stopFollowing()
})