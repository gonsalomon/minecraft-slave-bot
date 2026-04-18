// =====================
//   BOT DEFINITIVO v2 - TODAS LAS FUNCIONALIDADES
//   Leñador + Minero + Comerciante + Combatiente
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
  'stone_slab', 'ladder', 'scaffolding', 'chest', 'crafting_table', 
  'furnace', 'bed', 'enchanting_table', 'torch', 'glass', 'glass_pane'
])

const TOOL_MATERIAL_MAP = {
  wooden_axe: '_planks', wooden_pickaxe: '_planks', wooden_shovel: '_planks',
  stone_axe: 'cobblestone', stone_pickaxe: 'cobblestone', stone_shovel: 'cobblestone',
  iron_axe: 'iron_ingot', iron_pickaxe: 'iron_ingot', iron_shovel: 'iron_ingot',
}

const PICKAXE_REQUIRED = {
  'stone': 'wooden_pickaxe', 'cobblestone': 'wooden_pickaxe',
  'coal_ore': 'wooden_pickaxe', 'deepslate_coal_ore': 'wooden_pickaxe',
  'iron_ore': 'stone_pickaxe', 'deepslate_iron_ore': 'stone_pickaxe',
  'lapis_ore': 'stone_pickaxe', 'deepslate_lapis_ore': 'stone_pickaxe',
  'gold_ore': 'stone_pickaxe', 'deepslate_gold_ore': 'stone_pickaxe',
  'diamond_ore': 'iron_pickaxe', 'deepslate_diamond_ore': 'iron_pickaxe',
  'emerald_ore': 'iron_pickaxe', 'deepslate_emerald_ore': 'iron_pickaxe',
  'redstone_ore': 'iron_pickaxe', 'deepslate_redstone_ore': 'iron_pickaxe',
  'obsidian': 'diamond_pickaxe', 'ancient_debris': 'diamond_pickaxe'
}

const PICKAXE_TIER = {
  'wooden_pickaxe': 1, 'stone_pickaxe': 2, 'golden_pickaxe': 2,
  'iron_pickaxe': 3, 'diamond_pickaxe': 4, 'netherite_pickaxe': 5
}

const PICKAXE_CRAFT = {
  'wooden_pickaxe': { planks: 3, sticks: 2, planksType: 'oak_planks' },
  'stone_pickaxe': { cobblestone: 3, sticks: 2 },
  'iron_pickaxe': { iron_ingot: 3, sticks: 2 },
  'golden_pickaxe': { gold_ingot: 3, sticks: 2 },
  'diamond_pickaxe': { diamond: 3, sticks: 2 }
}

const OPTIMAL_Y = {
  'coal_ore': 96, 'deepslate_coal_ore': 0, 'iron_ore': 16,
  'deepslate_iron_ore': -16, 'gold_ore': -16, 'deepslate_gold_ore': -16,
  'lapis_ore': 0, 'deepslate_lapis_ore': -32, 'diamond_ore': -58,
  'deepslate_diamond_ore': -58, 'redstone_ore': -58, 'deepslate_redstone_ore': -58,
  'emerald_ore': -16, 'ancient_debris': 15, 'obsidian': -40
}

const WEAPON_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe',
  'stone_axe', 'golden_axe', 'wooden_axe'
]

const AXE_PRIORITY = [
  'netherite_axe', 'diamond_axe', 'iron_axe',
  'stone_axe', 'golden_axe', 'wooden_axe'
]

const ARMOR_PRIORITY = {
  head: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'golden_helmet', 'chainmail_helmet', 'leather_helmet'],
  torso: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'golden_chestplate', 'chainmail_chestplate', 'leather_chestplate'],
  legs: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'golden_leggings', 'chainmail_leggings', 'leather_leggings'],
  feet: ['netherite_boots', 'diamond_boots', 'iron_boots', 'golden_boots', 'chainmail_boots', 'leather_boots']
}

const CombatState = {
  IDLE: 'idle', APPROACHING: 'approaching', BLOCKING: 'blocking',
  ATTACKING: 'attacking', RETREATING: 'retreating', HEALING: 'healing'
}

const HUNT_CONFIG = {
  combatRange: 3, safeHealth: 12, safeFood: 12, retreatHealth: 8,
  blockChance: 0.7, blockDuration: 20, attackCooldown: 12,
  shieldCheckInterval: 5, fallbackDistance: 15, awarenessRadius: 16
}

const SPECIAL_MOBS = {
  creeper: { strategy: 'hit_and_run', safeDistance: 4, warning: '💣 Creeper!' },
  skeleton: { strategy: 'shield_rush', safeDistance: 2, warning: '🏹 Esqueleto!' },
  spider: { strategy: 'aggressive', safeDistance: 2, warning: '🕷️ Araña!' },
  enderman: { strategy: 'avoid', safeDistance: 8, warning: '👁️ Enderman!' },
  witch: { strategy: 'rush', safeDistance: 3, warning: '🧪 Bruja!' },
  blaze: { strategy: 'ranged_dodge', safeDistance: 5, warning: '🔥 Blaze!' }
}

const DODGE_CONFIG = {
  enabled: true, detectionRadius: 8, safeDistance: 12,
  checkInterval: 500, priorityOverride: true
}

const TORCH_CONFIG = {
  maxStack: 64, lightLevel: 7, placeInterval: 10
}

// ===================== ESTADO GLOBAL =====================
let chestLocations = []       // Array of chest locations
let chestBlacklist = []       // Chests the bot cannot use
let craftingTableLocation = null

// Get closest chest to current position (excluding blacklisted)
function getClosestChest() {
  if (chestLocations.length === 0) return null
  
  const pos = bot.entity.position
  let closest = null
  let minDist = Infinity
  
  for (const chest of chestLocations) {
    // Skip blacklisted chests
    if (chestBlacklist.some(b => b.x === chest.x && b.y === chest.y && b.z === chest.z)) continue
    
    const dx = chest.x - pos.x
    const dz = chest.z - pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < minDist) {
      minDist = dist
      closest = chest
    }
  }
  
  return closest
}

// Get chest location (backwards compatibility - first chest or null)
function getChestLocation() {
  return chestLocations.length > 0 ? chestLocations[0] : null
}

// Check if chest is blacklisted
function isChestBlacklisted(x, y, z) {
  return chestBlacklist.some(c => c.x === x && c.y === y && c.z === z)
}

// Auto-discover chests in surrounding area
async function discoverChests(radius = 16) {
  const pos = bot.entity.position
  const foundChests = []
  
  sendPrivateMessage(`🔍 Escaneando radio ${radius} bloques...`)
  
  for (let x = Math.floor(pos.x) - radius; x <= Math.floor(pos.x) + radius; x++) {
    for (let y = Math.floor(pos.y) - radius; y <= Math.floor(pos.y) + radius; y++) {
      for (let z = Math.floor(pos.z) - radius; z <= Math.floor(pos.z) + radius; z++) {
        try {
          const block = bot.blockAt(new Vec3(x, y, z))
          if (block && block.name.includes('chest')) {
            const alreadyRegistered = chestLocations.some(c => c.x === x && c.y === y && c.z === z)
            const isBlacklisted = isChestBlacklisted(x, y, z)
            
            if (!alreadyRegistered && !isBlacklisted) {
              foundChests.push({ x, y, z })
            }
          }
        } catch (err) {
          // Ignore individual block errors
        }
      }
    }
  }
  
  if (foundChests.length > 0) {
    chestLocations.push(...foundChests)
    saveState()
    sendPrivateMessage(`📦 Descubiertos ${foundChests.length} cofres nuevos!`)
    foundChests.forEach((c, i) => {
      sendPrivateMessage(`  ${i + 1}. X:${c.x} Y:${c.y} Z:${c.z}`)
    })
  } else {
    sendPrivateMessage(`📦 No encontré cofres nuevos (radio ${radius})`)
  }
  
  return foundChests
}

// Craft a chest
async function craftChest() {
  if (!craftingTableLocation) {
    sendPrivateMessage('❌ Necesito mesa de crafteo')
    return false
  }
  
  // Check for wood planks
  const planks = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks']
  let plankCount = 0
  for (const p of planks) {
    plankCount += bot.inventory.items().filter(i => i.name === p).reduce((s, i) => s + i.count, 0)
  }
  
  if (plankCount < 8) {
    sendPrivateMessage('🪵 No tengo suficientes planks (necesito 8), busco madera...')
    await findAndCutWood(16)  // Cut some trees
    // Recount
    for (const p of planks) {
      plankCount += bot.inventory.items().filter(i => i.name === p).reduce((s, i) => s + i.count, 0)
    }
    if (plankCount < 8) {
      sendPrivateMessage('❌ No encontré suficiente madera')
      return false
    }
  }
  
  await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
  const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
  if (!table?.name.includes('crafting_table')) {
    sendPrivateMessage('❌ No encuentro la mesa')
    return false
  }
  
  const chestId = mcData.itemsByName['chest']?.id
  if (!chestId) return false
  
  const recipes = bot.recipesFor(chestId, null, 1, table)
  if (recipes.length === 0) {
    sendPrivateMessage('❌ Sin receta para cofre')
    return false
  }
  
  try {
    await bot.craft(recipes[0], 1, table)
    sendPrivateMessage('✅ Crafteado 1 cofre')
    return true
  } catch (err) {
    console.error('Error crafting chest:', err.message)
    return false
  }
}

