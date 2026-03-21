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
//   ESTADO GLOBAL
// =====================
let chestLocation         = null
let craftingTableLocation = null
let mineLocation          = null
let farmLocation          = null
let miningActive          = false
let miningTarget          = null
let followingPlayer       = false
let followInterval        = null
let huntingActive         = false

// =====================
//   PERSISTENCIA
// =====================
const STATE_FILE = './state.json'

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    chestLocation         = data.chestLocation         ?? null
    craftingTableLocation = data.craftingTableLocation ?? null
    mineLocation          = data.mineLocation          ?? null
    farmLocation          = data.farmLocation          ?? null
    console.log('📂 Estado cargado:', data)
  } catch {
    console.log('📂 Sin estado previo, arrancando limpio.')
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, mineLocation, farmLocation }
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
}

// =====================
//   CONSTANTES
// =====================
const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'piglin_brute', 'hoglin', 'wither_skeleton',
  'enderman', 'silverfish', 'phantom', 'drowned', 'husk',
  'stray', 'bogged', 'breeze'
]

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

const OPTIMAL_Y = {
  'coal_ore':               96,
  'deepslate_coal_ore':     0,
  'iron_ore':               16,
  'deepslate_iron_ore':     -16,
  'gold_ore':               -16,
  'deepslate_gold_ore':     -16,
  'lapis_ore':              0,
  'deepslate_lapis_ore':    -32,
  'diamond_ore':            -58,
  'deepslate_diamond_ore':  -58,
  'redstone_ore':           -58,
  'deepslate_redstone_ore': -58,
  'emerald_ore':            -16,
  'ancient_debris':         15,
  'obsidian':               -40,
}

const FOOD_PRIORITY = [
  'golden_carrot',
  'cooked_porkchop', 'cooked_beef', 'cooked_mutton',
  'cooked_salmon',   'cooked_chicken', 'cooked_cod',
  'bread',           // ← subido, se prefiere sobre cosas crudas
  'baked_potato',    'carrot', 'apple', 'melon_slice', 'cookie',
  'raw_beef',        'raw_porkchop', 'raw_mutton',
  'raw_chicken',     'raw_salmon',   'raw_cod',
  'rotten_flesh',
]

const SWORD_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword',     'golden_sword',  'wooden_sword'
]

// =====================
//   SPAWN
// =====================
bot.on('spawn', () => {
  console.log('✅ Bot conectado')
  const movements = new Movements(bot)
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  loadState()
  bot.chat('Listo. Voy hacia vos...')

  setTimeout(() => {
    const target = bot.players[MASTER]?.entity
    if (!target) { bot.chat('No te veo, quedate quieto un momento.'); return }
    bot.pathfinder.setGoal(new goals.GoalNear(
      target.position.x, target.position.y, target.position.z, 1
    ))
  }, 2000)
})

// =====================
//   HEALTH
// =====================
bot.on('health', async () => {
  if (bot.health <= 4) {
    bot.chat(`⚠️ Poca vida: ${Math.round(bot.health)}/20.`)
  }
  if (bot.food <= 5) {
    bot.chat(`⚠️ Tengo hambre: ${Math.round(bot.food)}/20. Comiendo...`)
    await eatFood()
  }
})

