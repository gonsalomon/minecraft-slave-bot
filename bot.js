// =====================
//   REQUIRES & SETUP
// =====================
const fs   = require('fs')
const Vec3 = require('vec3')

require('dotenv').config()
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcData = require('minecraft-data')('1.21.1')

const MASTER = process.env.MC_MASTER ?? 'gonsalomon'

const bot = mineflayer.createBot({
  host:     process.env.MC_HOST           ?? 'localhost',
  port:     parseInt(process.env.MC_PORT) ?? 25565,
  username: process.env.MC_USERNAME       ?? 'minero',
  version:  process.env.MC_VERSION        ?? '1.21.1'
})

bot.loadPlugin(pathfinder)

// =====================
//   CONSTANTES GLOBALES
// =====================

// Bloques y recursos
const WOOD_BLOCKS = new Set([
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
])

const TREE_HEIGHT_LIMIT = 8

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

// Comida
const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'bread',
  'baked_potato', 'carrot', 'apple', 'melon_slice', 'cookie',
  'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken',
  'raw_salmon', 'raw_cod', 'rotten_flesh'
]

// Herramientas y armas
const PICKAXE_FOR_BLOCK = {
  'coal_ore': 'stone_pickaxe', 'deepslate_coal_ore': 'stone_pickaxe',
  'stone': 'stone_pickaxe', 'iron_ore': 'stone_pickaxe',
  'deepslate_iron_ore': 'iron_pickaxe', 'lapis_ore': 'iron_pickaxe',
  'deepslate_lapis_ore': 'iron_pickaxe', 'gold_ore': 'iron_pickaxe',
  'deepslate_gold_ore': 'iron_pickaxe', 'diamond_ore': 'iron_pickaxe',
  'deepslate_diamond_ore': 'iron_pickaxe', 'redstone_ore': 'iron_pickaxe',
  'deepslate_redstone_ore': 'iron_pickaxe', 'emerald_ore': 'iron_pickaxe',
  'obsidian': 'diamond_pickaxe', 'ancient_debris': 'diamond_pickaxe'
}

const PICKAXE_MATERIAL = {
  'wooden_pickaxe': 'oak_planks', 'stone_pickaxe': 'cobblestone',
  'iron_pickaxe': 'iron_ingot', 'diamond_pickaxe': 'diamond'
}

const PICKAXE_TIER = {
  'wooden_pickaxe': 1, 'stone_pickaxe': 2, 'golden_pickaxe': 2,
  'iron_pickaxe': 3, 'diamond_pickaxe': 4, 'netherite_pickaxe': 5
}

const SWORD_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword', 'golden_sword', 'wooden_sword'
]

const AXE_PRIORITY = [
  'netherite_axe', 'diamond_axe', 'iron_axe',
  'stone_axe', 'golden_axe', 'wooden_axe'
]

const WEAPON_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword', 'golden_sword', 'wooden_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe',
  'stone_axe', 'golden_axe', 'wooden_axe'
]

// Armadura
const ARMOR_PRIORITY = {
  head: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'golden_helmet', 'chainmail_helmet', 'leather_helmet'],
  torso: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'golden_chestplate', 'chainmail_chestplate', 'leather_chestplate'],
  legs: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'golden_leggings', 'chainmail_leggings', 'leather_leggings'],
  feet: ['netherite_boots', 'diamond_boots', 'iron_boots', 'golden_boots', 'chainmail_boots', 'leather_boots']
}

// Minería
const OPTIMAL_Y = {
  'coal_ore': 96, 'deepslate_coal_ore': 0, 'iron_ore': 16,
  'deepslate_iron_ore': -16, 'gold_ore': -16, 'deepslate_gold_ore': -16,
  'lapis_ore': 0, 'deepslate_lapis_ore': -32, 'diamond_ore': -58,
  'deepslate_diamond_ore': -58, 'redstone_ore': -58, 'deepslate_redstone_ore': -58,
  'emerald_ore': -16, 'ancient_debris': 15, 'obsidian': -40
}

const MINE_RADIUS = 16

// Combate
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
  creeper: { strategy: 'hit_and_run', safeDistance: 4, warning: '💣 Creeper! Mantener distancia!' },
  skeleton: { strategy: 'shield_rush', safeDistance: 2, warning: '🏹 Esqueleto! Usando escudo!' },
  spider: { strategy: 'aggressive', safeDistance: 2, warning: '🕷️ Araña!' },
  enderman: { strategy: 'avoid', safeDistance: 8, warning: '👁️ Enderman! No mirar!' },
  witch: { strategy: 'rush', safeDistance: 3, warning: '🧪 Bruja! Cargar!' },
  blaze: { strategy: 'ranged_dodge', safeDistance: 5, warning: '🔥 Blaze! Cuidado!' }
}

// Evasión
const DODGE_CONFIG = {
  enabled: true, detectionRadius: 8, safeDistance: 12,
  checkInterval: 500, priorityOverride: true
}

// Exploración
const EXPLORATION_CONFIG = {
  chunkRadius: 3, checkInterval: 5000, moveSpeed: 'normal'
}

// =====================
//   ESTADO GLOBAL
// =====================
let chestLocation = null
let craftingTableLocation = null
let mineLocation = null
let farmLocation = null
let bedLocation = null

let miningActive = false
let miningTarget = null
let currentMineY = null
let pendingPickaxe = null

let followingPlayer = false
let followInterval = null

let huntingActive = false
let currentCombatState = CombatState.IDLE
let currentTarget = null
let lastShieldUse = 0
let combatTick = 0

let explorationActive = false
let woodcuttingActive = false
let exploredChunks = new Set()
let woodcuttingCooldown = false

let isEating = false
let dodgeInterval = null
let isDodging = false

let pathfindingLock = false
let pendingGoal = null