// Find and cut wood (for crafting materials)
async function findAndCutWood(minLogs = 8) {
  const woodTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
  let woodCount = bot.inventory.items().filter(i => woodTypes.includes(i.name)).reduce((s, i) => s + i.count, 0)
  
  if (woodCount >= minLogs) return true
  
  sendPrivateMessage('🌲 Buscando árboles...')
  
  // Find nearest tree using pathfinding
  const pos = bot.entity.position
  let nearestTree = null
  let minDist = 32
  
  for (let x = Math.floor(pos.x) - 32; x <= Math.floor(pos.x) + 32; x++) {
    for (let z = Math.floor(pos.z) - 32; z <= Math.floor(pos.z) + 32; z++) {
      for (let y = Math.floor(pos.y) - 5; y <= Math.floor(pos.y) + 10; y++) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (block && woodTypes.includes(block.name)) {
          const dist = Math.sqrt((x - pos.x) ** 2 + (z - pos.z) ** 2)
          if (dist < minDist) {
            minDist = dist
            nearestTree = { x, y, z }
          }
        }
      }
    }
  }
  
  if (!nearestTree) {
    sendPrivateMessage('❌ No encontré árboles cercanos')
    return false
  }
  
  sendPrivateMessage(`🌲 Encontré árbol en X:${nearestTree.x} Z:${nearestTree.z}`)
  await safeGoto(nearestTree.x, nearestTree.y, nearestTree.z, 2)
  
  // Cut the tree
  const blocksToMine = []
  for (let y = nearestTree.y; y <= nearestTree.y + 5; y++) {
    const block = bot.blockAt(new Vec3(nearestTree.x, y, nearestTree.z))
    if (block && woodTypes.includes(block.name)) {
      blocksToMine.push(block)
    }
  }
  
  for (const block of blocksToMine) {
    try {
      await bot.tool.equipForBlock(block)
      await bot.dig(block)
      await sleep(200)
    } catch (err) {
      console.error('Error mining wood:', err.message)
    }
  }
  
  // Process wood to planks
  const logs = bot.inventory.items().filter(i => woodTypes.includes(i.name))
  for (const log of logs) {
    await craftPlanks(log.name)
    await sleep(300)
  }
  
  woodCount = bot.inventory.items().filter(i => woodTypes.includes(i.name)).reduce((s, i) => s + i.count, 0)
  const plankCount = bot.inventory.items().filter(i => planks.includes(i.name)).reduce((s, i) => s + i.count, 0)
  sendPrivateMessage(`🪵 Tengo ${woodCount} logs y ${plankCount} planks`)
  
  return plankCount >= 8 || woodCount >= 2
}
let bedLocation = null
let villageLocation = null
let villageBedLocation = null
let mineLocation = null
let farmLocation = null
let villagerTrades = {}

let explorationActive = false
let woodcuttingActive = false
let miningActive = false
let miningTarget = null
let currentChunkMining = null
let miningMode = null        // 'auto', 'descending', 'spiral', 'line'
let currentLayerY = null     // Current layer being mined
let pendingConfirmation = null  // For interactive confirmation
let tradingActive = false
let huntingActive = false
let patrolActive = false

let following = false
let followInterval = null
let autoFollowEnabled = false
let cuidameMode = false

let currentCombatState = CombatState.IDLE
let currentTarget = null
let lastShieldUse = 0

let pathfindingLock = false
let pendingGoal = null
let isEating = false
let isDodging = false
let dodgeInterval = null
let lastChunkX = 0, lastChunkZ = 0
let exploredChunks = new Set()

let operationCancelled = false
const STATE_FILE = './definitivo_state.json'
const MINING_STATE_FILE = './mining_state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocations = data.chestLocations ?? []
    chestBlacklist = data.chestBlacklist ?? []
    craftingTableLocation = data.craftingTableLocation ?? null
    bedLocation = data.bedLocation ?? null
    villageLocation = data.villageLocation ?? null
    villageBedLocation = data.villageBedLocation ?? null
    mineLocation = data.mineLocation ?? null
    farmLocation = data.farmLocation ?? null
    villagerTrades = data.villagerTrades ?? {}
    console.log('📂 Estado cargado:', data)
  } catch { console.log('📂 Sin estado previo') }
}

function saveState() {
  const data = {
    chestLocations, chestBlacklist, craftingTableLocation, bedLocation,
    villageLocation, villageBedLocation, mineLocation, farmLocation, villagerTrades
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

function saveMiningProgress() {
  if (!miningActive) return
  const progress = {
    active: miningActive,
    target: miningTarget,
    chunkX: currentChunkMining?.chunkX,
    chunkZ: currentChunkMining?.chunkZ,
    startX: currentChunkMining?.startX,
    startZ: currentChunkMining?.startZ,
    layer: currentChunkMining?.startY,
    posX: Math.floor(bot.entity.position.x),
    posZ: Math.floor(bot.entity.position.z)
  }
  fs.writeFileSync(MINING_STATE_FILE, JSON.stringify(progress, null, 2))
}

function loadMiningProgress() {
  try {
    const data = JSON.parse(fs.readFileSync(MINING_STATE_FILE, 'utf8'))
    if (data.active && data.target) return data
  } catch { }
  return null
}

function clearMiningProgress() {
  if (fs.existsSync(MINING_STATE_FILE)) fs.unlinkSync(MINING_STATE_FILE)
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
  while (pathfindingLock && waited < 30) { 
    await sleep(100)
    waited++ 
  }
  
  if (pathfindingLock) { 
    pathfindingLock = false
    try { bot.pathfinder.setGoal(null) } catch {}
    await sleep(50) 
  }
  
  try {
    if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null)
  } catch {}
  
  setSprintMode(false)
  
  try {
    pathfindingLock = true
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('safeGoto_timeout')), 30000))
    ])
    return true
  } catch (err) {
    const isMinor = err.message?.includes('GoalChanged') || 
                    err.message?.includes('timeout') ||
                    err.message?.includes('Timeout')
    if (!isMinor) {
      console.error('⚠️ safeGoto error:', err.message)
    }
    try { bot.pathfinder.setGoal(null) } catch {}
    return false
  } finally {
    setSprintMode(true)
    pathfindingLock = false
  }
}

function setSprintMode(enabled) {
  const movements = new Movements(bot)
  movements.allowSprinting = enabled
  movements.allowParkour = true
  movements.allowSneaking = true
  bot.pathfinder.setMovements(movements)
}

function getInventoryUsedSlots() { return bot.inventory.items().length }
function hasFreeSlots(required = MIN_FREE_SLOTS) { return (36 - getInventoryUsedSlots()) >= required }

function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    return b && (b.name === 'lava' || b.name === 'flowing_lava')
  })
}

function getInventoryHash() {
  return bot.inventory.items()
    .filter(i => !i.name.includes('pickaxe') && !i.name.includes('sword') &&
      !Object.values(ARMOR_PRIORITY).flat().includes(i.name) && !FOOD_PRIORITY.includes(i.name))
    .map(i => `${i.name}:${i.count}`).sort().join('|')
}

// ===================== COMIDA Y SALUD =====================
function findBestFood() {
  for (const name of FOOD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  return null
}

// Safe wrapper for opening chests with timeout
async function openChestSafe(block) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Chest open timeout'))
    }, 5000)
    
    bot.openChest(block).then(chest => {
      clearTimeout(timeout)
      resolve(chest)
    }).catch(err => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function getFoodFromChest() {
  const chest = getClosestChest()
  if (!chest) return false
  
  try {
    await safeGoto(chest.x, chest.y, chest.z, 2)
    await sleep(500) // Wait for pathfinding to complete
    
    const chestBlock = bot.blockAt(new Vec3(chest.x, chest.y, chest.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) return false
    
    const openedChest = await openChestSafe(chestBlock)
    let found = false
    for (const name of FOOD_PRIORITY) {
      const item = openedChest.containerItems().find(i => i.name === name)
      if (item) { 
        await openedChest.withdraw(item.type, null, Math.min(item.count, 16)); 
        found = true; 
        break 
      }
    }
    openedChest.close()
    return found
  } catch (err) {
    console.error('Error getting food from chest:', err.message)
    return false
  }
}

async function eatFood() {
  if (isEating) return
  isEating = true
  try {
    let food = findBestFood()
    if (!food && getClosestChest()) {
      const got = await getFoodFromChest()
      if (got) food = findBestFood()
    }
    if (!food) { sendPrivateMessage('⚠️ No tengo comida, traeme'); return }
    await bot.equip(food, 'hand')
    await bot.consume()
    await sleep(500)
  } catch (err) { console.error('Error comiendo:', err) }
  finally { isEating = false }
}

async function checkHealthAndHunger() {
  if (bot.food < 18 || bot.health < 14) await eatFood()
  // Check pickaxe durability during mining
  if (miningActive && isPickaxeWorn()) {
    await checkAndMaintainPickaxe()
  }
}

// ===================== DEPÓSITO =====================
const depositState = { active: false, lastRun: 0, lastInventoryHash: null, cooldown: 5000 }

async function depositInChest() {
  const chest = getClosestChest()
  if (!chest) { sendPrivateMessage('⚠️ No hay cofre registrado.'); return }
  if (depositState.active) { 
    let waited = 0
    while (depositState.active && waited < 100) { 
      await sleep(50)
      waited++
    }
    return 
  }

  const currentHash = getInventoryHash()
  if (currentHash !== '' && currentHash === depositState.lastInventoryHash) return

  const now = Date.now()
  if (now - depositState.lastRun < depositState.cooldown) {
    await sleep(depositState.cooldown - (now - depositState.lastRun))
  }

  depositState.active = true
  depositState.lastRun = Date.now()

  try {
    const success = await safeGoto(chest.x, chest.y, chest.z, 2)
    if (!success) {
      depositState.active = false
      return
    }
    
    const chestBlock = bot.blockAt(new Vec3(chest.x, chest.y, chest.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) { 
      sendPrivateMessage('No encuentro el cofre.')
      depositState.active = false
      return 
    }

    const armorNames = new Set(Object.values(ARMOR_PRIORITY).flat())
    const keepTypes = new Set()
    for (const item of bot.inventory.items()) {
      const isTool = item.name.includes('pickaxe') || item.name.includes('sword') || item.name.includes('axe')
      const isArmor = armorNames.has(item.name)
      const isFood = FOOD_PRIORITY.includes(item.name) && bot.food < 18
      if (isTool || isArmor || isFood) keepTypes.add(item.type)
    }

    const openedChest = await openChestSafe(chestBlock)
    let depositedCount = 0
    for (const item of bot.inventory.items()) {
      if (!keepTypes.has(item.type)) {
        await openedChest.deposit(item.type, null, item.count)
        depositedCount += item.count
      }
    }
    openedChest.close()
    if (depositedCount > 0) sendPrivateMessage(`✅ Depositados ${depositedCount} items`)
    depositState.lastInventoryHash = getInventoryHash()
  } catch (err) {
    const msg = err.message || String(err)
    if (!msg.includes('GoalChanged') && !msg.includes('timeout')) {
      console.error('depositInChest error:', msg)
    }
  } finally { 
    depositState.active = false 
  }
}

async function depositExcessIfNeeded() {
  if (hasFreeSlots()) return
  if (!getClosestChest()) { sendPrivateMessage('⚠️ Inventario lleno y sin cofre.'); return }
  await depositInChest()
}

// ===================== SEGUIMIENTO =====================
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

// ===================== DORMIR =====================
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
  } catch (err) { sendPrivateMessage(`❌ No puedo dormir: ${err.message}`) }
}

// ===================== ALDEA =====================
function isInVillageArea(pos, extraRadius = 0) {
  try {
    if (!villageLocation || !villageLocation.x) return false
    const dx = pos.x - villageLocation.x
    const dz = pos.z - villageLocation.z
    return Math.sqrt(dx * dx + dz * dz) <= (VILLAGE_RADIUS + extraRadius)
  } catch {
    return false
  }
}

async function findVillage() {
  const startX = Math.floor(bot.entity.position.x)
  const startY = Math.floor(bot.entity.position.y)
  const startZ = Math.floor(bot.entity.position.z)

  const beds = [], workBlocks = [], bells = [], villagers = []

  for (let x = startX - VILLAGE_RADIUS; x <= startX + VILLAGE_RADIUS; x++) {
    for (let z = startZ - VILLAGE_RADIUS; z <= startZ + VILLAGE_RADIUS; z++) {
      for (let y = Math.max(0, startY - 10); y <= Math.min(255, startY + 10); y++) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (!block) continue
        if (block.name === 'bed') beds.push({ x, y, z })
        else if (VILLAGE_BLOCKS.has(block.name)) {
          if (block.name === 'bell') bells.push({ x, y, z })
          else workBlocks.push({ x, y, z })
        }
      }
    }
  }

  Object.values(bot.entities).forEach(entity => {
    if (entity.type === 'mob' && (entity.name === 'villager' || entity.name === 'villager_v2')) {
      if (entity.position.distanceTo(bot.entity.position) <= VILLAGE_RADIUS) villagers.push(entity)
    }
  })

  const totalIndicators = beds.length + workBlocks.length + bells.length + villagers.length
  if (totalIndicators < 3) { sendPrivateMessage('❌ No encontré aldea.'); return false }

  const allPoints = [...beds, ...workBlocks, ...bells, ...villagers.map(v => v.position)]
  const centerX = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length
  const centerY = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length
  const centerZ = allPoints.reduce((sum, p) => sum + p.z, 0) / allPoints.length

  villageLocation = { x: Math.floor(centerX), y: Math.floor(centerY), z: Math.floor(centerZ) }

  let nearestBed = null, minDist = Infinity
  for (const bed of beds) {
    const dist = Math.sqrt((bed.x - centerX) ** 2 + (bed.z - centerZ) ** 2)
    if (dist < minDist) { minDist = dist; nearestBed = bed }
  }
  villageBedLocation = nearestBed

  saveState()
  sendPrivateMessage(`🏘️ Aldea encontrada en ${villageLocation.x} ${villageLocation.y} ${villageLocation.z}`)
  return true
}