// =====================
//   CHAT
// =====================
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  console.log(`[Chat] ${username}: ${message}`)
  if (username !== MASTER) { bot.chat(`Solo obedezco a ${MASTER}.`); return }

  // AYUDA
  if (message === 'aiuda') {
    bot.chat('--DATA-- where are you | status | equipment')
    bot.chat('--SETUP-- chest x y z | table x y z | mine x y z | farm x y z')
    bot.chat('--MOVE-- showAt x y z | follow | stop follow')
    bot.chat('--MINE-- bring <block> | cerca <block> [y] | stop')
    bot.chat('--FARM-- harvest | bake | harvest and bake')
    bot.chat('--OTHER-- eat | hold <item> | hunt | stop hunt')
    return
  }

  // INFO
  if (message === 'where are you') {
    const p = bot.entity.position
    bot.chat(`X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
    return
  }

  if (message === 'status') {
    const health = Math.round(bot.health)
    const food   = Math.round(bot.food)
    bot.chat(`Vida: ${health}/20 ${'❤️'.repeat(Math.ceil(health / 2))}`)
    bot.chat(`Hambre: ${food}/20 ${'🍖'.repeat(Math.ceil(food / 2))}`)
    return
  }

  if (message === 'equipment') { reportPickaxes(); return }

  // SETUP
  if (message.startsWith('chest ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: chest x y z'); return }
    chestLocation = { x, y, z }; saveState()
    bot.chat(`Cofre: X:${x} Y:${y} Z:${z}`)
    return
  }

  if (message.startsWith('table ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: table x y z'); return }
    craftingTableLocation = { x, y, z }; saveState()
    bot.chat(`Mesa: X:${x} Y:${y} Z:${z}`)
    return
  }

  if (message.startsWith('mine ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: mine x y z'); return }
    mineLocation = { x, y, z }; saveState()
    bot.chat(`Mina: X:${x} Y:${y} Z:${z}`)
    return
  }

  if (message.startsWith('farm ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: farm x y z'); return }
    farmLocation = { x, y, z }; saveState()
    bot.chat(`Granja: X:${x} Y:${y} Z:${z}`)
    return
  }

  // MOVIMIENTO
  if (message.startsWith('showAt ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: showAt x y z'); return }
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
    bot.chat('Me quedo acá.')
    return
  }

  if (message === 'stop') {
    miningActive    = false
    huntingActive   = false
    followingPlayer = false
    if (followInterval) clearInterval(followInterval)
    bot.pathfinder.setGoal(null)
    bot.chat('Parando.')
    return
  }

  // MINERÍA
  if (message.startsWith('bring ')) {
    if (!chestLocation)         { bot.chat('Registrá el cofre (chest x y z).'); return }
    if (!craftingTableLocation) { bot.chat('Registrá la mesa (table x y z).'); return }
    if (!mineLocation)          { bot.chat('Registrá la mina (mine x y z).'); return }
    const blockName = message.split(' ')[1]
    if (!mcData.blocksByName[blockName]) { bot.chat(`No conozco "${blockName}".`); return }
    const ok = await ensurePickaxe(blockName)
    if (!ok) { bot.chat('No tengo pico.'); return }
    miningTarget = blockName
    miningActive = true
    bot.chat(`Buscando ${blockName} sistemáticamente.`)
    chunkMiningLoop()
    return
  }

  if (message.startsWith('cerca ')) {
    const parts     = message.split(' ')
    const blockName = parts[1]
    const tolerance = parseInt(parts[2]) ?? 10
    if (!mcData.blocksByName[blockName]) { bot.chat(`No conozco "${blockName}".`); return }
    const ok = await ensurePickaxe(blockName)
    if (!ok) { bot.chat('No tengo pico.'); return }
    miningTarget = blockName
    miningActive = true
    bot.chat(`Buscando ${blockName} a ±${tolerance} bloques de Y.`)
    nearbyMiningLoop(tolerance)
    return
  }

  // GRANJA
  if (message === 'harvest')          { await harvestWheat(); return }
  if (message === 'bake')             { await makeBread(); return }
  if (message === 'harvest and bake') { await harvestWheat(); await makeBread(); return }

  // ACCIONES
  if (message === 'eat') { await eatFood(); return }

  if (message.startsWith('hold ')) {
    const itemName = message.split(' ').slice(1).join(' ')
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) { bot.chat(`No tengo ${itemName}.`); return }
    try { await bot.equip(item, 'hand'); bot.chat(`Sosteniendo ${itemName}.`) }
    catch (err) { bot.chat(`No pude equipar: ${err.message}`) }
    return
  }

  if (message === 'hunt') {
    huntingActive   = true
    miningActive    = false
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
})

// =====================
//   MINERÍA: CERCA
// =====================
async function nearbyMiningLoop(yTolerance = 10) {
  const baseY = Math.floor(bot.entity.position.y)
  while (miningActive) {
    if (bot.inventory.emptySlotCount() < 4) {
      await depositInChest(); if (!miningActive) break
    }
    const block = bot.findBlock({
      matching: (b) => b.name === miningTarget && Math.abs(b.position.y - baseY) <= yTolerance,
      maxDistance: 32
    })
    if (!block) {
      bot.chat(`No encuentro ${miningTarget} a ±${yTolerance} de Y:${baseY}.`)
      miningActive = false; await depositInChest(); break
    }
    if (hasLavaNearby(block.position)) { await bot.waitForTicks(10); continue }
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        block.position.x, block.position.y, block.position.z, 1
      ))
      await bot.dig(block)
    } catch { await bot.waitForTicks(5) }
  }
}

// =====================
//   MINERÍA: CHUNKS
// =====================
async function chunkMiningLoop() {
  const optimalY    = OPTIMAL_Y[miningTarget] ?? -16
  const originChunk = worldToChunk(mineLocation.x, mineLocation.z)
  const offsets     = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]

  for (const [dx, dz] of offsets) {
    if (!miningActive) break
    const chunkX = originChunk.x + dx
    const chunkZ = originChunk.z + dz
    const cx     = chunkX * 16 + 8
    const cz     = chunkZ * 16 + 8
    bot.chat(`Minando chunk [${chunkX}, ${chunkZ}]...`)
    try {
      await bot.pathfinder.goto(new goals.GoalNear(cx, optimalY, cz, 4))
    } catch { bot.chat('No pude llegar, saltando.'); continue }
    await mineChunkSystematically(chunkX, chunkZ, optimalY)
    if (bot.inventory.emptySlotCount() < 6) {
      await depositInChest(); if (!miningActive) break
      try { await bot.pathfinder.goto(new goals.GoalNear(cx, optimalY, cz, 4)) } catch {}
    }
  }

  if (miningActive) {
    bot.chat(`Terminé los 9 chunks. No encontré más ${miningTarget}.`)
    miningActive = false
    await depositInChest()
  }
}

// =====================
//   MINERÍA: SERPENTINA
// =====================
async function mineChunkSystematically(chunkX, chunkZ, targetY) {
  const startX = chunkX * 16
  const startZ = chunkZ * 16
  let found    = false

  for (let dz = 0; dz < 16; dz++) {
    if (!miningActive) break
    const zPos = startZ + dz
    const xRange = Array.from({ length: 16 }, (_, i) => startX + i)
    const xRow   = dz % 2 === 0 ? xRange : [...xRange].reverse()

    for (const xPos of xRow) {
      if (!miningActive) break
      if (bot.inventory.emptySlotCount() < 4) {
        await depositInChest(); if (!miningActive) return found
        try { await bot.pathfinder.goto(new goals.GoalNear(xPos, targetY, zPos, 2)) } catch {}
      }
      try { await bot.pathfinder.goto(new goals.GoalNear(xPos, targetY, zPos, 1)) }
      catch { continue }

      for (let dy = -2; dy <= 2; dy++) {
        const block = bot.blockAt(new Vec3(xPos, targetY + dy, zPos))
        if (!block) continue
        if (block.name === miningTarget) {
          if (hasLavaNearby(block.position)) continue
          try { await bot.dig(block); found = true } catch {}
        }
        if (['stone','deepslate','tuff','andesite','diorite','granite','gravel','dirt']
            .includes(block.name)) {
          try { await bot.dig(block) } catch {}
        }
      }
    }
  }
  return found
}

// =====================
//   COFRE
// =====================
async function getItemFromChest(itemName, count) {
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      chestLocation.x, chestLocation.y, chestLocation.z, 2
    ))
    const chest = await bot.openChest(
      bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    )
    const item = chest.containerItems().find(i => i.name === itemName)
    if (!item) { chest.close(); return false }
    await chest.withdraw(item.type, null, Math.min(item.count, count))
    chest.close(); return true
  } catch { return false }
}

async function depositInChest() {
  bot.chat('Yendo al cofre...')
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      chestLocation.x, chestLocation.y, chestLocation.z, 2
    ))
    const chest = await bot.openChest(
      bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    )
    for (const item of bot.inventory.items()) {
      if (item.name.includes('pickaxe') || item.name.includes('sword')) continue
      try { await chest.deposit(item.type, null, item.count) } catch {}
    }
    chest.close(); bot.chat('Depositado.')
  } catch (err) { bot.chat(`No pude depositar: ${err.message}`) }
}

// =====================
//   PICOS
// =====================
async function ensurePickaxe(blockName) {
  const needed = PICKAXE_FOR_BLOCK[blockName] ?? 'wooden_pickaxe'
  if (bot.inventory.items().some(i => i.name === needed)) { await equipPickaxe(needed); return true }
  bot.chat(`Necesito ${needed}. Buscando en cofre...`)
  if (await getItemFromChest(needed, 1)) { await equipPickaxe(needed); return true }
  bot.chat(`No hay. Intentando craftear...`)
  if (await craftPickaxe(needed)) { await equipPickaxe(needed); return true }
  return false
}

async function equipPickaxe(name) {
  const item = bot.inventory.items().find(i => i.name === name)
  if (item) await bot.equip(item, 'hand')
}

async function craftPickaxe(pickaxeName) {
  const material = PICKAXE_MATERIAL[pickaxeName]
  if (!material) return false
  const count = (name) =>
    bot.inventory.items().filter(i => i.name === name).reduce((s,i) => s+i.count, 0)
  if (count(material) < 3) await getItemFromChest(material, 3 - count(material))
  if (count('stick')  < 2) await getItemFromChest('stick',  2 - count('stick'))
  if (count(material) < 3 || count('stick') < 2) { bot.chat('Faltan materiales.'); return false }
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2
    ))
    const tableBlock = bot.blockAt(new Vec3(
      craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z
    ))
    const recipes = bot.recipesFor(mcData.itemsByName[pickaxeName].id, null, 1, tableBlock)
    if (!recipes.length) { bot.chat('No encontré receta.'); return false }
    await bot.craft(recipes[0], 1, tableBlock)
    bot.chat(`${pickaxeName} crafteado!`); return true
  } catch (err) { bot.chat(`Error: ${err.message}`); return false }
}

function reportPickaxes() {
  const found = ['wooden_pickaxe','stone_pickaxe','iron_pickaxe',
                  'golden_pickaxe','diamond_pickaxe','netherite_pickaxe']
    .map(name => ({
      name,
      count: bot.inventory.items().filter(i=>i.name===name).reduce((s,i)=>s+i.count,0)
    }))
    .filter(p => p.count > 0)
  if (!found.length) { bot.chat('No tengo ningún pico.'); return }
  bot.chat('Picos: ' + found.map(p=>`${p.name}:${p.count}`).join(' | '))
}

// =====================
//   GRANJA
// =====================
async function harvestWheat() {
  if (!farmLocation) { bot.chat('Registrá la granja con "farm x y z".'); return }

  const seeds = bot.inventory.items()
    .filter(i => i.name === 'wheat_seeds').reduce((s,i)=>s+i.count,0)
  if (seeds === 0 && chestLocation) {
    bot.chat('Sin semillas, buscando en cofre...')
    await getItemFromChest('wheat_seeds', 16)
  }

  bot.chat('Yendo a la granja...')
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      farmLocation.x, farmLocation.y, farmLocation.z, 4
    ))
  } catch { bot.chat('No pude llegar a la granja.'); return }

  let harvested = 0
  while (true) {
    const wheat = bot.findBlock({
      matching: (b) => b.name === 'wheat' && b.getProperties().age === 7,
      maxDistance: 32
    })
    if (!wheat) { bot.chat(`Cosecha terminada. ${harvested} plantas.`); break }
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        wheat.position.x, wheat.position.y, wheat.position.z, 1
      ))
      await bot.dig(wheat)
      harvested++
      const seed = bot.inventory.items().find(i => i.name === 'wheat_seeds')
      if (seed) {
        const farmland = bot.blockAt(wheat.position.offset(0, -1, 0))
        if (farmland?.name === 'farmland') {
          try { await bot.equip(seed, 'hand'); await bot.placeBlock(farmland, new Vec3(0,1,0)) }
          catch {}
        }
      }
    } catch { await bot.waitForTicks(5) }
  }
}

async function makeBread() {
  const wheatCount = bot.inventory.items()
    .filter(i => i.name === 'wheat').reduce((s,i)=>s+i.count,0)
  if (wheatCount < 3) { bot.chat(`Tengo ${wheatCount} trigo. Necesito 3.`); return }
  const qty = Math.floor(wheatCount / 3)
  try {
    const recipes = bot.recipesFor(mcData.itemsByName['bread'].id, null, 1, null)
    if (!recipes.length) { bot.chat('No encontré receta para pan.'); return }
    await bot.craft(recipes[0], qty, null)
    bot.chat(`Hice ${qty} panes. 🍞`)
  } catch (err) { bot.chat(`No pude hacer pan: ${err.message}`) }
}

// =====================
//   COMIDA
// =====================
function findFoodInInventory() {
  for (const name of FOOD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) return item
  }
  return null
}

async function consumeFood(foodItem) {
  try {
    await bot.equip(foodItem, 'hand')
    await bot.consume()
    bot.chat(`Comí ${foodItem.name}. Hambre: ${Math.round(bot.food)}/20`)
  } catch (err) { bot.chat(`No pude comer: ${err.message}`) }
}

async function eatFood() {
  if (bot.food >= 20) { bot.chat('No tengo hambre.'); return }

  // 1. Inventario
  let food = findFoodInInventory()
  if (food) { await consumeFood(food); return }

  // 2. Cofre
  if (chestLocation) {
    bot.chat('Sin comida. Buscando en cofre...')
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        chestLocation.x, chestLocation.y, chestLocation.z, 2
      ))
      const chest = await bot.openChest(
        bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
      )
      let found = false
      for (const name of FOOD_PRIORITY) {
        const item = chest.containerItems().find(i => i.name === name)
        if (item) {
          await chest.withdraw(item.type, null, Math.min(item.count, 16))
          bot.chat(`Saqué ${name} del cofre.`); found = true; break
        }
      }
      chest.close()
      if (found) { food = findFoodInInventory(); if (food) { await consumeFood(food); return } }
    } catch {}
  }

  // 3. Pan con trigo en inventario
  const wheat = bot.inventory.items().filter(i=>i.name==='wheat').reduce((s,i)=>s+i.count,0)
  if (wheat >= 3) {
    bot.chat('Tengo trigo. Haciendo pan...')
    await makeBread()
    food = findFoodInInventory()
    if (food) { await consumeFood(food); return }
  }

  // 4. Cosechar y hornear
  if (farmLocation) {
    bot.chat('Voy a cosechar y hacer pan...')
    await harvestWheat()
    await makeBread()
    food = findFoodInInventory()
    if (food) { await consumeFood(food); return }
  }

  bot.chat('No encontré comida en ningún lado.')
}

// =====================
//   SEGUIR
// =====================
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  followInterval = setInterval(() => {
    if (!followingPlayer) { clearInterval(followInterval); return }
    const target = bot.players[username]?.entity
    if (!target) return
    bot.pathfinder.setGoal(new goals.GoalNear(
      target.position.x, target.position.y, target.position.z, 3
    ), true)
  }, 500)
}

// =====================
//   CAZA
// =====================
async function huntLoop() {
  const sword = await equipBestSword()
  if (!sword) { bot.chat('Sin espada. Abortando.'); huntingActive = false; return }
  bot.chat(`Cazando con ${sword}.`)
  while (huntingActive) {
    if (bot.health <= 8) { bot.chat('Vida baja...'); await eatFood(); await bot.waitForTicks(40); continue }
    if (bot.food   <= 8) await eatFood()
    const mob = getNearestHostile(24)
    if (!mob) { await patrol(); continue }
    await fightMob(mob)
  }
}

async function equipBestSword() {
  for (const name of SWORD_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name)
    if (item) { await bot.equip(item, 'hand'); return name }
  }
  if (chestLocation) {
    for (const name of SWORD_PRIORITY) {
      if (await getItemFromChest(name, 1)) {
        const item = bot.inventory.items().find(i => i.name === name)
        if (item) { await bot.equip(item, 'hand'); return name }
      }
    }
  }
  return null
}

function getNearestHostile(maxDistance) {
  return Object.values(bot.entities)
    .filter(e =>
      e.type === 'mob' &&
      HOSTILE_MOBS.includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < maxDistance
    )
    .sort((a,b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    )[0] ?? null
}

async function fightMob(mob) {
  bot.chat(`Atacando ${mob.name}.`)
  while (huntingActive && mob.isValid && bot.health > 4) {
    try { await bot.pathfinder.goto(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2)) }
    catch { break }
    try { await bot.attack(mob) } catch { break }
    await bot.waitForTicks(12)
    if (bot.food <= 6) await eatFood()
  }
  if (!mob.isValid)       bot.chat(`${mob.name} eliminado.`)
  else if (bot.health <= 4) { bot.chat('Vida crítica, me retiro!'); bot.pathfinder.setGoal(null) }
}

async function patrol() {
  const pos = bot.entity.position
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      pos.x + (Math.random()-0.5)*32,
      pos.y,
      pos.z + (Math.random()-0.5)*32,
      2
    ))
  } catch { await bot.waitForTicks(10) }
}

// =====================
//   HELPERS
// =====================
function worldToChunk(x, z) {
  return { x: Math.floor(x/16), z: Math.floor(z/16) }
}

function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    return b && (b.name === 'lava' || b.name === 'flowing_lava')
  })
}

bot.on('error', err => console.error('❌ Error:', err))
bot.on('end',   ()  => console.log('🔌 Bot desconectado'))