// =====================
//   PERSISTENCIA
// =====================
const STATE_FILE = './state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation = data.chestLocation ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    mineLocation = data.mineLocation ?? null
    farmLocation = data.farmLocation ?? null
    bedLocation = data.bedLocation ?? null
    console.log('📂 Estado cargado:', data)
  } catch {
    console.log('📂 Sin estado previo, arrancando limpio.')
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, mineLocation, farmLocation, bedLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

// =====================
//   DEPÓSITO EN COFRE
// =====================
const depositState = {
  active: false, lastRun: 0, lastInventoryHash: null, cooldown: 5000
}

function getInventoryHash() {
  return bot.inventory.items()
    .filter(i => !i.name.includes('pickaxe') && !i.name.includes('sword') &&
      !Object.values(ARMOR_PRIORITY).flat().includes(i.name) && !FOOD_PRIORITY.includes(i.name))
    .map(i => `${i.name}:${i.count}`).sort().join('|')
}

async function getItemFromChest(itemName, count) {
  try {
    await bot.pathfinder.goto(new goals.GoalNear(chestLocation.x, chestLocation.y, chestLocation.z, 2))
    const chest = await bot.openChest(bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z)))
    const item = chest.containerItems().find(i => i.name === itemName)
    if (!item) { chest.close(); return false }
    await chest.withdraw(item.type, null, Math.min(item.count, count))
    chest.close()
    return true
  } catch { return false }
}

async function depositInChest() {
  if (!chestLocation) { bot.chat('No hay cofre registrado.'); return }
  if (depositState.active) { while (depositState.active) await bot.waitForTicks(10); return }

  const currentHash = getInventoryHash()
  if (currentHash !== '' && currentHash === depositState.lastInventoryHash) {
    console.log('📦 Inventario sin cambios, salteando.')
    return
  }

  const now = Date.now()
  if (now - depositState.lastRun < depositState.cooldown) {
    await new Promise(resolve => setTimeout(resolve, depositState.cooldown - (now - depositState.lastRun)))
  }

  depositState.active = true
  depositState.lastRun = Date.now()
  const wasMiningActive = miningActive
  if (wasMiningActive) miningActive = false

  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) { bot.chat('No encuentro el cofre.'); return }

    const armorNames = new Set(Object.values(ARMOR_PRIORITY).flat())
    const keepTypes = new Set()
    for (const item of bot.inventory.items()) {
      const isTool = item.name.includes('pickaxe') || item.name.includes('sword') || item.name.includes('axe')
      const isArmor = armorNames.has(item.name)
      const isFood = FOOD_PRIORITY.includes(item.name) && bot.food < 18
      if (isTool || isArmor || isFood) keepTypes.add(item.type)
    }

    const chest = await bot.openChest(chestBlock)
    let depositedCount = 0
    const depositedNames = []
    for (const item of bot.inventory.items()) {
      if (keepTypes.has(item.type)) continue
      await chest.deposit(item.type, null, item.count)
      depositedCount += item.count
      depositedNames.push(`${item.count}x ${item.name}`)
    }
    chest.close()

    if (depositedCount > 0) bot.chat(`✅ Depositados ${depositedCount} items`)
    depositState.lastInventoryHash = getInventoryHash()
    await reEquipTool()

    if (wasMiningActive && miningTarget && !huntingActive && !followingPlayer) {
      miningActive = true
      setTimeout(() => { if (miningActive && miningTarget) shaftMiningLoop() }, 1000)
    }
  } catch (err) {
    if (!err.message?.includes('GoalChanged')) console.error('depositInChest error:', err)
  } finally {
    depositState.active = false
    pathfindingLock = false
  }
}

// =====================
//   PATHFINDING & MOVIMIENTO
// =====================
async function safeSetGoal(goal, priority = false) {
  if (pathfindingLock) { pendingGoal = { goal, priority }; return false }
  try {
    pathfindingLock = true
    bot.pathfinder.setGoal(goal, priority)
    return true
  } catch (err) { return false }
  finally {
    setTimeout(() => {
      pathfindingLock = false
      if (pendingGoal) { const { goal, priority } = pendingGoal; pendingGoal = null; safeSetGoal(goal, priority) }
    }, 500)
  }
}

async function safeGoto(x, y, z, range = 2) {
  if (pathfindingLock) await new Promise(resolve => { const check = setInterval(() => { if (!pathfindingLock) { clearInterval(check); resolve() } }, 100) })
  setSprintMode(false)
  try { await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)) }
  catch (err) { if (err.message !== 'GoalChanged: The goal was changed before it could be completed!') throw err }
  finally { setSprintMode(true); pathfindingLock = false }
}

function setSprintMode(enabled) {
  const movements = new Movements(bot)
  movements.allowSprinting = enabled
  bot.pathfinder.setMovements(movements)
}

// =====================
//   HELPERS BÁSICOS
// =====================
function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    return b && (b.name === 'lava' || b.name === 'flowing_lava')
  })
}

function getNearestHostile(maxDistance) {
  return Object.values(bot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < maxDistance)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null
}

async function pickupNearbyItems() {
  const droppedItems = Object.values(bot.entities).filter(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 5)
  if (droppedItems.length === 0) return
  for (const item of droppedItems) {
    try { await safeGoto(item.position.x, item.position.y, item.position.z, 1); await bot.waitForTicks(10) }
    catch (err) { console.error('Error picking up item:', err) }
  }
  const hashNow = getInventoryHash()
  if (hashNow !== depositState.lastInventoryHash) await depositInChest()
}

async function safeDig(block) {
  if (!block || block.type === 0) return false
  const fresh = bot.blockAt(block.position)
  if (!fresh || fresh.type === 0 || fresh.name === 'air') return false
  if (PROTECTED_BLOCKS.has(fresh.name)) return false
  await reEquipTool()
  try { await bot.dig(fresh, true); return true }
  catch (err) { if (err.message?.includes('air') || err.message?.includes('already')) return false; throw err }
}