// ===================== LEÑADOR - TALA DE ÁRBOLES (FUERA DE LA ALDEA) =====================
async function ensureAxe() {
  const equipped = bot.inventory.slots[36]
  if (equipped?.name.includes('axe')) return true
  const axe = bot.inventory.items().find(i => i.name.includes('axe'))
  if (axe) { await bot.equip(axe, 'hand'); return true }

  const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
  if (logs.length > 0) {
    await craftPlanks(logs[0].name)
    await sleep(300)
    await craftSticks()
    await sleep(300)
    const crafted = await craftTool('wooden_axe')
    if (crafted) {
      const newAxe = bot.inventory.items().find(i => i.name.includes('axe'))
      if (newAxe) { await bot.equip(newAxe, 'hand'); return true }
    }
  }
  sendPrivateMessage('❌ No tengo hacha')
  return false
}

async function craftTool(toolName) {
  if (!craftingTableLocation) { sendPrivateMessage('❌ Necesito mesa de crafteo'); return false }

  const materialKey = TOOL_MATERIAL_MAP[toolName]
  if (!materialKey) { sendPrivateMessage(`❌ Herramienta desconocida: ${toolName}`); return false }

  if (materialKey === '_planks') {
    const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
    for (const log of logs) {
      await craftPlanks(log.name)
      await sleep(300)
    }
  } else if (materialKey === 'cobblestone') {
    const cobble = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0)
    if (cobble < 3) await mineCobblestone(3 - cobble)
  }

  const stickCount = bot.inventory.items().filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0)
  if (stickCount < 2) await processWoodToSticks()

  await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
  const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
  if (!table?.name.includes('crafting_table')) { sendPrivateMessage('❌ No encuentro la mesa'); return false }

  const toolId = mcData.itemsByName[toolName]?.id
  if (!toolId) { sendPrivateMessage(`❌ Item desconocido: ${toolName}`); return false }

  const recipes = bot.recipesFor(toolId, null, 1, table)
  if (recipes.length === 0) { sendPrivateMessage(`❌ Sin receta para ${toolName}`); return false }

  try {
    await bot.craft(recipes[0], 1, table)
    sendPrivateMessage(`✅ Crafteado ${toolName}`)
    return true
  } catch (err) { console.error(`Error crafting ${toolName}:`, err.message); return false }
}

async function craftPlanks(logType) {
  if (!craftingTableLocation) return false
  const planksType = logType.replace('_log', '_planks')
  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    if (!table?.name.includes('crafting_table')) return false

    const logItem = bot.inventory.items().find(i => i.name === logType)
    if (logItem) await bot.equip(logItem, 'hand')
    await sleep(200)

    const recipes = bot.recipesFor(mcData.itemsByName[planksType]?.id, null, null, table)
    if (recipes.length > 0) {
      await bot.craft(recipes[0], null, table)
      return true
    }
  } catch (err) { console.error('Error crafting planks:', err.message) }
  return false
}

async function craftSticks() {
  try {
    const totalPlanks = bot.inventory.items().filter(i => i.name.includes('_planks')).reduce((s, i) => s + i.count, 0)
    if (totalPlanks < 2) return false

    const recipes = bot.recipesFor(mcData.itemsByName['stick'].id, null, 1, null)
    if (recipes.length === 0) return false

    const maxCrafts = Math.floor(totalPlanks / 2)
    await bot.craft(recipes[0], maxCrafts, null)
    return true
  } catch (err) { console.error('Error crafting sticks:', err.message); return false }
}

async function processWoodToSticks() {
  const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
  if (logs.length === 0) return

  for (const log of logs) {
    await craftPlanks(log.name)
    await sleep(500)
  }
  await sleep(1000)
  await craftSticks()
}

async function mineCobblestone(amount) {
  let mined = 0
  while (mined < amount) {
    const stone = bot.findBlock({ matching: b => b && (b.name === 'stone' || b.name === 'cobblestone'), maxDistance: 32 })
    if (!stone) break
    await safeGoto(stone.position.x, stone.position.y, stone.position.z, 1)
    await bot.dig(stone)
    mined++
    await sleep(100)
  }
}

function findCompleteTree(maxDistance = 120) {
  try {
    const log = bot.findBlock({
      matching: b => {
        if (!WOOD_BLOCKS.has(b?.name)) return false
        if (isInVillageArea(b.position)) return false
        return true
      },
      maxDistance
    })
    if (!log) return null

    const treeBlocks = []
    for (let y = -1; y <= TREE_HEIGHT_LIMIT; y++) {
      const block = bot.blockAt(log.position.offset(0, y, 0))
      if (block && WOOD_BLOCKS.has(block.name)) treeBlocks.push(block)
    }
    return treeBlocks.length ? { blocks: treeBlocks, basePos: treeBlocks[0].position } : null
  } catch (err) {
    console.error('findCompleteTree error:', err.message)
    return null
  }
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
        await sleep(500)
      }
    }
  }

  try {
    await breakLeavesAround(tree.basePos)
    await pickupNearbyItems()
    await plantSapling(tree.basePos)
  } catch (err) { console.error('Error procesando árbol:', err) }

  woodcuttingActive = false
  return true
}

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

async function pickupNearbyItems() {
  const items = Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 5)
  for (const item of items) {
    try {
      await safeSetGoal(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1), true)
      await sleep(200)
    } catch {}
  }
}

// ===================== EXPLORACIÓN LEÑADOR =====================
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

// ===================== MINERO =====================
function reportPickaxes() {
  const picks = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
    .map(n => ({ 
      n, 
      c: bot.inventory.items().filter(i => i.name === n).reduce((s, i) => s + i.count, 0) 
    }))
    .filter(p => p.c > 0)
  
  sendPrivateMessage(picks.length ? 
    `⛏️ Picos: ${picks.map(p => `${p.n}:${p.c}`).join(' | ')}` : 
    '⛏️ No tengo picos')
}

// Get current equipped pickaxe info
function getCurrentPickaxe() {
  const handItem = bot.inventory.slots[bot.inventory.selectedSlot]
  if (!handItem) return null
  
  const pickaxeNames = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
  if (!pickaxeNames.includes(handItem.name)) return null
  
  const maxDurability = mcData.itemsByName[handItem.name]?.durability || 1
  const currentDurability = handItem.durability || maxDurability
  const remaining = maxDurability - currentDurability
  
  return {
    name: handItem.name,
    maxDurability,
    currentDurability: remaining,
    percent: Math.round((remaining / maxDurability) * 100)
  }
}

// Check if pickaxe needs replacement (last pickaxe and low durability)
function isPickaxeWorn() {
  const pick = getCurrentPickaxe()
  if (!pick) return false
  
  // Count total pickaxes in inventory (including equipped)
  const pickaxeNames = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
  const totalPickaxes = bot.inventory.items().filter(i => pickaxeNames.includes(i.name)).reduce((s, i) => s + i.count, 0)
  
  // Only trigger if it's the last pickaxe AND durability is low
  return totalPickaxes <= 1 && pick.percent <= 50
}