// =====================
//   COMIDA Y SALUD
// =====================
function findFoodInInventory() {
  for (const name of FOOD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  return null
}

async function consumeFood(foodItem) {
  try { await bot.equip(foodItem, 'hand'); await bot.consume() }
  catch (err) { console.error('consumeFood error:', err) }
}

async function eatFood() {
  if (bot.food >= 20) return
  let food = findFoodInInventory()
  if (food) { await consumeFood(food); await reEquipTool(); return }

  if (chestLocation) {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chest = await bot.openChest(bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z)))
    for (const name of FOOD_PRIORITY) {
      const item = chest.containerItems().find(i => i.name === name)
      if (item) { await chest.withdraw(item.type, null, Math.min(item.count, 16)); break }
    }
    chest.close()
    food = findFoodInInventory()
    if (food) { await consumeFood(food); await reEquipTool(); return }
  }

  const wheat = bot.inventory.items().filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)
  if (wheat >= 3) { await makeBread(); food = findFoodInInventory(); if (food) await consumeFood(food) }
  else if (farmLocation) { await harvestWheat(); await makeBread(); food = findFoodInInventory(); if (food) await consumeFood(food) }
}

// =====================
//   ARMADURA Y EQUIPAMIENTO
// =====================
function getArmorSlotIndex(slot) {
  const map = { head: 5, torso: 6, legs: 7, feet: 8 }
  return map[slot] || 5
}

async function equipBestArmor() {
  let equipped = 0
  for (const [slot, priority] of Object.entries(ARMOR_PRIORITY)) {
    const current = bot.inventory.slots[getArmorSlotIndex(slot)]
    const currentTier = current ? priority.indexOf(current.name) : Infinity
    let bestName = null, bestTier = Infinity

    for (let i = 0; i < priority.length; i++) {
      if (bot.inventory.items().some(item => item.name === priority[i])) { bestName = priority[i]; bestTier = i; break }
    }

    if (chestLocation && bestTier >= currentTier) {
      try {
        await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
        const chest = await bot.openChest(bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z)))
        for (let i = 0; i < priority.length && i < currentTier; i++) {
          const found = chest.containerItems().find(item => item.name === priority[i])
          if (found) { await chest.withdraw(found.type, null, 1); if (i < bestTier) { bestName = found.name; bestTier = i }; break }
        }
        chest.close()
      } catch (err) { bot.chat(`Error: ${err.message}`) }
    }

    if (bestName && bestTier < currentTier) {
      const item = bot.inventory.items().find(i => i.name === bestName)
      if (item) { await bot.equip(item, slot); equipped++ }
    }
  }
  if (equipped > 0) bot.chat(`✅ Equipadas ${equipped} pieza(s) nueva(s)`)
  await reEquipTool()
}

async function equipItem(item) {
  const name = item.name
  if (name === 'shield') { await bot.equip(item, 'off-hand'); return }
  if (name.endsWith('helmet')) { await bot.equip(item, 'head'); return }
  if (name.endsWith('chestplate')) { await bot.equip(item, 'torso'); return }
  if (name.endsWith('leggings')) { await bot.equip(item, 'legs'); return }
  if (name.endsWith('boots')) { await bot.equip(item, 'feet'); return }
  await bot.equip(item, 'hand')
}

async function reEquipTool() {
  if (miningActive && miningTarget) await equipPickaxe(PICKAXE_FOR_BLOCK[miningTarget] ?? 'stone_pickaxe')
  else if (huntingActive) await equipBestWeapon()
}

// =====================
//   PICOS Y MINERÍA
// =====================
async function ensurePickaxe(blockName) {
  const minPickaxe = PICKAXE_FOR_BLOCK[blockName] ?? 'stone_pickaxe'
  const minTier = PICKAXE_TIER[minPickaxe]
  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('pickaxe') && (PICKAXE_TIER[equipped.name] ?? 0) >= minTier) return true

  const available = bot.inventory.items().filter(i => i.name.includes('pickaxe') && (PICKAXE_TIER[i.name] ?? 0) >= minTier)
  if (available.length) { await equipPickaxe(available[0].name); return true }

  if (chestLocation) {
    const chestPickaxes = await getPickaxesFromChest()
    const suitable = chestPickaxes.filter(p => (PICKAXE_TIER[p.name] ?? 0) >= minTier)
    if (suitable.length && await getItemFromChest(suitable[0].name, 1)) { await equipPickaxe(suitable[0].name); return true }
  }
  if (await craftPickaxe(minPickaxe)) { await equipPickaxe(minPickaxe); return true }
  return false
}

async function getPickaxesFromChest() {
  if (!chestLocation) return []
  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    const chest = await bot.openChest(bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z)))
    const pickaxes = chest.containerItems().filter(i => i.name.includes('pickaxe'))
    chest.close()
    return pickaxes
  } catch { return [] }
}

async function equipPickaxe(name) {
  const item = bot.inventory.items().find(i => i.name === name)
  if (item) await bot.equip(item, 'hand')
}

async function craftPickaxe(pickaxeName) {
  const material = PICKAXE_MATERIAL[pickaxeName]
  if (!material) return false
  const count = (name) => bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
  if (count(material) < 3) await getItemFromChest(material, 3 - count(material))
  if (count('stick') < 2) await getItemFromChest('stick', 2 - count('stick'))
  if (count(material) < 3 || count('stick') < 2) return false
  try {
    await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2)
    const table = bot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z))
    const recipes = bot.recipesFor(mcData.itemsByName[pickaxeName].id, null, 1, table)
    if (!recipes.length) return false
    await bot.craft(recipes[0], 1, table)
    return true
  } catch { return false }
}

// =====================
//   MINERÍA
// =====================
async function shaftMiningLoop() {
  const optimalY = OPTIMAL_Y[miningTarget] ?? -58
  const cx = Math.floor(mineLocation.x), cz = Math.floor(mineLocation.z)
  const startY = currentMineY ?? mineLocation.y
  await safeGoto(cx, startY, cz, 4)
  if (!miningActive) return
  await digStaircaseDown(cx, cz, optimalY)
  if (miningActive) { miningActive = false; currentMineY = null; await depositInChest() }
}

async function digStaircaseDown(cx, cz, targetY) {
  const HALF = 4, stepX = cx + HALF - 1, stepZ = cz + HALF - 1
  while (miningActive && Math.floor(bot.entity.position.y) > targetY) {
    const currentY = Math.floor(bot.entity.position.y)
    currentMineY = currentY
    await mineLayer(cx, cz, currentY, HALF)
    if (!miningActive) return
    if (bot.inventory.emptySlotCount() < 4) { await depositInChest(); if (!miningActive) return }
    await safeGoto(stepX, currentY, stepZ, 1)
    if (!miningActive) return
    const step1 = bot.blockAt(new Vec3(stepX, currentY - 1, stepZ))
    const step2 = bot.blockAt(new Vec3(stepX, currentY - 2, stepZ))
    if (step1?.diggable && !step1.name.includes('lava')) await safeDig(step1)
    if (step2?.diggable && !step2.name.includes('lava')) await safeDig(step2)
    await safeGoto(stepX, currentY - 1, stepZ, 1)
  }
}

async function mineLayer(cx, cz, layerY, half) {
  const minX = cx - half, maxX = cx + half - 1, minZ = cz - half, maxZ = cz + half - 1
  const mineable = new Set(['stone', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite', 'gravel', 'dirt', 'sand', 'sandstone',
    'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore', 'gold_ore', 'deepslate_gold_ore',
    'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'lapis_ore',
    'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore', 'copper_ore', 'deepslate_copper_ore'])

  for (let dz = 0; dz <= half * 2 - 1; dz++) {
    const zPos = minZ + dz
    const xRange = Array.from({ length: half * 2 }, (_, i) => minX + i)
    const xRow = dz % 2 === 0 ? xRange : [...xRange].reverse()
    for (const xPos of xRow) {
      if (!miningActive) return
      if (bot.inventory.emptySlotCount() < 4) { await depositInChest(); await bot.pathfinder.goto(new goals.GoalNear(xPos, layerY, zPos, 2)) }
      await bot.pathfinder.goto(new goals.GoalNear(xPos, layerY, zPos, 1))
      for (const dy of [0, 1]) {
        const block = bot.blockAt(new Vec3(xPos, layerY + dy, zPos))
        if (!block || block.name === 'air') continue
        const shouldMine = block.name === miningTarget || mineable.has(block.name) || block.diggable
        if (shouldMine && !hasLavaNearby(block.position)) await safeDig(block)
      }
    }
  }
}

async function nearbyMiningLoop(yTolerance = 10) {
  const baseY = Math.floor(bot.entity.position.y)
  while (miningActive) {
    if (bot.inventory.emptySlotCount() < 4) { await depositInChest(); if (!miningActive) break }
    const block = bot.findBlock({ matching: b => b && b.name === miningTarget && Math.abs(b.position.y - baseY) <= yTolerance, maxDistance: 32 })
    if (!block) { miningActive = false; await depositInChest(); break }
    if (hasLavaNearby(block.position)) { await bot.waitForTicks(10); continue }
    await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1))
    if (!miningActive) break
    await safeDig(block)
  }
}

// =====================
//   GRANJA
// =====================
async function harvestWheat() {
  if (!farmLocation) return
  await safeGoto(farmLocation.x, farmLocation.y, farmLocation.z, 4)
  let harvested = 0
  while (true) {
    const wheat = bot.findBlock({ matching: b => b?.name === 'wheat' && b.getProperties().age === 7, maxDistance: 32 })
    if (!wheat) break
    await bot.pathfinder.goto(new goals.GoalNear(wheat.position.x, wheat.position.y, wheat.position.z, 1))
    await safeDig(wheat)
    harvested++
    const seed = bot.inventory.items().find(i => i.name === 'wheat_seeds')
    const farmland = bot.blockAt(wheat.position.offset(0, -1, 0))
    if (seed && farmland?.name === 'farmland') await bot.placeBlock(farmland, new Vec3(0, 1, 0))
  }
  bot.chat(`Cosechadas ${harvested} plantas`)
}

async function makeBread() {
  const wheat = bot.inventory.items().filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)
  if (wheat < 3) return
  const recipes = bot.recipesFor(mcData.itemsByName['bread'].id, null, Math.floor(wheat / 3), null)
  if (recipes.length) await bot.craft(recipes[0], Math.floor(wheat / 3), null)
}

// =====================
//   LEÑADOR
// =====================
function findCompleteTree(maxDistance = 20) {
  const log = bot.findBlock({ matching: b => WOOD_BLOCKS.has(b?.name), maxDistance })
  if (!log) return null
  const tree = []
  for (let y = -2; y <= TREE_HEIGHT_LIMIT; y++) {
    const block = bot.blockAt(log.position.offset(0, y, 0))
    if (block && WOOD_BLOCKS.has(block.name)) tree.push(block)
  }
  return tree.length ? tree : null
}

async function ensureAxe() {
  const equipped = bot.inventory.slots[36]
  if (equipped && equipped.name.includes('axe')) return true
  const axe = bot.inventory.items().find(i => i.name.includes('axe'))
  if (axe) { await bot.equip(axe, 'hand'); return true }
  if (chestLocation) {
    for (const type of AXE_PRIORITY) {
      if (await getItemFromChest(type, 1)) { await bot.equip(bot.inventory.items().find(i => i.name === type), 'hand'); return true }
    }
  }
  return false
}

async function cutTree(treeBlocks) {
  if (!explorationActive && !woodcuttingActive) return
  woodcuttingActive = true
  if (!await ensureAxe()) { bot.chat('❌ No tengo hacha'); woodcuttingActive = false; return }
  treeBlocks.sort((a, b) => a.position.y - b.position.y)
  for (const block of treeBlocks) {
    if (!explorationActive && !woodcuttingActive) break
    if (getNearestHostile(8)) { woodcuttingActive = false; return }
    await safeGoto(block.position.x, block.position.y, block.position.z, 2)
    await safeDig(block)
  }
  woodcuttingActive = false
  woodcuttingCooldown = true
  setTimeout(() => woodcuttingCooldown = false, 2000)
  await pickupNearbyItems()
}