// Craft 10 pickaxes of the best available type
async function craftPickaxes(count = 10) {
  if (!craftingTableLocation) {
    sendPrivateMessage('❌ Necesito mesa de crafteo')
    return false
  }
  
  // Find best available pickaxe type based on materials
  const pickaxeTypes = [
    { name: 'diamond_pickaxe', material: 'diamond', count: 3 },
    { name: 'iron_pickaxe', material: 'iron_ingot', count: 3 },
    { name: 'stone_pickaxe', material: 'cobblestone', count: 3 },
    { name: 'wooden_pickaxe', material: null, count: 0 }  // fallback
  ]
  
  let selectedType = null
  for (const type of pickaxeTypes) {
    if (type.material) {
      const materialCount = bot.inventory.items().filter(i => i.name === type.material).reduce((s, i) => s + i.count, 0)
      if (materialCount >= type.count * count) {
        selectedType = type
        break
      }
    } else {
      // Wooden - check for logs
      const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
      if (logs.length > 0) {
        selectedType = type
        break
      }
    }
  }
  
  if (!selectedType) {
    sendPrivateMessage('❌ No tengo materiales para craftear picos')
    return false
  }
  
  // Ensure we have sticks
  const stickCount = bot.inventory.items().filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0)
  if (stickCount < 2 * count) {
    sendPrivateMessage('🔨 Necesito palos, proceso madera...')
    await processWoodToSticks()
  }
  
  // Ensure we have the main material
  if (selectedType.material === 'cobblestone') {
    const cobble = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0)
    if (cobble < 3 * count) {
      sendPrivateMessage('⛏️ Necesito cobblestone, minando...')
      await mineCobblestone((3 * count) - cobble)
    }
  } else if (selectedType.material === 'diamond') {
    const diamonds = bot.inventory.items().filter(i => i.name === 'diamond').reduce((s, i) => s + i.count, 0)
    if (diamonds < 3 * count) {
      sendPrivateMessage('💎 Necesito diamantes')
      return false
    }
  } else if (selectedType.material === 'iron_ingot') {
    const iron = bot.inventory.items().filter(i => i.name === 'iron_ingot').reduce((s, i) => s + i.count, 0)
    if (iron < 3 * count) {
      sendPrivateMessage('🔶 Necesito hierro')
      return false
    }
  } else if (selectedType.material === null) {
    // Wooden - need logs
    const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
    if (logs.length === 0) {
      sendPrivateMessage('🪵 Necesito madera')
      return false
    }
    await craftPlanks(logs[0].name)
    await sleep(300)
    await craftSticks()
  }
  
  await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
  const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
  if (!table?.name.includes('crafting_table')) {
    sendPrivateMessage('❌ No encuentro la mesa')
    return false
  }
  
  const pickaxeId = mcData.itemsByName[selectedType.name]?.id
  if (!pickaxeId) return false
  
  const recipes = bot.recipesFor(pickaxeId, null, 1, table)
  if (recipes.length === 0) {
    sendPrivateMessage(`❌ Sin receta para ${selectedType.name}`)
    return false
  }
  
  try {
    await bot.craft(recipes[0], count, table)
    sendPrivateMessage(`✅ Crafteado ${count}x ${selectedType.name}`)
    return true
  } catch (err) {
    console.error('Error crafting pickaxes:', err.message)
    return false
  }
}

// Main function: check pickaxe and maintain inventory
async function checkAndMaintainPickaxe() {
  if (!isPickaxeWorn()) return false
  
  const pick = getCurrentPickaxe()
  sendPrivateMessage(`⚠️ Pico ${pick.name} al ${pick.percent}% de durabilidad`)
  
  // Deposit everything first
  sendPrivateMessage('📦 Depositando items...')
  await depositExcessIfNeeded()
  
  // Craft 10 new pickaxes
  sendPrivateMessage('🔨 Crafteando 10 picos...')
  const crafted = await craftPickaxes(10)
  
  if (crafted) {
    // Equip the new pickaxe
    await sleep(500)
    const newPick = bot.inventory.items().find(i => i.name === getCurrentPickaxe()?.name || i.name.includes('pickaxe'))
    if (newPick) {
      await bot.equip(newPick, 'hand')
      sendPrivateMessage('✅ Nuevo pico equipado')
    }
  }
  
  return true
}

// ===================== CONFIRMACIÓN INTERACTIVA =====================
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

// Handle confirmation responses
function handleConfirmationResponse(response) {
  if (!pendingConfirmation) return false
  
  const isYes = response.toLowerCase() === 'si' || response.toLowerCase() === 'sí' || response.toLowerCase() === 'yes'
  pendingConfirmation.resolve(isYes)
  pendingConfirmation = null
  return true
}

// ===================== OBTENER ITEMS DEL COFRE =====================
async function getItemFromChest(itemName, count) {
  const chest = getClosestChest()
  if (!chest) return false
  
  try {
    await safeGoto(chest.x, chest.y, chest.z, 2)
    await sleep(500)
    const chestBlock = bot.blockAt(new Vec3(chest.x, chest.y, chest.z))
    const openedChest = await openChestSafe(chestBlock)
    const item = openedChest.containerItems().find(i => i.name === itemName)
    
    if (!item) {
      openedChest.close()
      return false
    }
    
    await openedChest.withdraw(item.type, null, Math.min(item.count, count))
    openedChest.close()
    return true
  } catch (err) {
    console.error('Error getting item from chest:', err.message)
    return false
  }
}

// Get ALL items with that name from chest
async function getAllItemsFromChest(itemName) {
  const chest = getClosestChest()
  if (!chest) return false
  
  try {
    await safeGoto(chest.x, chest.y, chest.z, 2)
    await sleep(500)
    const chestBlock = bot.blockAt(new Vec3(chest.x, chest.y, chest.z))
    const openedChest = await openChestSafe(chestBlock)
    
    let items = openedChest.containerItems().filter(i => i.name === itemName)
    if (items.length === 0) {
      openedChest.close()
      return false
    }
    
    // Withdraw all items
    for (const item of items) {
      await openedChest.withdraw(item.type, null, item.count)
    }
    
    openedChest.close()
    return true
  } catch (err) {
    console.error('Error getting all items:', err.message)
    return false
  }
}

// ===================== MOVIMIENTO DIRECTO =====================
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

async function ensurePickaxe(blockName) {
  const requiredPickaxe = PICKAXE_REQUIRED[blockName] || 'stone_pickaxe'
  const requiredTier = PICKAXE_TIER[requiredPickaxe]

  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('pickaxe') && (PICKAXE_TIER[equipped.name] || 0) >= requiredTier) return true

  const available = bot.inventory.items().filter(i => i.name.includes('pickaxe')).sort((a,b) => (PICKAXE_TIER[b.name]||0) - (PICKAXE_TIER[a.name]||0))
  const suitable = available.find(i => (PICKAXE_TIER[i.name] || 0) >= requiredTier)
  if (suitable) { await bot.equip(suitable, 'hand'); return true }

  const craftAttempts = ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']
  for (const pickaxe of craftAttempts) {
    if (PICKAXE_TIER[pickaxe] >= requiredTier && await tryCraftPickaxe(pickaxe)) {
      await bot.equip(pickaxe, 'hand')
      return true
    }
  }
  return false
}

async function tryCraftPickaxe(pickaxeName) {
  const recipe = PICKAXE_CRAFT[pickaxeName]
  if (!recipe) return false

  for (const [material, amount] of Object.entries(recipe)) {
    if (material === 'sticks' || material === 'planksType') continue
    const current = bot.inventory.items().filter(i => i.name === material).reduce((s,i) => s+i.count, 0)
    if (current < amount) {
      if (material === 'cobblestone') await mineCobblestone(amount - current)
      else if (material === 'iron_ingot') { sendPrivateMessage(`⚠️ Necesito ${amount - current} iron_ingot`); return false }
      else if (material === 'diamond') { sendPrivateMessage('⚠️ Necesito diamantes.'); return false }
      else return false
    }
  }

  const sticks = bot.inventory.items().filter(i => i.name === 'stick').reduce((s,i) => s+i.count, 0)
  if (sticks < recipe.sticks) {
    const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
    if (logs.length > 0) {
      await craftPlanks(logs[0].name)
      await craftSticks()
    }
  }

  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    const recipes = bot.recipesFor(mcData.itemsByName[pickaxeName].id, null, 1, table)
    if (!recipes.length) return false
    await bot.craft(recipes[0], 1, table)
    return true
  } catch { return false }
}

async function ensureTorches() {
  let torches = bot.inventory.items().filter(i => i.name === 'torch').reduce((s,i) => s+i.count, 0)
  if (torches >= 64) return true

  if (craftingTableLocation) {
    let coal = bot.inventory.items().filter(i => i.name === 'coal' || i.name === 'charcoal').reduce((s,i) => s+i.count, 0)
    let sticks = bot.inventory.items().filter(i => i.name === 'stick').reduce((s,i) => s+i.count, 0)
    const needed = 64 - torches
    const coalNeeded = Math.ceil(needed / 4)
    const sticksNeeded = Math.ceil(needed / 4)

    if (coal < coalNeeded) { sendPrivateMessage(`⚠️ Necesito ${coalNeeded - coal} carbón`); return false }
    if (sticks < sticksNeeded) await processWoodToSticks()

    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    const recipes = bot.recipesFor(mcData.itemsByName['torch'].id, null, needed, table)
    if (recipes.length) {
      await bot.craft(recipes[0], Math.min(needed, 64), table)
      return true
    }
  }
  return false
}

async function placeTorchIfNeeded() {
  if (!miningActive) return
  const pos = bot.entity.position
  const block = bot.blockAt(pos)
  if (block && block.light < TORCH_CONFIG.lightLevel) {
    let torches = bot.inventory.items().find(i => i.name === 'torch')
    if (!torches) await ensureTorches()
    torches = bot.inventory.items().find(i => i.name === 'torch')
    if (!torches) return
    const placeAt = pos.offset(0, 1, 0)
    if (bot.blockAt(placeAt)?.name === 'air') {
      const dirs = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]
      for (const [dx,dy,dz] of dirs) {
        const support = bot.blockAt(placeAt.offset(dx, dy, dz))
        if (support && support.diggable === false && support.name !== 'air') {
          await bot.equip(torches, 'hand')
          await bot.placeBlock(support, new Vec3(-dx, -dy, -dz))
          break
        }
      }
    }
  }
}

async function safeDig(block) {
  if (!block || block.type === 0) return false
  const fresh = bot.blockAt(block.position)
  if (!fresh || fresh.type === 0 || fresh.name === 'air') return false
  if (PROTECTED_BLOCKS.has(fresh.name)) return false
  try { await bot.dig(fresh, true); return true }
  catch (err) { if (err.message?.includes('air') || err.message?.includes('already')) return false; throw err }
}

function getSurfaceY(x, z) {
  for (let y = 320; y >= -64; y--) {
    const block = bot.blockAt(new Vec3(x, y, z))
    if (block && block.name !== 'air' && block.type !== 0 && block.diggable !== true) return y + 1
  }
  return 64
}