// =====================
//   EXPLORACIÓN
// =====================
async function exploreChunks() {
  if (!explorationActive) return
  const cx = Math.floor(bot.entity.position.x / 16), cz = Math.floor(bot.entity.position.z / 16)
  const key = `${cx},${cz}`
  if (exploredChunks.has(key)) {
    const next = getNextUnexploredChunk(cx, cz)
    if (next) await moveToChunk(next.x, next.z)
    else { exploredChunks.clear(); bot.chat('🏁 Reiniciando exploración') }
    return
  }
  exploredChunks.add(key)
  await patrolChunk(cx, cz)
}

function getNextUnexploredChunk(cx, cz) {
  for (let r = 1; r <= EXPLORATION_CONFIG.chunkRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r || Math.abs(dz) === r) {
          const key = `${cx + dx},${cz + dz}`
          if (!exploredChunks.has(key)) return { x: cx + dx, z: cz + dz }
        }
      }
    }
  }
  return null
}

async function moveToChunk(cx, cz) {
  await safeGoto(cx * 16 + 8, bot.entity.position.y, cz * 16 + 8, 8)
}

async function patrolChunk(cx, cz) {
  const minX = cx * 16, maxX = minX + 15, minZ = cz * 16, maxZ = minZ + 15
  const points = [{ x: minX + 4, z: minZ + 4 }, { x: maxX - 4, z: minZ + 4 }, { x: maxX - 4, z: maxZ - 4 }, { x: minX + 4, z: maxZ - 4 }]
  for (const p of points) {
    if (!explorationActive) break
    await safeGoto(p.x, bot.entity.position.y, p.z, 5)
    const tree = findCompleteTree(10)
    if (tree && !woodcuttingCooldown) await cutTree(tree)
  }
}

// =====================
//   EVASIÓN DE MOBS
// =====================
function startDodgeSystem() {
  if (dodgeInterval) clearInterval(dodgeInterval)
  dodgeInterval = setInterval(async () => {
    if (isDodging || !DODGE_CONFIG.enabled) return
    const mob = getNearestHostile(DODGE_CONFIG.detectionRadius)
    if (!mob) return
    const wasExploring = explorationActive, wasWoodcutting = woodcuttingActive
    if (wasExploring || wasWoodcutting) { explorationActive = false; woodcuttingActive = false; bot.pathfinder.setGoal(null) }
    isDodging = true
    try { await dodgeMob(mob) }
    catch (err) { console.error('Error en dodge:', err) }
    finally {
      isDodging = false
      if (wasExploring && !miningActive && !huntingActive && !followingPlayer) { explorationActive = true; exploreChunks() }
      else if (wasWoodcutting && !miningActive && !huntingActive && !followingPlayer) { woodcuttingActive = true; const tree = findCompleteTree(); if (tree) cutTree(tree) }
    }
  }, DODGE_CONFIG.checkInterval)
}

async function dodgeMob(mob) {
  const pos = bot.entity.position, mobPos = mob.position
  const dx = pos.x - mobPos.x, dz = pos.z - mobPos.z, len = Math.sqrt(dx * dx + dz * dz) || 1
  await safeSetGoal(new goals.GoalNear(pos.x + (dx / len) * DODGE_CONFIG.safeDistance, pos.y, pos.z + (dz / len) * DODGE_CONFIG.safeDistance, 2), true)
  await bot.waitForTicks(20)
}

function stopDodgeSystem() { if (dodgeInterval) { clearInterval(dodgeInterval); dodgeInterval = null } isDodging = false }

// =====================
//   COMBATE Y CAZA
// =====================
function evaluateThreat(mob) {
  const special = SPECIAL_MOBS[mob.name]
  const distance = mob.position.distanceTo(bot.entity.position)
  let threat = (special ? 30 : 0) + (special?.strategy === 'hit_and_run' ? 20 : 0) + (special?.strategy === 'ranged_dodge' ? 25 : 0)
  threat += distance < 2 ? 40 : distance < 4 ? 20 : distance < 6 ? 10 : 0
  threat += bot.health < HUNT_CONFIG.retreatHealth ? 50 : bot.health < HUNT_CONFIG.safeHealth ? 25 : 0
  return { level: threat, shouldEngage: threat < 60 && bot.health > HUNT_CONFIG.retreatHealth, shouldRetreat: threat > 70 || bot.health < HUNT_CONFIG.retreatHealth, strategy: special?.strategy || 'normal' }
}

function analyzeSituation() {
  const mobs = Object.values(bot.entities).filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) && e.position.distanceTo(bot.entity.position) < HUNT_CONFIG.awarenessRadius)
  if (!mobs.length) return { safe: true, totalThreat: 0 }
  let total = 0
  const threats = mobs.map(m => { const t = evaluateThreat(m); total += t.level; return { mob: m, ...t } })
  const priority = threats.filter(t => t.shouldEngage).sort((a, b) => b.level - a.level)[0]
  return { safe: total < 50, shouldFlee: total > 100 || (priority?.shouldRetreat), threats, priorityTarget: priority?.mob, totalThreat: total }
}

function hasShield() { const off = bot.inventory.slots[45]; return off && off.name === 'shield' }

async function equipShield() {
  if (hasShield()) return true
  const shield = bot.inventory.items().find(i => i.name === 'shield')
  if (shield) { await bot.equip(shield, 'off-hand'); return true }
  if (chestLocation && await getItemFromChest('shield', 1)) { await bot.equip(bot.inventory.items().find(i => i.name === 'shield'), 'off-hand'); return true }
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
  if (chestLocation) {
    for (const name of WEAPON_PRIORITY) {
      if (await getItemFromChest(name, 1)) { const w = bot.inventory.items().find(i => i.name === name); if (w) { await bot.equip(w, 'hand'); return name } }
    }
  }
  return null
}

async function attackMob(mob) {
  if (!mob?.isValid) return false
  try { bot.lookAt(mob.position.offset(0, 1, 0)); await bot.attack(mob); combatTick++; return true }
  catch { return false }
}

async function retreatFromMob(mob) {
  currentCombatState = CombatState.RETREATING
  const dir = bot.entity.position.minus(mob.position).normalize()
  const flee = bot.entity.position.plus(dir.scaled(HUNT_CONFIG.fallbackDistance))
  if (hasShield()) await useShield(20)
  await safeSetGoal(new goals.GoalNear(flee.x, flee.y, flee.z, 3), true)
  await bot.waitForTicks(40)
  if (analyzeSituation().safe && bot.health < HUNT_CONFIG.safeHealth) await eatFood()
  currentCombatState = CombatState.IDLE
}

async function fightMob(mob) {
  if (!mob?.isValid) return false
  const threat = evaluateThreat(mob)
  if (!await equipBestWeapon()) { bot.chat('No tengo arma'); return false }
  currentTarget = mob
  currentCombatState = CombatState.APPROACHING
  switch (threat.strategy) {
    case 'hit_and_run': await hitAndRunStrategy(mob); break
    case 'shield_rush': await shieldRushStrategy(mob); break
    case 'rush': await rushStrategy(mob); break
    case 'avoid': await avoidStrategy(mob); break
    case 'ranged_dodge': await rangedDodgeStrategy(mob); break
    default: await normalCombatStrategy(mob)
  }
  currentCombatState = CombatState.IDLE
  currentTarget = null
  stopShield()
  return !mob.isValid
}

async function hitAndRunStrategy(mob) {
  let hits = 0
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (evaluateThreat(mob).shouldRetreat || bot.health < HUNT_CONFIG.retreatHealth) { await retreatFromMob(mob); return }
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange + 1) {
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange))
    } else if (hits >= 2) { await attackMob(mob); hits = 0; await retreatShort(mob) }
    else { await attackMob(mob); hits++ }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
}

async function shieldRushStrategy(mob) {
  await equipShield()
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (evaluateThreat(mob).shouldRetreat || bot.health < HUNT_CONFIG.retreatHealth) { await retreatFromMob(mob); return }
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange) {
      await useShield(10)
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange))
    } else {
      await attackMob(mob)
      if (Math.random() < HUNT_CONFIG.blockChance) await useShield(15)
    }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
}

async function rushStrategy(mob) {
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (evaluateThreat(mob).shouldRetreat || bot.health < HUNT_CONFIG.retreatHealth) { await retreatFromMob(mob); return }
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange) {
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange))
    } else { await attackMob(mob) }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
}

async function avoidStrategy(mob) {
  const dir = bot.entity.position.minus(mob.position).normalize()
  const flee = bot.entity.position.plus(dir.scaled(HUNT_CONFIG.fallbackDistance))
  await safeSetGoal(new goals.GoalNear(flee.x, flee.y, flee.z, 3))
  await bot.waitForTicks(40)
}

async function rangedDodgeStrategy(mob) {
  await equipShield()
  let strafe = 1
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (evaluateThreat(mob).shouldRetreat || bot.health < HUNT_CONFIG.retreatHealth) { await retreatFromMob(mob); return }
    const toMob = mob.position.minus(bot.entity.position).normalize()
    const move = bot.entity.position.plus(new Vec3(toMob.z * strafe, 0, -toMob.x * strafe).scaled(2))
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange) {
      await safeSetGoal(new goals.GoalNear(move.x, move.y, move.z, 2))
      strafe *= -1
    } else { await attackMob(mob); await useShield(10) }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
}

async function normalCombatStrategy(mob) {
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (bot.health < HUNT_CONFIG.retreatHealth) { await retreatFromMob(mob); return }
    if (bot.food < HUNT_CONFIG.safeFood) { await eatFood() }
    if (evaluateThreat(mob).shouldRetreat) { await retreatFromMob(mob); return }
    if (mob.position.distanceTo(bot.entity.position) > HUNT_CONFIG.combatRange) {
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange))
    } else {
      if (hasShield() && Math.random() < HUNT_CONFIG.blockChance) await useShield(10)
      await attackMob(mob)
    }
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
}

async function retreatShort(mob) {
  const dir = bot.entity.position.minus(mob.position).normalize()
  const flee = bot.entity.position.plus(dir.scaled(4))
  try { await safeSetGoal(new goals.GoalNear(flee.x, flee.y, flee.z, 2), true) } catch {}
}

async function healIfNeeded() {
  if (bot.health >= HUNT_CONFIG.safeHealth) return
  for (const food of ['golden_apple', 'golden_carrot']) {
    const item = bot.inventory.items().find(i => i.name === food)
    if (item) { await consumeFood(item); return }
  }
  if (bot.food >= 18) {
    let last = bot.health, stuck = 0
    while (bot.health < HUNT_CONFIG.safeHealth && huntingActive) {
      await bot.waitForTicks(20)
      if (bot.health === last) { if (++stuck > 10) { await eatFood(); break } }
      else { stuck = 0; last = bot.health }
    }
  } else { await eatFood() }
}

async function retreatToSafeLocation() {
  if (bedLocation) await safeGoto(bedLocation.x, bedLocation.y, bedLocation.z, 5)
  else if (chestLocation) await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 5)
  else {
    let y = Math.floor(bot.entity.position.y)
    while (y < 256) {
      const above = bot.blockAt(new Vec3(bot.entity.position.x, y + 1, bot.entity.position.z))
      const block = bot.blockAt(new Vec3(bot.entity.position.x, y, bot.entity.position.z))
      if (above?.name === 'air' && block?.name !== 'air') { await safeGoto(bot.entity.position.x, y, bot.entity.position.z, 3); return }
      y++
    }
  }
}

async function patrol() {
  const pos = bot.entity.position, angle = (Date.now() / 1000) % (Math.PI * 2)
  try { await safeSetGoal(new goals.GoalNear(pos.x + Math.cos(angle) * 20, pos.y, pos.z + Math.sin(angle) * 20, 5)) }
  catch { await safeSetGoal(new goals.GoalNear(pos.x + (Math.random() - 0.5) * 20, pos.y, pos.z + (Math.random() - 0.5) * 20, 5)) }
}