async function chunkMiningLoop() {
  const optimalY = OPTIMAL_Y[miningTarget] ?? -58
  if (!await ensurePickaxe(miningTarget)) {
    miningActive = false
    clearMiningProgress()
    return
  }

  const chunkX = Math.floor(mineLocation.x / 16)
  const chunkZ = Math.floor(mineLocation.z / 16)
  const startX = chunkX * 16 + 8
  const startZ = chunkZ * 16 + 8
  const startY = mineLocation.y

  currentChunkMining = { startY: optimalY, currentY: optimalY, chunkX, chunkZ, startX, startZ }
  saveMiningProgress()
  await ensureTorches()

  await safeGoto(startX, startY, startZ, 8)
  if (!miningActive) return

  sendPrivateMessage(`📉 Bajando hasta Y=${optimalY}...`)
  await digStaircaseDownToTarget(startX, startZ, optimalY)
  if (!miningActive) return

  sendPrivateMessage(`⛏️ Minando chunk en Y=${optimalY} y Y=${optimalY + 1}...`)
  await mineCurrentChunkHorizontally()

  if (!miningActive) {
    sendPrivateMessage('🛑 Minería detenida (bloque protegido)')
    clearMiningProgress()
    return
  }

  sendPrivateMessage('⬆️ Subiendo a la superficie...')
  await climbUpToSurface(startX, startZ, startY)
  if (!miningActive) return

  await moveToNextChunkForward()

  if (miningActive) setTimeout(() => chunkMiningLoop(), 500)
}

async function digStaircaseDownToTarget(startX, startZ, targetY) {
  let x = startX, z = startZ
  while (miningActive && Math.floor(bot.entity.position.y) > targetY) {
    const currentY = Math.floor(bot.entity.position.y)

    const downBlock = bot.blockAt(new Vec3(x, currentY - 1, z))
    if (downBlock?.diggable && !downBlock.name.includes('lava')) {
      await safeGoto(x, currentY, z, 1)
      await safeDig(downBlock)
    }
    await safeGoto(x, currentY - 1, z, 1)

    const frontBlock = bot.blockAt(new Vec3(x + 1, currentY - 1, z))
    if (frontBlock?.diggable && !frontBlock.name.includes('lava')) await safeDig(frontBlock)

    await placeTorchIfNeeded()
    if (bot.inventory.emptySlotCount() < 9) await depositInChest()
  }
  saveMiningProgress()
}

async function climbUpToSurface(startX, startZ, surfaceY) {
  let x = startX, z = startZ
  let currentY = Math.floor(bot.entity.position.y)
  while (miningActive && currentY < surfaceY) {
    const upBlock = bot.blockAt(new Vec3(x, currentY + 1, z))
    if (upBlock && upBlock.name !== 'air') {
      await safeDig(upBlock)
    }
    await safeGoto(x, currentY + 1, z, 1)
    currentY = Math.floor(bot.entity.position.y)
  }
  sendPrivateMessage(`✅ Superficie alcanzada en Y=${currentY}`)
}

async function mineCurrentChunkHorizontally() {
  const chunkSize = 16
  const startX = currentChunkMining.chunkX * chunkSize
  const startZ = currentChunkMining.chunkZ * chunkSize
  const fixedY = currentChunkMining.startY

  sendPrivateMessage(`🪨 Minando chunk [${currentChunkMining.chunkX}, ${currentChunkMining.chunkZ}] en Y=${fixedY}`)
  await mineChunkLayer(startX, startZ, fixedY, chunkSize)

  if (miningActive) sendPrivateMessage('✅ Chunk minado completamente')
}

async function mineChunkLayer(startX, startZ, layerY, chunkSize) {
  const mineable = new Set(['stone', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite',
    'gravel', 'dirt', 'sand', 'sandstone', 'coal_ore', 'deepslate_coal_ore',
    'iron_ore', 'deepslate_iron_ore', 'gold_ore', 'deepslate_gold_ore',
    'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
    'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'copper_ore', 'deepslate_copper_ore'])

  for (let offsetZ = 0; offsetZ < chunkSize && miningActive; offsetZ++) {
    const z = startZ + offsetZ
    const xStart = startX
    const xEnd = startX + chunkSize - 1
    const xStep = offsetZ % 2 === 0 ? 1 : -1

    for (let x = xStart; (xStep > 0 ? x <= xEnd : x >= xEnd); x += xStep) {
      if (!miningActive) return

      for (let y = layerY; y <= layerY + 1; y++) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (!block || block.name === 'air') continue

        if (PROTECTED_BLOCKS.has(block.name)) {
          sendPrivateMessage(`🛑 Bloque protegido: ${block.name}`)
          miningActive = false
          clearMiningProgress()
          return
        }

        const shouldMine = block.name === miningTarget || mineable.has(block.name) || block.diggable
        if (shouldMine && !hasLavaNearby(block.position)) {
          await safeGoto(block.position.x, block.position.y, block.position.z, 1)
          await safeDig(block)
          await placeTorchIfNeeded()
        }
      }
    }
  }
}

async function moveToNextChunkForward() {
  const newChunkX = currentChunkMining.chunkX + 1
  const newChunkZ = currentChunkMining.chunkZ

  sendPrivateMessage(`🚶 Avanzando al chunk [${newChunkX}, ${newChunkZ}]`)

  const newMineX = newChunkX * 16 + 8
  const newMineZ = newChunkZ * 16 + 8
  const surfaceY = getSurfaceY(newMineX, newMineZ)

  await safeGoto(newMineX, surfaceY, newMineZ, 8)

  mineLocation = { x: newMineX, y: surfaceY, z: newMineZ }
  saveState()

  currentChunkMining = {
    startY: OPTIMAL_Y[miningTarget] ?? -58,
    currentY: OPTIMAL_Y[miningTarget] ?? -58,
    chunkX: newChunkX,
    chunkZ: newChunkZ,
    startX: newMineX,
    startZ: newMineZ
  }
  saveMiningProgress()
}

// ===================== MINERÍA SERPENTINA (Desde bot_minero) =====================
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
        await ensurePickaxe(block.name)
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
      await ensurePickaxe(blockAbove.name)
      await safeDig(blockAbove)
    }
    
    await safeGoto(upPos.x, upPos.y, upPos.z, 1)
    currentY++
    await sleep(100)
  }
  sendPrivateMessage(`✅ Superficie alcanzada en Y=${currentY}`)
}

// ===================== MINERÍA DESCENDENTE POR SEGMENTOS =====================
async function mineChunkDescending(askEachSegment = true) {
  const chunkX = Math.floor(bot.entity.position.x / 16)
  const chunkZ = Math.floor(bot.entity.position.z / 16)
  const centerX = chunkX * 16 + 8
  const centerZ = chunkZ * 16 + 8
  const surfaceY = getSurfaceY(centerX, centerZ)
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
  const surfaceY = getSurfaceY(centerX, centerZ)
  await safeGoto(centerX, surfaceY, centerZ, 5)
}

// ===================== COMERCIANTE =====================
function getNearestVillager(maxDistance = 64, profession = null) {
  let nearest = null, minDist = maxDistance

  Object.values(bot.entities).forEach(entity => {
    if (entity.name === 'villager' || entity.name === 'villager_v2') {
      if (profession && entity.metadata && entity.metadata[18]) {
        if (entity.metadata[18].profession !== profession) return
      }
      if (entity.metadata && entity.metadata[18]) {
        const prof = entity.metadata[18].profession
        if (prof === 'none' || prof === 'nitwit') return
      }
      const dist = entity.position.distanceTo(bot.entity.position)
      if (dist < minDist) { minDist = dist; nearest = entity }
    }
  })
  return nearest
}

async function fetchVillagerTrades(villagerEntity, maxAttempts = 1) {
  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      // Try to open villager with timeout handling
      const villagerWindow = await bot.openVillager(villagerEntity)
      await sleep(300)
      
      const trades = villagerWindow.trades
      if (trades && trades.length > 0) {
        return { trades, window: villagerWindow }
      }
      
      villagerWindow.close()
      attempts++
      await sleep(500)
    } catch (err) {
      // Handle all errors gracefully
      attempts++
      if (attempts < maxAttempts) {
        await sleep(2000)
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
    sendPrivateMessage('❌ No hay aldeanos con oficio.')
    return 
  }

  sendPrivateMessage(`🔍 Escaneando ${villagers.length} aldeanos...`)
  let registered = 0
  let failed = 0

  for (let i = 0; i < villagers.length; i++) {
    const villager = villagers[i]
    
    if (!villager.isValid) {
      failed++
      continue
    }
    
    const profession = villager.metadata[18]?.profession || 'unknown'
    const professionName = {
      'farmer': 'granjero', 'librarian': 'bibliotecario', 'cleric': 'clérigo',
      'armorer': 'armero', 'weaponsmith': 'herrero de armas', 'toolsmith': 'herrero de herramientas',
      'butcher': 'carnicero', 'leatherworker': 'peletero', 'mason': 'albañil',
      'fletcher': 'flechero', 'shepherd': 'pastor', 'fisherman': 'pescador',
      'cartographer': 'cartógrafo'
    }[profession] || profession

    sendPrivateMessage(`🔎 Aldeano ${i + 1}/${villagers.length}: ${professionName}`)

    try {
      const success = await safeGoto(villager.position.x, villager.position.y, villager.position.z, 3)
      if (!success) {
        sendPrivateMessage(`  ⚠️ No pude llegar`)
        failed++
        continue
      }
      
      await sleep(500)
      
      if (!villager.isValid) {
        sendPrivateMessage(`  ⚠️ Aldeano desapareció`)
        failed++
        continue
      }
      
      // Ultra-defensive villager opening
      let villagerWindow = null
      try {
        villagerWindow = await bot.openVillager(villager)
        await sleep(300)
      } catch (openErr) {
        sendPrivateMessage(`  ⚠️ No responde (${openErr.message.substring(0, 30)}...)`)
        failed++
        continue
      }
      
      const trades = villagerWindow?.trades
      
      if (trades && trades.length > 0) {
        villagerTrades[villager.id] = trades
        registered++
        
        // Librarian enchantment detection
        if (profession === 'librarian') {
          const enchantedBooks = trades.filter(t => t.outputItem?.name === 'enchanted_book')
          
          if (enchantedBooks.length > 0) {
            sendPrivateMessage(`  📚 Encantamientos:`)
            for (const trade of enchantedBooks) {
              try {
                const book = trade.outputItem
                if (book.nbt?.value?.StoredEnchantments?.value?.value) {
                  const enchants = book.nbt.value.StoredEnchantments.value.value
                  for (const ench of enchants) {
                    const enchId = ench.id.value.replace('minecraft:', '')
                    const enchLvl = ench.lvl.value
                    sendPrivateMessage(`    • ${enchId} ${enchLvl}`)
                  }
                } else {
                  sendPrivateMessage(`    • (libro sin datos)`)
                }
              } catch {
                sendPrivateMessage(`    • (error leyendo libro)`)
              }
            }
          }
        }
        
        sendPrivateMessage(`  ✅ ${trades.length} ofertas`)
      } else {
        sendPrivateMessage(`  ⚠️ Sin ofertas`)
        failed++
      }
      
      if (villagerWindow) {
        try {
          villagerWindow.close()
        } catch {}
      }
      
    } catch (err) { 
      const errMsg = err.message || String(err)
      sendPrivateMessage(`  ❌ Error: ${errMsg.substring(0, 40)}`)
      failed++
    }
    
    if (i < villagers.length - 1) await sleep(2000)
  }

  saveState()
  sendPrivateMessage(`📊 Resultado: ${registered} OK, ${failed} fallidos, ${villagers.length} total`)
}

async function findFletchers() {
  return Object.values(bot.entities).filter(e => {
    if (e.name !== 'villager' && e.name !== 'villager_v2') return false
    if (!e.metadata || !e.metadata[18]) return false
    return e.metadata[18].profession === 'fletcher'
  })
}

async function tradeWithFletcher(fletcher) {
  if (!villagerTrades[fletcher.id]) return false

  const trades = villagerTrades[fletcher.id]
  let tradesCompleted = 0

  try {
    await safeGoto(fletcher.position.x, fletcher.position.y, fletcher.position.z, 3)
    await sleep(500)

    const { trades: currentTrades, window } = await fetchVillagerTrades(fletcher)
    if (!currentTrades || !window) return false

    for (const trade of currentTrades) {
      if (trade.inputItem1?.name === 'stick' || trade.inputItem2?.name === 'stick') {
        const sticksNeeded = (trade.inputItem1?.name === 'stick' ? trade.inputItem1.count : 0) +
                           (trade.inputItem2?.name === 'stick' ? trade.inputItem2.count : 0)
        const sticksAvailable = bot.inventory.items().filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0)

        if (sticksAvailable >= sticksNeeded && trade.uses < trade.maxUses) {
          try {
            await bot.trade(window, currentTrades.indexOf(trade), 1)
            tradesCompleted++
            await sleep(500)
          } catch (err) { console.error('Error en trade:', err) }
        }
      }
    }

    window.close()
    return tradesCompleted > 0
  } catch (err) { console.error('Error tradando:', err); return false }
}

async function craftFletchingTable() {
  if (!craftingTableLocation) { sendPrivateMessage('❌ Necesito mesa de crafteo'); return false }

  const planks = bot.inventory.items().filter(i => i.name.includes('_planks'))
  if (planks.length === 0) {
    const logs = bot.inventory.items().filter(i => i.name.includes('_log'))
    if (logs.length === 0) {
      sendPrivateMessage('⚠️ Necesito madera para fletching table')
      return false
    }
    for (const log of logs) {
      await craftPlanks(log.name)
      await sleep(300)
    }
  }

  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    if (!table?.name.includes('crafting_table')) return false

    const recipes = bot.recipesFor(mcData.itemsByName['fletching_table'].id, null, 1, table)
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, table)
      sendPrivateMessage('✅ Crafteada fletching table')
      return true
    }
  } catch (err) { console.error('Error crafting fletching table:', err.message) }
  return false
}

async function optimizeVillage() {
  sendPrivateMessage('🎯 Iniciando optimización de aldea...')

  try {
    sendPrivateMessage('📋 Escaneando aldeanos...')
    await investigateAllVillagers()
    await sleep(2000)

  sendPrivateMessage('🏹 Buscando nitwits para convertir...')
  const nitwits = Object.values(bot.entities).filter(e => {
    if (e.name !== 'villager' && e.name !== 'villager_v2') return false
    if (!e.metadata || !e.metadata[18]) return false
    return e.metadata[18].profession === 'nitwit'
  })

  if (nitwits.length > 0) {
    const fletchingTablesNeeded = nitwits.length
    for (let i = 0; i < fletchingTablesNeeded; i++) {
      await craftFletchingTable()
      await sleep(500)
    }
    sendPrivateMessage(`✅ Crafteadas ${fletchingTablesNeeded} fletching tables`)
  }

  tradingActive = true
  sendPrivateMessage('🏹 Maximizando trades de flecheros...')

  let optimizationCycles = 0
  while (tradingActive && optimizationCycles < 100) {
    optimizationCycles++
    await checkHealthAndHunger()

    const sticksCount = bot.inventory.items().filter(i => i.name === 'stick').reduce((sum, i) => sum + i.count, 0)

    if (sticksCount < 128) {
      const tree = findCompleteTree(30)
      if (tree) {
        await cutTree(tree)
        await processWoodToSticks()
      }
    }

    const fletchers = await findFletchers()
    if (fletchers.length === 0) {
      await sleep(10000)
      continue
    }

    for (const fletcher of fletchers) {
      try {
        await tradeWithFletcher(fletcher)
        await sleep(1500)
      } catch (err) { console.error('Error en trade:', err.message) }
    }

    await sleep(5000)
  }

  sendPrivateMessage('🔧 Mejorando otros oficios...')
  sendPrivateMessage('🎯 Optimización completada')
  } catch (err) {
    sendPrivateMessage(`❌ Error en optimización: ${err.message}`)
    console.error('Error en optimizeVillage:', err)
  } finally {
    tradingActive = false
  }
}

// ===================== COMBATE =====================
function getNearestHostile(maxDistance) {
  return Object.values(bot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < maxDistance)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
}

// Get mobs attacking villagers (priority target)
function getMobsAttackingVillagers(maxDistance) {
  const villagers = Object.values(bot.entities).filter(e => 
    e.type === 'mob' && (e.name === 'villager' || e.name === 'villager_v2')
  )
  
  if (villagers.length === 0) return []
  
  return Object.values(bot.entities)
    .filter(e => {
      if (e.type !== 'mob' || !HOSTILE_MOBS.includes(e.name)) return false
      if (e.position.distanceTo(bot.entity.position) > maxDistance) return false
      
      // Check if this mob is near any villager
      for (const villager of villagers) {
        if (e.position.distanceTo(villager.position) < 8) return true
      }
      return false
    })
    .sort((a, b) => {
      // Prioritize mobs closer to villagers
      const aDistToVillager = Math.min(...villagers.map(v => a.position.distanceTo(v.position)))
      const bDistToVillager = Math.min(...villagers.map(v => b.position.distanceTo(v.position)))
      return aDistToVillager - bDistToVillager
    })
}

// Get nearest hostile targeting a specific position (village center)
function getHostileNearVillage(villageCenter, radius = 32) {
  return Object.values(bot.entities)
    .filter(e => {
      if (e.type !== 'mob' || !HOSTILE_MOBS.includes(e.name)) return false
      const distToBot = e.position.distanceTo(bot.entity.position)
      const distToVillage = villageCenter ? e.position.distanceTo(new Vec3(villageCenter.x, villageCenter.y, villageCenter.z)) : Infinity
      return distToBot < 32 && distToVillage < radius
    })
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
}

function evaluateThreat(mob) {
  const special = SPECIAL_MOBS[mob.name]
  const distance = mob.position.distanceTo(bot.entity.position)
  let threat = (special ? 30 : 0) + (special?.strategy === 'hit_and_run' ? 20 : 0)
  threat += distance < 2 ? 40 : distance < 4 ? 20 : distance < 6 ? 10 : 0
  threat += bot.health < HUNT_CONFIG.retreatHealth ? 50 : bot.health < HUNT_CONFIG.safeHealth ? 25 : 0
  return { level: threat, shouldEngage: threat < 60 && bot.health > HUNT_CONFIG.retreatHealth, strategy: special?.strategy || 'normal' }
}

function hasShield() { const off = bot.inventory.slots[45]; return off && off.name === 'shield' }

async function equipShield() {
  if (hasShield()) return true
  const shield = bot.inventory.items().find(i => i.name === 'shield')
  if (shield) { await bot.equip(shield, 'off-hand'); return true }
  return false
}

async function useShield(duration = HUNT_CONFIG.blockDuration) {
  if (!hasShield() || Date.now() - lastShieldUse < 100) return false
  lastShieldUse = Date.now()
  try { bot.activateItem(); setTimeout(() => { if (currentCombatState === CombatState.BLOCKING) bot.deactivateItem() }, duration * 50); return true }
  catch { return false }
}

function stopShield() { if (hasShield()) bot.deactivateItem() }

async function equipBestWeapon() {
  const equipped = bot.inventory.slots[36]
  if (equipped && WEAPON_PRIORITY.includes(equipped.name)) return equipped.name
  for (const name of WEAPON_PRIORITY) {
    const weapon = bot.inventory.items().find(i => i.name === name)
    if (weapon) { await bot.equip(weapon, 'hand'); return name }
  }
  const cobblestone = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((s,i) => s+i.count, 0)
  if (cobblestone < 2) await mineCobblestone(2 - cobblestone)
  const sticks = bot.inventory.items().filter(i => i.name === 'stick').reduce((s,i) => s+i.count, 0)
  if (sticks < 1) await processWoodToSticks()
  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    const recipes = bot.recipesFor(mcData.itemsByName['stone_sword'].id, null, 1, table)
    if (recipes.length) {
      await bot.craft(recipes[0], 1, table)
      const sword = bot.inventory.items().find(i => i.name === 'stone_sword')
      if (sword) { await bot.equip(sword, 'hand'); return 'stone_sword' }
    }
  } catch (err) { console.error('Error crafting sword:', err) }
  return null
}

async function attackMob(mob) {
  if (!mob?.isValid) return false
  try { bot.lookAt(mob.position.offset(0, 1, 0)); await bot.attack(mob); return true }
  catch { return false }
}

async function fightMob(mob) {
  if (!mob?.isValid) return false
  const threat = evaluateThreat(mob)
  if (!await equipBestWeapon()) { sendPrivateMessage('No tengo arma'); return false }
  
  currentTarget = mob
  currentCombatState = CombatState.APPROACHING

  await ensureAxe()
  const axe = bot.inventory.items().find(i => i.name.includes('axe'))
  if (axe) await bot.equip(axe, 'hand')

  await equipShield()

  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (bot.health < HUNT_CONFIG.retreatHealth) {
      currentCombatState = CombatState.RETREATING
      break
    }
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange) {
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange))
    } else {
      if (hasShield() && Math.random() < HUNT_CONFIG.blockChance) await useShield(10)
      await attackMob(mob)
    }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }

  currentCombatState = CombatState.IDLE
  currentTarget = null
  stopShield()
  return !mob.isValid
}