async function huntLoop() {
  await equipBestWeapon()
  await equipShield()
  await equipBestArmor()
  while (huntingActive) {
    try {
      const sit = analyzeSituation()
      if (sit.shouldFlee) {
        if (sit.priorityTarget) await retreatFromMob(sit.priorityTarget)
        else await retreatToSafeLocation()
        await bot.waitForTicks(40)
        continue
      }
      if (bot.food < HUNT_CONFIG.safeFood) await eatFood()
      if (bot.health < HUNT_CONFIG.safeHealth) await healIfNeeded()
      let target = sit.priorityTarget || getNearestHostile(HUNT_CONFIG.awarenessRadius)
      if (target && evaluateThreat(target).shouldEngage) {
        if (await fightMob(target)) await pickupNearbyItems()
      } else if (!target && sit.safe) await patrol()
      await bot.waitForTicks(5)
    } catch (err) { console.error('Hunt error:', err); await bot.waitForTicks(20) }
  }
}

// =====================
//   DORMIR
// =====================
async function sleepInBed() {
  if (!bedLocation) return
  await safeGoto(bedLocation.x, bedLocation.y, bedLocation.z, 2)
  const bed = bot.blockAt(new Vec3(bedLocation.x, bedLocation.y, bedLocation.z))
  if (!bed?.name.includes('bed')) return
  await bot.sleep(bed)
  bot.once('wake', () => bot.chat('Buenos días! ☀️'))
}

// =====================
//   SEGUIR JUGADOR
// =====================
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  followInterval = setInterval(() => {
    if (!followingPlayer) { clearInterval(followInterval); return }
    if (miningActive || huntingActive || pathfindingLock) return
    const target = bot.players[username]?.entity
    if (target) safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true)
  }, 1000)
}

// =====================
//   EVENTOS DEL BOT
// =====================
bot.on('spawn', () => {
  console.log('✅ Bot conectado')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  loadState()
  startDodgeSystem()
  setInterval(() => { if (!miningActive && !huntingActive && !followingPlayer && !depositState.active) pickupNearbyItems() }, 30000)
  setInterval(checkInventoryAndDeposit, 10000)
  setTimeout(() => {
    const target = bot.players[MASTER]?.entity
    if (target) bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1))
    else bot.chat('No te veo')
  }, 2000)
})

bot.on('health', async () => {
  if (bot.health <= 4) bot.chat(`⚠️ Poca vida: ${Math.round(bot.health)}/20`)
  if (bot.food <= 14 && !isEating) {
    isEating = true
    try { await eatFood() }
    catch (err) { console.error('eatFood error:', err) }
    finally { isEating = false }
  }
})

function checkInventoryAndDeposit() {
  if (depositState.active || huntingActive || followingPlayer) return
  const used = (36 - bot.inventory.emptySlotCount()) / 36 * 100
  const wood = bot.inventory.items().filter(i => WOOD_BLOCKS.has(i.name)).reduce((s, i) => s + i.count, 0)
  if ((used > 50 && bot.inventory.emptySlotCount() < 12) || wood > 64) {
    const wasMining = miningActive
    if (wasMining) miningActive = false
    depositInChest().then(() => { if (wasMining && miningTarget && !huntingActive && !followingPlayer) { miningActive = true; shaftMiningLoop() } })
  }
}