// PATRULLA - Evalúa mobs hostiles en aldea o mina y los combate
// Protege aldeanos atacados y patrulla el área de la aldea
async function patrol() {
  patrolActive = true
  sendPrivateMessage('🛡️ Modo patrulla activado - Protegiendo aldea')
  
  let patrolCenter = villageLocation ? { x: villageLocation.x, y: villageLocation.y, z: villageLocation.z } : null
  let patrolRadius = 20
  let patrolAngle = 0

  while (patrolActive) {
    await checkHealthAndHunger()

    // Priority 1: Mobs attacking villagers
    const attackingMobs = getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius)
    
    if (attackingMobs.length > 0) {
      const mob = attackingMobs[0]
      sendPrivateMessage(`⚔️ ALERTA: ${mob.name} ataca aldeano!`)
      await fightMob(mob)
      await pickupNearbyItems()
      continue
    }
    
    // Priority 2: Any hostile near village
    if (patrolCenter) {
      const mob = getHostileNearVillage(patrolCenter, patrolRadius)
      if (mob) {
        const threat = evaluateThreat(mob)
        sendPrivateMessage(`⚠️ ${mob.name} cerca de la aldea`)
        
        if (threat.shouldEngage) {
          await fightMob(mob)
          await pickupNearbyItems()
        }
        continue
      }
    }
    
    // Priority 3: Regular patrol around village
    if (patrolCenter) {
      patrolAngle += 0.1
      const targetX = patrolCenter.x + Math.cos(patrolAngle) * patrolRadius
      const targetZ = patrolCenter.z + Math.sin(patrolAngle) * patrolRadius
      
      const currentPos = bot.entity.position
      const distToTarget = Math.sqrt((targetX - currentPos.x) ** 2 + (targetZ - currentPos.z) ** 2)
      
      if (distToTarget > 5) {
        try {
          await safeSetGoal(new goals.GoalNear(targetX, currentPos.y, targetZ, 3))
        } catch {}
      }
    } else {
      // No village - just patrol around current position
      const pos = bot.entity.position
      const angle = (Date.now() / 1000) % (Math.PI * 2)
      try {
        await safeSetGoal(new goals.GoalNear(pos.x + Math.cos(angle) * 10, pos.y, pos.z + Math.sin(angle) * 10, 5))
      } catch {}
    }

    await bot.waitForTicks(10)
  }
}

function stopPatrol() {
  patrolActive = false
  sendPrivateMessage('🛡️ Patrulla detenida')
}

// CUIDAME - Seguir al player y combatir juntos
// Prioriza proteger aldeanos mientras sigue al player
async function startCuidame() {
  cuidameMode = true
  following = true
  sendPrivateMessage('🛡️ Modo CUIDAME activado - Te sigo y protejo')

  startFollowing(MASTER)

  while (cuidameMode && following) {
    await checkHealthAndHunger()

    // Priority 1: Mobs attacking villagers
    const attackingMobs = getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius)
    
    if (attackingMobs.length > 0) {
      const mob = attackingMobs[0]
      sendPrivateMessage(`🛡️ ALERTA: ${mob.name} ataca aldeano!`)
      await fightMob(mob)
      await pickupNearbyItems()
      continue
    }
    
    // Priority 2: Any hostile nearby
    const mob = getNearestHostile(HUNT_CONFIG.awarenessRadius)
    
    if (mob) {
      const threat = evaluateThreat(mob)
      sendPrivateMessage(`🛡️ Protegiendo: ${mob.name}`)
      
      if (threat.shouldEngage) {
        await fightMob(mob)
        await pickupNearbyItems()
      }
    }

    await bot.waitForTicks(5)
  }
}

function stopCuidame() {
  cuidameMode = false
  stopFollowing()
  sendPrivateMessage('🛡️ Modo CUIDAME desactivado')
}

// Sistema de evasión automática
function startDodgeSystem() {
  if (dodgeInterval) clearInterval(dodgeInterval)
  dodgeInterval = setInterval(async () => {
    if (isDodging || !DODGE_CONFIG.enabled) return
    const mob = getNearestHostile(DODGE_CONFIG.detectionRadius)
    if (!mob) return

    const wasExploring = explorationActive
    const wasWoodcutting = woodcuttingActive
    const wasMining = miningActive
    const wasFollowing = following

    if (wasExploring) explorationActive = false
    if (wasWoodcutting) woodcuttingActive = false
    if (wasMining) miningActive = false
    if (wasFollowing) { following = false; if (followInterval) clearInterval(followInterval) }

    bot.pathfinder.setGoal(null)
    isDodging = true

    try { await dodgeMob(mob) }
    catch (err) { console.error('Error en dodge:', err) }
    finally {
      isDodging = false
      if (wasExploring) explorationActive = true
      if (wasWoodcutting) woodcuttingActive = true
      if (wasMining) miningActive = true
      if (wasFollowing) { following = true; startFollowing(MASTER) }
    }
  }, DODGE_CONFIG.checkInterval)
}

async function dodgeMob(mob) {
  const pos = bot.entity.position, mobPos = mob.position
  const dx = pos.x - mobPos.x, dz = pos.z - mobPos.z, len = Math.sqrt(dx * dx + dz * dz) || 1
  await safeSetGoal(new goals.GoalNear(pos.x + (dx / len) * DODGE_CONFIG.safeDistance, pos.y, pos.z + (dz / len) * DODGE_CONFIG.safeDistance, 2), true)
  await bot.waitForTicks(20)
}