// =====================
//   COMANDOS DE CHAT
// =====================
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  console.log(`[Chat] ${username}: ${message}`)
  if (username !== MASTER) { bot.chat(`Solo obedezco a ${MASTER}.`); return }

  // ===== AYUDA =====
  if (message === 'aiuda') {
    bot.chat('--DATA-- dondetas | status | data | equipment | debug')
    bot.chat('--SETUP-- chest x y z | table x y z | mine x y z | farm x y z | bed x y z')
    bot.chat('--MOVE-- showAt x y z | follow [player] | stop follow')
    bot.chat('--MINE-- bring <block> | cerca <block> [y] | stop')
    bot.chat('--FARM-- harvest | bake | harvest and bake')
    bot.chat('--OTHER-- eat | armor | grab <item> | equip <item> | drop all | drop <item> | hold <item> | hunt | stop hunt | sleep')
    bot.chat('--EXPLORE-- explore | stop explore | wood')
    bot.chat('--DODGE-- dodge on | dodge off | dodge config | hunt config')
    return
  }

  // ===== EVASIÓN =====
  if (message === 'dodge on') { DODGE_CONFIG.enabled = true; startDodgeSystem(); bot.chat('✅ Evasión activada'); return }
  if (message === 'dodge off') { DODGE_CONFIG.enabled = false; stopDodgeSystem(); bot.chat('⚠️ Evasión desactivada'); return }
  if (message === 'dodge config') { bot.chat(`Evasión: ${DODGE_CONFIG.enabled ? 'ON' : 'OFF'} | Radio: ${DODGE_CONFIG.detectionRadius}m | Distancia: ${DODGE_CONFIG.safeDistance}m`); return }

  // ===== INFO =====
  if (message === 'debug') { bot.chat(`isEating:${isEating} | food:${bot.food} | health:${bot.health} | isDodging:${isDodging}`); return }
  if (message === 'dondetas') { const p = bot.entity.position; bot.chat(`X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`); return }
  if (message === 'status') { bot.chat(`Vida:${Math.round(bot.health)}/20 | Hambre:${Math.round(bot.food)}/20`); return }
  if (message === 'data') { const f = l => l ? `X:${l.x} Y:${l.y} Z:${l.z}` : 'no'; bot.chat(`Cofre:${f(chestLocation)} | Mesa:${f(craftingTableLocation)} | Mina:${f(mineLocation)} | Granja:${f(farmLocation)} | Cama:${f(bedLocation)}`); return }
  if (message === 'equipment') { reportPickaxes(); return }
  if (message === 'checkarmor') { bot.chat(`Head:${bot.inventory.slots[5]?.name || 'vacío'} | Chest:${bot.inventory.slots[6]?.name || 'vacío'} | Legs:${bot.inventory.slots[7]?.name || 'vacío'} | Feet:${bot.inventory.slots[8]?.name || 'vacío'}`); return }

  // ===== SETUP =====
  if (message.startsWith('chest ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; chestLocation = { x, y, z }; saveState(); bot.chat(`Cofre: ${x} ${y} ${z}`); return }
  if (message.startsWith('table ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; craftingTableLocation = { x, y, z }; saveState(); bot.chat(`Mesa: ${x} ${y} ${z}`); return }
  if (message.startsWith('mine ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; mineLocation = { x, y, z }; currentMineY = null; saveState(); bot.chat(`Mina: ${x} ${y} ${z}`); return }
  if (message.startsWith('bed ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; bedLocation = { x, y, z }; saveState(); bot.chat(`Cama: ${x} ${y} ${z}`); return }
  if (message.startsWith('farm ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; farmLocation = { x, y, z }; saveState(); bot.chat(`Granja: ${x} ${y} ${z}`); return }

  // ===== MOVIMIENTO =====
  if (message.startsWith('showAt ')) { const [x,y,z] = message.split(' ').slice(1).map(Number); if ([x,y,z].some(isNaN)) return; bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2)); return }
  if (message === 'follow' || message.startsWith('follow ')) {
    const target = message === 'follow' ? username : message.split(' ')[1]
    if (!bot.players[target]) { bot.chat(`No veo a ${target}`); return }
    followingPlayer = true; miningActive = false; huntingActive = false; explorationActive = false
    if (followInterval) clearInterval(followInterval)
    startFollowing(target)
    return
  }
  if (message === 'stop follow') { followingPlayer = false; if (followInterval) clearInterval(followInterval); bot.pathfinder.setGoal(null); return }
  if (message === 'stop') { miningActive = false; huntingActive = false; followingPlayer = false; explorationActive = false; woodcuttingActive = false; depositState.active = false; if (followInterval) clearInterval(followInterval); bot.pathfinder.setGoal(null); pathfindingLock = false; return }
  if (message === 'sleep') { miningActive = false; huntingActive = false; followingPlayer = false; explorationActive = false; if (followInterval) clearInterval(followInterval); bot.pathfinder.setGoal(null); await sleepInBed(); return }

  // ===== MINERÍA =====
  if (message === 'drop all') {
    if (!bot.inventory.items().length) return
    if (chestLocation) { depositState.lastInventoryHash = null; await depositInChest() }
    else { for (const i of bot.inventory.items()) await bot.toss(i.type, null, i.count) }
    return
  }
  if (message.startsWith('drop ') && message !== 'drop all') {
    const item = bot.inventory.items().find(i => i.name === message.split(' ').slice(1).join(' '))
    if (item) await bot.toss(item.type, null, item.count)
    return
  }
  if (message.startsWith('bring ')) {
    if (!chestLocation || !craftingTableLocation || !mineLocation) { bot.chat('Faltan registros'); return }
    const block = message.split(' ')[1]
    if (!mcData.blocksByName[block]) return
    if (!await ensurePickaxe(block)) { bot.chat('No tengo pico'); return }
    miningTarget = block; miningActive = true
    shaftMiningLoop()
    return
  }
  if (message.startsWith('cerca ')) {
    const parts = message.split(' ')
    const block = parts[1], tol = parseInt(parts[2]) || 10
    if (!mcData.blocksByName[block]) return
    if (!await ensurePickaxe(block)) { bot.chat('No tengo pico'); return }
    miningTarget = block; miningActive = true
    nearbyMiningLoop(tol)
    return
  }

  // ===== GRANJA =====
  if (message === 'harvest') { await harvestWheat(); return }
  if (message === 'bake') { await makeBread(); return }
  if (message === 'harvest and bake') { await harvestWheat(); await makeBread(); return }

  // ===== ACCIONES =====
  if (message === 'eat') { await eatFood(); return }
  if (message === 'armor') { await equipBestArmor(); return }
  if (message.startsWith('hold ')) {
    const item = bot.inventory.items().find(i => i.name === message.split(' ').slice(1).join(' '))
    if (item) await bot.equip(item, 'hand')
    return
  }
  if (message.startsWith('grab ')) {
    if (!chestLocation) return
    const item = message.split(' ').slice(1).join(' ')
    if (await getItemFromChest(item, 1)) bot.chat(`✅ Saqué ${item}`)
    return
  }
  if (message.startsWith('equip ')) {
    const item = bot.inventory.items().find(i => i.name === message.split(' ').slice(1).join(' '))
    if (item) await equipItem(item)
    return
  }

  // ===== CAZA =====
  if (message === 'hunt') {
    huntingActive = true; miningActive = false; followingPlayer = false; explorationActive = false
    if (followInterval) clearInterval(followInterval)
    huntLoop()
    return
  }
  if (message === 'stop hunt') { huntingActive = false; bot.pathfinder.setGoal(null); return }
  if (message === 'hunt config') { bot.chat(`Salud:${HUNT_CONFIG.safeHealth} | Retirada:${HUNT_CONFIG.retreatHealth} | Escudo:${Math.round(HUNT_CONFIG.blockChance*100)}%`); return }

  // ===== EXPLORACIÓN =====
  if (message === 'explore') {
    if (miningActive || huntingActive || followingPlayer) {
      miningActive = false; huntingActive = false; followingPlayer = false
      if (followInterval) clearInterval(followInterval)
    }
    explorationActive = true; woodcuttingActive = false
    exploreChunks()
    return
  }
  if (message === 'stop explore') { explorationActive = false; woodcuttingActive = false; bot.pathfinder.setGoal(null); return }
  if (message === 'wood') {
    if (!explorationActive) { bot.chat('Primero "explore"'); return }
    const tree = findCompleteTree()
    if (tree) await cutTree(tree)
    else bot.chat('No hay árboles cerca')
    return
  }
})

function reportPickaxes() {
  const picks = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
    .map(n => ({ n, c: bot.inventory.items().filter(i => i.name === n).reduce((s,i) => s+i.count,0) }))
    .filter(p => p.c > 0)
  bot.chat(picks.length ? `Picos: ${picks.map(p => `${p.n}:${p.c}`).join(' | ')}` : 'No tengo picos')
}

bot.on('error', err => console.error('❌ Error:', err))
bot.on('end', () => { console.log('🔌 Bot desconectado'); stopDodgeSystem() })