// ===================== AUTO-DETECCIÓN =====================
async function autoDetectLocations() {
  sendPrivateMessage('🔍 Auto-detectando ubicaciones...')

  // Auto-discover chests in area
  await discoverChests(16)

  if (!craftingTableLocation) {
    const table = bot.findBlock({ matching: b => b && b.name === 'crafting_table', maxDistance: 32 })
    if (table) {
      craftingTableLocation = { x: table.position.x, y: table.position.y, z: table.position.z }
      sendPrivateMessage(`✅ Mesa encontrada en ${craftingTableLocation.x} ${craftingTableLocation.y} ${craftingTableLocation.z}`)
    }
  }

  if (!bedLocation) {
    const bed = bot.findBlock({ matching: b => b && b.name.includes('bed'), maxDistance: 32 })
    if (bed) {
      bedLocation = { x: bed.position.x, y: bed.position.y, z: bed.position.z }
      sendPrivateMessage(`✅ Cama encontrada en ${bedLocation.x} ${bedLocation.y} ${bedLocation.z}`)
    }
  }

  saveState()
}

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const parts = message.split(' ')
  const cmd = parts[0].toLowerCase()

  if (cmd === 'aiuda' || cmd === 'help') {
    sendPrivateMessage('📋 COMANDOS:')
    sendPrivateMessage('🚶 seguime | quieto | auto | cuidame | basta')
    sendPrivateMessage('🌲 explora | para (leñador)')
    sendPrivateMessage('⛏️ minar <block> | minar chunk | minar chunk completo')
    sendPrivateMessage('⛏️ minar capa Y | espiral Y | linea Y <dir>')
    sendPrivateMessage('⛏️ picos | parar mina | retomar')
    sendPrivateMessage('📦 agarra <item> | agarra todo <item> | deposita')
    sendPrivateMessage('🏘️ busca aldea | optimiza | ofertas')
    sendPrivateMessage('🛡️ patrulla | stop patrulla')
    sendPrivateMessage('🏠 cofre x y z | cofres | borra cofre N | blacklist')
    sendPrivateMessage('🚫 bloquea cofre x y z | desbloquea cofre x y z')
    sendPrivateMessage('🔍 descubrir | craftear cofre | buscar madera')
    sendPrivateMessage('📍 pos | salud | data')
    return
  }

  if (cmd === 'pos' || cmd === 'dondetas') {
    const p = bot.entity.position
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
    return
  }

  if (cmd === 'salud') {
    sendPrivateMessage(`❤️ ${Math.round(bot.health)}/20 🍗 ${Math.round(bot.food)}/20`)
    return
  }

  if (cmd === 'data') {
    const f = l => l ? `X:${l.x} Y:${l.y} Z:${l.z}` : 'no'
    sendPrivateMessage(`📦 Cofre:${f(chestLocation)} | 📐 Mesa:${f(craftingTableLocation)} | ⛏️ Mina:${f(mineLocation)} | 🛏️ Cama:${f(bedLocation)} | 🏘️ Aldea:${f(villageLocation)}`)
    return
  }

  if (cmd === 'deposita') { await depositInChest(); return }

  if (cmd === 'cofre' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    chestLocations.push({ x, y, z })
    saveState()
    sendPrivateMessage(`✅ Cofre ${chestLocations.length} en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'cofres') {
    if (chestLocations.length === 0) {
      sendPrivateMessage('❌ No hay cofres registrados')
      return
    }
    sendPrivateMessage(`📦 Cofres (${chestLocations.length}):`)
    chestLocations.forEach((c, i) => {
      sendPrivateMessage(`  ${i + 1}. X:${c.x} Y:${c.y} Z:${c.z}`)
    })
    return
  }

  if (cmd === 'borra' && parts[1] === 'cofre' && parts.length === 3) {
    const idx = parseInt(parts[2]) - 1
    if (isNaN(idx) || idx < 0 || idx >= chestLocations.length) {
      sendPrivateMessage('❌ Índice inválido')
      return
    }
    chestLocations.splice(idx, 1)
    saveState()
    sendPrivateMessage(`✅ Cofre ${idx + 1} eliminado`)
    return
  }

  // Blacklist commands
  if (cmd === 'bloquea' && parts[1] === 'cofre' && parts.length === 5) {
    const [x, y, z] = parts.slice(2).map(Number)
    if ([x, y, z].some(isNaN)) return
    chestBlacklist.push({ x, y, z })
    // Remove from regular list if present
    chestLocations = chestLocations.filter(c => !(c.x === x && c.y === y && c.z === z))
    saveState()
    sendPrivateMessage(`🚫 Cofre en ${x} ${y} ${z} bloqueado`)
    return
  }

  if (cmd === 'desbloquea' && parts[1] === 'cofre' && parts.length === 5) {
    const [x, y, z] = parts.slice(2).map(Number)
    if ([x, y, z].some(isNaN)) return
    chestBlacklist = chestBlacklist.filter(c => !(c.x === x && c.y === y && c.z === z))
    saveState()
    sendPrivateMessage(`✅ Cofre en ${x} ${y} ${z} desbloqueado`)
    return
  }

  if (cmd === 'blacklist') {
    if (chestBlacklist.length === 0) {
      sendPrivateMessage('❌ No hay cofres bloqueados')
      return
    }
    sendPrivateMessage(`🚫 Cofres bloqueados (${chestBlacklist.length}):`)
    chestBlacklist.forEach((c, i) => {
      sendPrivateMessage(`  ${i + 1}. X:${c.x} Y:${c.y} Z:${c.z}`)
    })
    return
  }

  // Discover and craft commands
  if (cmd === 'descubrir' || (cmd === 'buscar' && parts[1] === 'cofres')) {
    const radius = parseInt(parts[parts.length - 1]) || 32
    await discoverChests(radius)
    return
  }

  if (cmd === 'craftear' && parts[1] === 'cofre') {
    await craftChest()
    return
  }

  if (cmd === 'buscar' && parts[1] === 'madera') {
    const count = parseInt(parts[2]) || 8
    await findAndCutWood(count)
    return
  }

  if (cmd === 'mesa' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    craftingTableLocation = { x, y, z }; saveState()
    sendPrivateMessage(`✅ Mesa en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'cama' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    bedLocation = { x, y, z }; saveState()
    sendPrivateMessage(`✅ Cama en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'mina' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number)
    if ([x, y, z].some(isNaN)) return
    mineLocation = { x, y, z }; saveState()
    sendPrivateMessage(`✅ Mina en ${x} ${y} ${z}`)
    return
  }

  if (cmd === 'seguime') {
    explorationActive = false; woodcuttingActive = false; miningActive = false; patrolActive = false
    following = true; autoFollowEnabled = true
    startFollowing(MASTER)
    sendPrivateMessage(`🚶 Siguiendo a ${MASTER}...`)
    return
  }

  if (cmd === 'quieto' || cmd === 'basta') {
    stopFollowing()
    explorationActive = false; woodcuttingActive = false; miningActive = false; tradingActive = false
    patrolActive = false; cuidameMode = false
    bot.pathfinder.setGoal(null)
    sendPrivateMessage('🛑 Detenido.')
    return
  }

  if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo auto ACTIVADO' : '❌ Modo auto DESACTIVADO')
    if (autoFollowEnabled && !following) { following = true; startFollowing(MASTER) }
    return
  }

  if (cmd === 'cuidame') {
    if (cuidameMode) {
      stopCuidame()
    } else {
      await startCuidame()
    }
    return
  }

  if (cmd === 'explora') {
    if (following) stopFollowing()
    explorationActive = true
    woodcuttingActive = false
    sendPrivateMessage('🌲 Modo leñador activado.')
    exploreChunks()
    return
  }

  if (cmd === 'para' && explorationActive) {
    explorationActive = false
    woodcuttingActive = false
    sendPrivateMessage('🛑 Leñador detenido.')
    return
  }

  // Original auto-mining command
  if (cmd === 'minar' && parts.length >= 2 && parts[1] !== 'chunk' && parts[1] !== 'capa') {
    const block = parts[1]
    if (!mcData.blocksByName[block]) { sendPrivateMessage(`❌ Bloque ${block} no existe`); return }

    if (!mineLocation) { sendPrivateMessage('❌ Define ubicación de mina con "mina x y z"'); return }

    explorationActive = false; woodcuttingActive = false; following = false; patrolActive = false
    if (followInterval) clearInterval(followInterval)
    bot.pathfinder.setGoal(null)
    await sleep(100)

    miningTarget = block
    miningActive = true
    miningMode = 'auto'
    saveMiningProgress()
    sendPrivateMessage(`⛏️ Minando ${block} en chunk...`)
    chunkMiningLoop()
    return
  }

  // New descending mining commands from bot_minero
  if (cmd === 'minar' && parts[1] === 'chunk' && parts[2] === 'completo') {
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (following) stopFollowing()
    
    miningActive = true
    miningMode = 'descending'
    sendPrivateMessage('⛏️ Minando chunk completo hasta bedrock sin preguntar...')
    await mineChunkFullDescending()
    miningActive = false
    miningMode = null
  }
  else if (cmd === 'minar' && parts[1] === 'chunk') {
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (following) stopFollowing()
    
    miningActive = true
    miningMode = 'descending'
    sendPrivateMessage('⛏️ Minando chunk por segmentos (preguntando cada 16 bloques)...')
    await mineChunkDescending(true)
    miningActive = false
    miningMode = null
  }
  else if (cmd === 'minar' && parts[1] === 'capa' && parts.length === 3) {
    const y = parseInt(parts[2])
    if (isNaN(y)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (following) stopFollowing()
    
    miningActive = true
    miningMode = 'layer'
    await mineLayerInCurrentChunk(y)
    sendPrivateMessage(`✅ Listo! Capa ${y} minada.`)
    miningActive = false
    miningMode = null
  }
  else if (cmd === 'espiral' && parts.length === 2) {
    const y = parseInt(parts[1])
    if (isNaN(y)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (following) stopFollowing()
    
    miningActive = true
    miningMode = 'spiral'
    sendPrivateMessage(`🌀 Minando en espiral en capa Y=${y}...`)
    await spiralMining(y)
    miningActive = false
    miningMode = null
  }
  else if (cmd === 'linea' && parts.length === 3) {
    const y = parseInt(parts[1])
    const dir = parts[2]
    if (isNaN(y) || !['x+', 'x-', 'z+', 'z-'].includes(dir)) return
    if (miningActive) {
      sendPrivateMessage('⚠️ Ya estoy minando.')
      return
    }
    if (following) stopFollowing()
    
    miningActive = true
    miningMode = 'line'
    sendPrivateMessage(`➡️ Minando en línea recta (${dir}) en capa Y=${y}...`)
    await lineMining(y, dir)
    miningActive = false
    miningMode = null
  }
  else if (cmd === 'picos') {
    reportPickaxes()
    return
  }
  else if (cmd === 'agarra') {
    if (!chestLocation) {
      sendPrivateMessage('❌ No hay cofre registrado')
      return
    }

    // Check if it's "agarra todo <item>"
    if (parts[1] === 'todo' && parts.length >= 3) {
      const item = parts.slice(2).join(' ')
      // Get ALL items with that name from chest
      const success = await getAllItemsFromChest(item)
      if (success) {
        const count = bot.inventory.items().filter(i => i.name === item).reduce((s, i) => s + i.count, 0)
        sendPrivateMessage(`✅ Saqué TODO el ${item} del cofre (total: ${count})`)
      } else {
        sendPrivateMessage(`❌ No encontré ${item} en el cofre`)
      }
    } else {
      // Original behavior: take 1
      const item = message.split(' ').slice(1).join(' ')
      if (await getItemFromChest(item, 1)) {
        sendPrivateMessage(`✅ Saqué ${item} del cofre`)
      }
    }
  }

  if (cmd === 'parar' && parts[1] === 'mina') {
    miningActive = false
    clearMiningProgress()
    sendPrivateMessage('🛑 Minería detenida.')
    return
  }

  if (cmd === 'retomar') {
    if (miningActive) { sendPrivateMessage('⚠️ Ya estoy minando.'); return }
    const prog = loadMiningProgress()
    if (!prog) { sendPrivateMessage('❌ No hay progreso de minería.'); return }
    miningTarget = prog.target
    miningActive = true
    currentChunkMining = { startY: prog.layer, currentY: prog.layer, chunkX: prog.chunkX, chunkZ: prog.chunkZ, startX: prog.startX, startZ: prog.startZ }
    await safeGoto(prog.posX, prog.layer, prog.posZ, 3)
    sendPrivateMessage('▶️ Retomando minería...')
    chunkMiningLoop()
    return
  }

  if (cmd === 'busca' && parts[1] === 'aldea') {
    await findVillage()
    return
  }

  if (cmd === 'optimiza') {
    if (!villageLocation) { await findVillage() }
    await optimizeVillage()
    return
  }

  if (cmd === 'ofertas' || cmd === 'averiguar') {
    await investigateAllVillagers()
    return
  }

  if (cmd === 'patrulla') {
    if (patrolActive) {
      stopPatrol()
    } else {
      await patrol()
    }
    return
  }

  if (cmd === 'dormi') {
    await sleepInBed()
    return
  }

  sendPrivateMessage('❌ Comando no reconocido. Usa "aiuda" para ver comandos.')
}

// ===================== EVENTOS =====================
bot.on('spawn', () => {
  console.log('✅ Bot definitivo conectado')
  sendPrivateMessage('🤖 Bot definitivo listo. Usa "aiuda" para comandos.')

  const movements = new Movements(bot)
  movements.allowSprinting = true
  movements.allowParkour = true
  movements.allowSneaking = true
  bot.pathfinder.setMovements(movements)

  loadState()
  setInterval(checkHealthAndHunger, 5000)
  setInterval(() => { if (!explorationActive && !following && !miningActive) depositExcessIfNeeded() }, 30000)
  startDodgeSystem()

  const isNight = bot.time.timeOfDay > 12000
  if (isNight) {
    sendPrivateMessage('🌙 Es de noche. Esquivo mobs automáticamente.')
  }
})

bot.on('whisper', async (username, message) => {
  if (username !== MASTER) {
    bot.chat(`/tell ${username} Solo respondo a ${MASTER}.`)
    return
  }
  // Handle confirmation responses
  if (pendingConfirmation && (message.toLowerCase() === 'si' || message.toLowerCase() === 'sí' || message.toLowerCase() === 'yes' || message.toLowerCase() === 'no')) {
    if (handleConfirmationResponse(message)) return
  }
  await handleCommand(message)
})

bot.on('chat', async (username, message) => {
  if (username === bot.username || username !== MASTER) return
  // Handle confirmation responses
  if (pendingConfirmation && (message.toLowerCase() === 'si' || message.toLowerCase() === 'sí' || message.toLowerCase() === 'yes' || message.toLowerCase() === 'no')) {
    if (handleConfirmationResponse(message)) return
  }
  await handleCommand(message)
})

bot.on('time', async () => {
  const isNight = bot.time.timeOfDay > 12000
  if (isNight && following && !cuidameMode) {
    stopFollowing()
    if (bedLocation || villageBedLocation) {
      sendPrivateMessage('🌙 Durmiendo...')
      await sleepInBed()
    } else {
      sendPrivateMessage('🌙 Me quedo quieto.')
    }
  }
})

bot.on('error', err => {
  const msg = err.message || String(err)
  
  if (msg.includes('GoalChanged') || msg.includes('timeout')) {
    pathfindingLock = false
    return
  }
  
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    console.error('🔌 Error de conexión:', msg)
  } else {
    console.error('❌ Error:', msg)
  }
})

bot.on('end', () => console.log('🔌 Bot desconectado'))