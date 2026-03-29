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
let bedLocation           = null
let miningActive          = false
let miningTarget          = null
let followingPlayer       = false
let followInterval        = null
let huntingActive         = false
let isEating              = false
let pendingPickaxe        = null
let currentMineY          = null

// =====================
//   DEPOSIT STATE
// =====================
const depositState = {
  active:            false,
  lastRun:           0,
  lastInventoryHash: null,
  cooldown:          5000,
}

function getInventoryHash() {
  return bot.inventory.items()
    .filter(i =>
      !i.name.includes('pickaxe') &&
      !i.name.includes('sword')   &&
      !Object.values(ARMOR_PRIORITY).flat().includes(i.name) &&
      !FOOD_PRIORITY.includes(i.name)
    )
    .map(i => `${i.name}:${i.count}`)
    .sort()
    .join('|')
}

// =====================
//   PATHFINDING LOCK
// =====================
let pathfindingLock = false
let pendingGoal     = null

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
    console.error('Error setting goal:', err)
    return false
  } finally {
    setTimeout(() => {
      pathfindingLock = false
      if (pendingGoal) {
        const { goal, priority } = pendingGoal
        pendingGoal = null
        safeSetGoal(goal, priority)
      }
    }, 500)
  }
}

async function safeGoto(x, y, z, range = 2) {
  if (pathfindingLock) {
    await new Promise(resolve => {
      const checkLock = setInterval(() => {
        if (!pathfindingLock) { clearInterval(checkLock); resolve() }
      }, 100)
    })
  }

  setSprintMode(false)

  const dodgeInterval = setInterval(async () => {
    const mob = getNearestHostile(6)
    if (!mob) return
    const pos   = bot.entity.position
    const dx    = pos.x - mob.position.x
    const dz    = pos.z - mob.position.z
    const len   = Math.sqrt(dx * dx + dz * dz) || 1
    const fleeX = pos.x + (dx / len) * 8
    const fleeZ = pos.z + (dz / len) * 8
    bot.chat(`⚠️ ${mob.name} cerca, esquivando...`)
    try { await safeSetGoal(new goals.GoalNear(fleeX, pos.y, fleeZ, 2), true) } catch {}
  }, 600)

  try {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range))
  } catch (err) {
    if (err.message !== 'GoalChanged: The goal was changed before it could be completed!') throw err
  } finally {
    clearInterval(dodgeInterval)
    setSprintMode(true)
    pathfindingLock = false
  }
}

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
    bedLocation           = data.bedLocation           ?? null
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
  'deepslate_iron_ore':     'iron_pickaxe',
  'lapis_ore':              'iron_pickaxe',
  'deepslate_lapis_ore':    'iron_pickaxe',
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

const PICKAXE_TIER = {
  'wooden_pickaxe':    1,
  'stone_pickaxe':     2,
  'golden_pickaxe':    2,
  'iron_pickaxe':      3,
  'diamond_pickaxe':   4,
  'netherite_pickaxe': 5,
}

const VALUABLE_TIER = 4

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

const MINE_RADIUS = 16

const PROTECTED_BLOCKS = new Set([
  'oak_stairs',        'spruce_stairs',      'birch_stairs',
  'jungle_stairs',     'acacia_stairs',      'dark_oak_stairs',
  'mangrove_stairs',   'cherry_stairs',      'bamboo_stairs',
  'stone_stairs',      'cobblestone_stairs', 'stone_brick_stairs',
  'sandstone_stairs',  'granite_stairs',     'diorite_stairs',
  'andesite_stairs',   'brick_stairs',       'nether_brick_stairs',
  'quartz_stairs',     'red_sandstone_stairs','purpur_stairs',
  'prismarine_stairs', 'prismarine_brick_stairs','dark_prismarine_stairs',
  'polished_granite_stairs','polished_diorite_stairs',
  'polished_andesite_stairs','mossy_cobblestone_stairs',
  'mossy_stone_brick_stairs','smooth_sandstone_stairs',
  'smooth_quartz_stairs','end_stone_brick_stairs',
  'blackstone_stairs', 'polished_blackstone_stairs',
  'polished_blackstone_brick_stairs','cut_copper_stairs',
  'exposed_cut_copper_stairs','weathered_cut_copper_stairs',
  'oxidized_cut_copper_stairs','waxed_cut_copper_stairs',
  'oak_slab',   'spruce_slab', 'cobblestone_slab', 'stone_slab',
  'ladder',     'scaffolding',
])

const FOOD_PRIORITY = [
  'golden_carrot',
  'cooked_porkchop', 'cooked_beef',    'cooked_mutton',
  'cooked_salmon',   'cooked_chicken', 'cooked_cod',
  'bread',
  'baked_potato',    'carrot', 'apple', 'melon_slice', 'cookie',
  'raw_beef',        'raw_porkchop',   'raw_mutton',
  'raw_chicken',     'raw_salmon',     'raw_cod',
  'rotten_flesh',
]

const SWORD_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'stone_sword',     'golden_sword',  'wooden_sword'
]

const ARMOR_PRIORITY = {
  head:  ['netherite_helmet',      'diamond_helmet',      'iron_helmet',
          'golden_helmet',         'chainmail_helmet',    'leather_helmet'],
  chest: ['netherite_chestplate',  'diamond_chestplate',  'iron_chestplate',
          'golden_chestplate',     'chainmail_chestplate','leather_chestplate'],
  legs:  ['netherite_leggings',    'diamond_leggings',    'iron_leggings',
          'golden_leggings',       'chainmail_leggings',  'leather_leggings'],
  feet:  ['netherite_boots',       'diamond_boots',       'iron_boots',
          'golden_boots',          'chainmail_boots',     'leather_boots'],
}

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

  setInterval(async () => {
    if (!miningActive && !huntingActive && !followingPlayer && !depositState.active) {
      await pickupNearbyItems()
    }
  }, 30000)

  setTimeout(() => {
    const target = bot.players[MASTER]?.entity
    if (!target) { bot.chat('No te veo, quedate quieto un momento.'); return }
    bot.pathfinder.setGoal(new goals.GoalNear(
      target.position.x, target.position.y, target.position.z, 1
    ))
  }, 2000)

  setInterval(checkInventoryAndDeposit, 10000)
})

// =====================
//   HEALTH
// =====================
bot.on('health', async () => {
  if (bot.health <= 4) {
    bot.chat(`⚠️ Poca vida: ${Math.round(bot.health)}/20.`)
  }
  if (bot.food <= 14 && !isEating) {
    bot.chat(`⚠️ Hambre: ${Math.round(bot.food)}/20. Comiendo...`)
    isEating = true
    try {
      await eatFood()
    } catch (err) {
      bot.chat(`Error comiendo: ${err.message}`)
      console.error('eatFood error:', err)
    } finally {
      isEating = false
    }
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
    bot.chat('--DATA-- dondetas | status | data | equipment | debug')
    bot.chat('--SETUP-- chest x y z | table x y z | mine x y z | farm x y z | bed x y z')
    bot.chat('--MOVE-- showAt x y z | follow [player] | stop follow')
    bot.chat('--MINE-- bring <block> | cerca <block> [y] | usa <pickaxe> | stop')
    bot.chat('--FARM-- harvest | bake | harvest and bake')
    bot.chat('--OTHER-- eat | armor | grab <item> | equip <item> | drop all | drop <item> | hold <item> | hunt | stop hunt | sleep')
    return
  }

  // INFO
  if (message === 'debug') {
    bot.chat(`isEating: ${isEating} | food: ${bot.food} | health: ${bot.health}`)
    bot.chat(`depositActive: ${depositState.active} | hash: ${depositState.lastInventoryHash?.slice(0,30) ?? 'null'}`)
    return
  }

  if (message === 'dondetas') {
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

  if (message === 'data') {
    const fmt = (loc) => loc ? `X:${loc.x} Y:${loc.y} Z:${loc.z}` : 'no registrado'
    bot.chat(`Cofre:  ${fmt(chestLocation)}`)
    bot.chat(`Mesa:   ${fmt(craftingTableLocation)}`)
    bot.chat(`Mina:   ${fmt(mineLocation)}`)
    bot.chat(`Granja: ${fmt(farmLocation)}`)
    bot.chat(`Cama:   ${fmt(bedLocation)}`)
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
    currentMineY = null
    bot.chat(`Mina: X:${x} Y:${y} Z:${z}`)
    return
  }

  if (message.startsWith('bed ')) {
    const p = message.split(' ')
    const [x,y,z] = [Number(p[1]),Number(p[2]),Number(p[3])]
    if ([x,y,z].some(isNaN)) { bot.chat('Uso: bed x y z'); return }
    bedLocation = { x, y, z }; saveState()
    bot.chat(`Cama: X:${x} Y:${y} Z:${z}`)
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

  if (message === 'follow' || message.startsWith('follow ')) {
    const targetName = message === 'follow' ? username : message.split(' ')[1]
    if (!bot.players[targetName]) {
      bot.chat(`No veo a ${targetName} en el servidor.`)
      return
    }
    const target = bot.players[targetName]?.entity
    if (!target) {
      bot.chat(`${targetName} está en el servidor pero no lo puedo localizar.`)
      return
    }
    followingPlayer = true
    miningActive    = false
    huntingActive   = false
    if (followInterval) clearInterval(followInterval)
    bot.chat(`Siguiendo a ${targetName}.`)
    startFollowing(targetName)
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

  if (message === 'sleep') {
    miningActive    = false
    huntingActive   = false
    followingPlayer = false
    if (followInterval) clearInterval(followInterval)
    bot.pathfinder.setGoal(null)
    await sleepInBed()
    return
  }

  // MINERÍA
  if (message.startsWith('usa ')) {
    const pickaxeName = message.split(' ')[1]
    if (!pendingPickaxe || pendingPickaxe !== pickaxeName) {
      bot.chat(`No estaba esperando confirmación para ${pickaxeName}.`)
      return
    }
    bot.chat(`Ok, usando ${pickaxeName}.`)
    pendingPickaxe = null

    let item = bot.inventory.items().find(i => i.name === pickaxeName)
    if (!item) await getItemFromChest(pickaxeName, 1)
    item = bot.inventory.items().find(i => i.name === pickaxeName)
    if (!item) { bot.chat(`No encuentro ${pickaxeName}.`); return }

    await equipPickaxe(pickaxeName)

    if (miningTarget) {
      miningActive = true
      bot.chat(`Retomando búsqueda de ${miningTarget}.`)
      shaftMiningLoop()
    }
    return
  }

  if (message === 'drop all') {
    const items = bot.inventory.items()
    if (!items.length) { bot.chat('No tengo nada encima.'); return }
    if (chestLocation) {
      bot.chat('Depositando todo en el cofre...')
      // Temporarily clear the hash so depositInChest doesn't skip
      depositState.lastInventoryHash = null
      await depositInChest()
    } else {
      bot.chat(`Sin cofre registrado. Tirando ${items.length} tipos al suelo...`)
      for (const item of items) {
        try { await bot.toss(item.type, null, item.count) } catch {}
      }
      bot.chat('Listo, manos vacías.')
    }
    return
  }

  if (message.startsWith('drop ') && message !== 'drop all') {
    const itemName = message.split(' ').slice(1).join(' ')
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) { bot.chat(`No tengo ${itemName}.`); return }
    try {
      await bot.toss(item.type, null, item.count)
      bot.chat(`Dropeé ${item.count}x ${itemName}.`)
    } catch (err) {
      bot.chat(`No pude dropear ${itemName}: ${err.message}`)
    }
    return
  }

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
    bot.chat(`Buscando ${blockName} en escalera desde la mina.`)
    shaftMiningLoop()
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
  if (message === 'eat')   { await eatFood(); return }
  if (message === 'armor') { await equipBestArmor(); return }

  if (message.startsWith('hold ')) {
    const itemName = message.split(' ').slice(1).join(' ')
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) { bot.chat(`No tengo ${itemName}.`); return }
    try { await bot.equip(item, 'hand'); bot.chat(`Sosteniendo ${itemName}.`) }
    catch (err) { bot.chat(`No pude equipar: ${err.message}`) }
    return
  }

  if (message.startsWith('grab ')) {
    const itemName = message.split(' ').slice(1).join(' ')
    if (!chestLocation) { bot.chat('No hay cofre registrado.'); return }
    bot.chat(`Buscando ${itemName} en el cofre...`)
    const got = await getItemFromChest(itemName, 1)
    if (got) bot.chat(`✅ Saqué ${itemName} del cofre.`)
    else     bot.chat(`No encontré ${itemName} en el cofre.`)
    return
  }

  if (message.startsWith('equip ')) {
    const itemName = message.split(' ').slice(1).join(' ')
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) { bot.chat(`No tengo ${itemName} en el inventario.`); return }
    try {
      await equipItem(item)
    } catch (err) {
      bot.chat(`No pude equipar ${itemName}: ${err.message}`)
    }
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
      await depositInChest()
      if (!miningActive) break
    }
    const block = bot.findBlock({
      matching: (b) => b && b.position && b.name === miningTarget &&
                       Math.abs(b.position.y - baseY) <= yTolerance,
      maxDistance: 32
    })
    if (!block) {
      bot.chat(`No encuentro ${miningTarget} a ±${yTolerance} de Y:${baseY}.`)
      miningActive = false
      await depositInChest()
      break
    }
    if (hasLavaNearby(block.position)) { await bot.waitForTicks(10); continue }
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        block.position.x, block.position.y, block.position.z, 1
      ))
      await safeDig(block)
    } catch { await bot.waitForTicks(5) }
  }
}

// =====================
//   MINERÍA: ESCALERA
// =====================
async function shaftMiningLoop() {
  const optimalY = OPTIMAL_Y[miningTarget] ?? -58
  const cx = Math.floor(mineLocation.x)
  const cz = Math.floor(mineLocation.z)
  const startY = currentMineY ?? mineLocation.y

  bot.chat(`Yendo a la mina (X:${cx} Y:${startY} Z:${cz})...`)
  try {
    await safeGoto(cx, startY, cz, 4)
  } catch (err) {
    if (!err.message?.includes('GoalChanged')) {
      bot.chat('No pude llegar a la mina.')
      console.error('Error reaching mine:', err)
    }
    miningActive = false
    return
  }

  bot.chat(`Bajando en escalera hasta Y:${optimalY}...`)
  await digStaircaseDown(cx, cz, optimalY)

  if (miningActive) {
    bot.chat(`Llegué a Y:${optimalY}. Terminé.`)
    miningActive = false
    currentMineY = null
    await depositInChest()
  }
}

async function digStaircaseDown(cx, cz, targetY) {
  const HALF  = 4
  const stepX = cx + HALF - 1
  const stepZ = cz + HALF - 1

  while (miningActive) {
    const currentY = Math.floor(bot.entity.position.y)
    currentMineY   = currentY

    if (currentY <= targetY) {
      bot.chat(`✅ Llegué a Y:${targetY}`)
      break
    }

    bot.chat(`🪨 Minando capa Y:${currentY}...`)
    await mineLayer(cx, cz, currentY, HALF)
    if (!miningActive) return

    // Depositar si el inventario está lleno
    if (bot.inventory.emptySlotCount() < 4) {
      currentMineY = Math.floor(bot.entity.position.y)
      await depositInChest()
      if (!miningActive) return
      try { await safeGoto(stepX, currentMineY, stepZ, 2) } catch {}
    }

    // Moverse a la posición del escalón
    try {
      await safeGoto(stepX, currentY, stepZ, 1)
    } catch (err) {
      if (!err.message?.includes('GoalChanged')) await bot.waitForTicks(5)
      continue
    }

    // Verificar lava antes de bajar
    if (hasLavaNearby(new Vec3(stepX, currentY - 1, stepZ))) {
      bot.chat('🔥 Lava detectada en el escalón. Buscando otra ruta...')
      let foundPath = false
      for (let offset = -2; offset <= 2; offset++) {
        const testPos   = new Vec3(stepX + offset, currentY - 1, stepZ)
        const testBlock = bot.blockAt(testPos)
        if (testBlock && testBlock.diggable && !hasLavaNearby(testPos)) {
          try { await safeDig(testBlock); foundPath = true; break } catch {}
        }
      }
      if (!foundPath) {
        bot.chat('No encuentro camino seguro para bajar. Abortando.')
        miningActive = false
        return
      }
    }

    // Cavar escalón
    const step1 = bot.blockAt(new Vec3(stepX, currentY - 1, stepZ))
    const step2 = bot.blockAt(new Vec3(stepX, currentY - 2, stepZ))
    if (step1?.diggable && !step1.name.includes('lava')) await safeDig(step1)
    if (step2?.diggable && !step2.name.includes('lava')) await safeDig(step2)

    // Bajar un nivel
    try {
      await safeGoto(stepX, currentY - 1, stepZ, 1)
    } catch { await bot.waitForTicks(10) }

    bot.chat(`⬇️ Ahora en Y:${Math.floor(bot.entity.position.y)}`)
  }

  bot.chat(`⬇️ Llegué a Y:${Math.floor(bot.entity.position.y)}`)
}

async function mineLayer(cx, cz, layerY, half) {
  const minX = cx - half
  const maxX = cx + half - 1
  const minZ = cz - half
  const maxZ = cz + half - 1

  const allMineableBlocks = new Set([
    'stone', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite',
    'gravel', 'dirt', 'sand', 'sandstone', 'coal_ore', 'deepslate_coal_ore',
    'iron_ore', 'deepslate_iron_ore', 'gold_ore', 'deepslate_gold_ore',
    'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
    'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'copper_ore', 'deepslate_copper_ore'
  ])

  for (let dz = 0; dz <= half * 2 - 1; dz++) {
    if (!miningActive) return
    const zPos   = minZ + dz
    const xRange = Array.from({ length: half * 2 }, (_, i) => minX + i)
    const xRow   = dz % 2 === 0 ? xRange : [...xRange].reverse()

    for (const xPos of xRow) {
      if (!miningActive) return

      if (bot.inventory.emptySlotCount() < 4) {
        currentMineY = Math.floor(bot.entity.position.y)
        await depositInChest()
        if (!miningActive) return
        try { await bot.pathfinder.goto(new goals.GoalNear(xPos, layerY, zPos, 2)) } catch {}
      }

      try {
        await bot.pathfinder.goto(new goals.GoalNear(xPos, layerY, zPos, 1))
      } catch { continue }

      for (const dy of [0, 1]) {
        const block = bot.blockAt(new Vec3(xPos, layerY + dy, zPos))
        if (!block || block.name === 'air') continue
        if (block.position.x < minX || block.position.x > maxX ||
            block.position.z < minZ || block.position.z > maxZ) continue

        const shouldMine =
          block.name === miningTarget ||
          allMineableBlocks.has(block.name) ||
          block.diggable

        if (shouldMine) {
          if (hasLavaNearby(block.position)) {
            bot.chat(`⚠️ Lava cerca de ${block.name}, saltando...`)
            continue
          }
          if (block.name.includes('ore') || block.name === 'obsidian') {
            const hasPickaxe = await ensurePickaxe(block.name)
            if (!hasPickaxe && !block.name.includes('coal')) {
              bot.chat(`No tengo pico para ${block.name}, saltando...`)
              continue
            }
          }
          await safeDig(block)
        }
      }
    }
  }
}

// =====================
//   DORMIR
// =====================
async function sleepInBed() {
  if (!bedLocation) { bot.chat('No sé dónde está la cama. Usá "bed x y z".'); return }

  bot.chat('Yendo a dormir...')
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      bedLocation.x, bedLocation.y, bedLocation.z, 2
    ))
  } catch { bot.chat('No pude llegar a la cama.'); return }

  const bedBlock = bot.blockAt(new Vec3(bedLocation.x, bedLocation.y, bedLocation.z))
  if (!bedBlock || !bedBlock.name.includes('bed')) {
    bot.chat('No hay cama ahí. Registrá bien con "bed x y z".')
    return
  }

  try {
    await bot.sleep(bedBlock)
    bot.chat('Buenas noches... 💤')
  } catch (err) {
    bot.chat(`No pude dormir: ${err.message}`)
    return
  }

  bot.once('wake', () => { bot.chat('Buenos días! ☀️') })
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
    chest.close()
    return true
  } catch { return false }
}

async function depositInChest() {
  if (!chestLocation) {
    bot.chat('No hay cofre registrado. Usá "chest x y z" primero.')
    return
  }

  // Si ya está depositando, esperar a que termine
  if (depositState.active) {
    bot.chat('Depósito en progreso, esperando...')
    while (depositState.active) await bot.waitForTicks(10)
    return
  }

  // Si el inventario no cambió desde la última vez, no vale la pena ir
  const currentHash = getInventoryHash()
  if (currentHash !== '' && currentHash === depositState.lastInventoryHash) {
    console.log('📦 Inventario sin cambios desde último depósito, salteando.')
    return
  }

  // Cooldown entre depósitos
  const now = Date.now()
  if (now - depositState.lastRun < depositState.cooldown) {
    const wait = depositState.cooldown - (now - depositState.lastRun)
    console.log(`📦 Cooldown de depósito, esperando ${wait}ms...`)
    await new Promise(resolve => setTimeout(resolve, wait))
  }

  depositState.active  = true
  depositState.lastRun = Date.now()

  const wasMiningActive = miningActive
  if (wasMiningActive) miningActive = false

  try {
    bot.chat('📦 Yendo al cofre para depositar...')

    try {
      await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
    } catch (err) {
      if (!err.message?.includes('GoalChanged')) throw err
    }

    const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    if (!chestBlock || !chestBlock.name.includes('chest')) {
      bot.chat('No encuentro el cofre en la ubicación registrada.')
      return
    }

    // Determinar qué NO depositar
    const armorNames = new Set(Object.values(ARMOR_PRIORITY).flat())
    const keepTypes  = new Set()

    for (const item of bot.inventory.items()) {
      const isTool  = item.name.includes('pickaxe') || item.name.includes('sword') ||
                      item.name.includes('axe')     || item.name.includes('shovel') ||
                      item.name.includes('hoe')
      const isArmor = armorNames.has(item.name)
      const isFood  = FOOD_PRIORITY.includes(item.name) && bot.food < 18

      if (isTool || isArmor || isFood) keepTypes.add(item.type)
    }

    const chest          = await bot.openChest(chestBlock)
    let   depositedCount = 0
    const depositedNames = []

    for (const item of bot.inventory.items()) {
      if (keepTypes.has(item.type)) continue
      try {
        await chest.deposit(item.type, null, item.count)
        depositedCount += item.count
        depositedNames.push(`${item.count}x ${item.name}`)
        await bot.waitForTicks(2)
      } catch (err) {
        console.error(`Error depositando ${item.name}:`, err)
      }
    }

    chest.close()

    if (depositedCount > 0) {
      bot.chat(`✅ Depositados ${depositedCount} items: ${depositedNames.join(', ')}`)
    } else {
      bot.chat('No había items nuevos para depositar.')
    }

    await bot.waitForTicks(10)

    // Guardar el hash POST-depósito (inventario ya limpio)
    depositState.lastInventoryHash = getInventoryHash()

    await reEquipTool()

    if (wasMiningActive && miningTarget) {
      miningActive = true
      bot.chat('Reanudando minería...')
      setTimeout(() => {
        if (miningActive && miningTarget) shaftMiningLoop()
      }, 1000)
    }

  } catch (err) {
    if (!err.message?.includes('GoalChanged')) {
      bot.chat(`No pude depositar: ${err.message}`)
      console.error('depositInChest error:', err)
    }
  } finally {
    depositState.active = false
    pathfindingLock     = false
  }
}

function checkInventoryAndDeposit() {
  if (depositState.active || huntingActive || followingPlayer) return

  const emptySlots  = bot.inventory.emptySlotCount()
  const totalSlots  = 36
  const usedPercent = ((totalSlots - emptySlots) / totalSlots) * 100

  if (usedPercent > 75 && emptySlots < 9) {
    // Verificar si hay algo nuevo para depositar antes de ir
    const currentHash = getInventoryHash()
    if (currentHash === depositState.lastInventoryHash) {
      console.log('checkInventoryAndDeposit: inventario sin cambios, salteando.')
      return
    }

    bot.chat(`⚠️ Inventario ${Math.round(usedPercent)}% lleno, depositando...`)

    const wasMining = miningActive
    if (wasMining) miningActive = false

    depositInChest().then(() => {
      if (wasMining && miningTarget) {
        miningActive = true
        shaftMiningLoop()
      }
    })
  }
}

async function pickupNearbyItems() {
  const droppedItems = Object.values(bot.entities).filter(e =>
    e.name === 'item' &&
    e.position.distanceTo(bot.entity.position) < 5
  )
  if (droppedItems.length === 0) return

  bot.chat(`📦 Recogiendo ${droppedItems.length} items del suelo...`)
  for (const item of droppedItems) {
    try {
      await safeGoto(item.position.x, item.position.y, item.position.z, 1)
      await bot.waitForTicks(10)
    } catch (err) {
      console.error('Error picking up item:', err)
    }
  }

  // Solo depositar si el inventario cambió (recogimos algo nuevo)
  const hashBefore = depositState.lastInventoryHash
  const hashNow    = getInventoryHash()
  if (hashNow !== hashBefore) await depositInChest()
}

// =====================
//   PICOS
// =====================
async function ensurePickaxe(blockName) {
  console.log('ensurePickaxe para:', blockName)

  const minPickaxe = PICKAXE_FOR_BLOCK[blockName] ?? 'stone_pickaxe'
  const minTier    = PICKAXE_TIER[minPickaxe]

  const inventoryPickaxes = bot.inventory.items().filter(i => i.name.includes('pickaxe'))
  const equippedItem      = bot.inventory.slots[36]

  console.log(`Equipado: ${equippedItem?.name || 'nada'}`)
  console.log(`Pickaxes en inventario: ${inventoryPickaxes.map(p => p.name).join(', ') || 'ninguno'}`)

  if (equippedItem && equippedItem.name.includes('pickaxe')) {
    const heldTier = PICKAXE_TIER[equippedItem.name] ?? 0
    if (heldTier >= minTier) {
      bot.chat(`✅ Ya tengo el ${equippedItem.name} equipado, sirve para ${blockName}.`)
      return true
    } else {
      bot.chat(`El ${equippedItem.name} no alcanza para minar ${blockName}. Buscando mejor pico...`)
    }
  }

  const availablePickaxes = inventoryPickaxes
    .filter(p => (PICKAXE_TIER[p.name] ?? 0) >= minTier)
    .sort((a, b) => (PICKAXE_TIER[a.name] ?? 0) - (PICKAXE_TIER[b.name] ?? 0))

  if (availablePickaxes.length > 0) {
    const bestPick = availablePickaxes[0]
    if (PICKAXE_TIER[bestPick.name] >= VALUABLE_TIER) {
      bot.chat(`⚠️ Solo tengo ${bestPick.name} que es valioso.`)
      bot.chat(`Si querés que lo use, decime: "usa ${bestPick.name}"`)
      pendingPickaxe = bestPick.name
      miningActive   = false
      return false
    }
    await equipPickaxe(bestPick.name)
    bot.chat(`✅ Usando ${bestPick.name} para ${blockName}.`)
    return true
  }

  if (chestLocation) {
    bot.chat(`No tengo pico para ${blockName}. Buscando en cofre...`)
    const chestPickaxes = await getPickaxesFromChest()
    const suitableChestPickaxes = chestPickaxes
      .filter(p => (PICKAXE_TIER[p.name] ?? 0) >= minTier)
      .sort((a, b) => (PICKAXE_TIER[a.name] ?? 0) - (PICKAXE_TIER[b.name] ?? 0))

    if (suitableChestPickaxes.length > 0) {
      const chestPick = suitableChestPickaxes[0]
      if (PICKAXE_TIER[chestPick.name] >= VALUABLE_TIER) {
        bot.chat(`⚠️ En el cofre solo hay ${chestPick.name} valioso.`)
        bot.chat(`Si querés que lo use, decime: "usa ${chestPick.name}"`)
        pendingPickaxe = chestPick.name
        miningActive   = false
        return false
      }
      if (await getItemFromChest(chestPick.name, 1)) {
        await equipPickaxe(chestPick.name)
        bot.chat(`✅ Saqué ${chestPick.name} del cofre.`)
        return true
      }
    }
  }

  bot.chat(`Intentando craftear ${minPickaxe}...`)
  if (await craftPickaxe(minPickaxe)) {
    await equipPickaxe(minPickaxe)
    return true
  }

  bot.chat('❌ No pude conseguir ningún pico adecuado.')
  return false
}

async function getPickaxesFromChest() {
  if (!chestLocation) return []
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      chestLocation.x, chestLocation.y, chestLocation.z, 2
    ))
    const chestBlock = bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
    const chest      = await bot.openChest(chestBlock)
    const pickaxes   = chest.containerItems().filter(i => i.name.includes('pickaxe'))
    chest.close()
    return pickaxes
  } catch (err) {
    console.error('Error getting pickaxes from chest:', err)
    return []
  }
}

async function equipPickaxe(name) {
  const item = bot.inventory.items().find(i => i.name === name)
  if (item) await bot.equip(item, 'hand')
}

async function craftPickaxe(pickaxeName) {
  const material = PICKAXE_MATERIAL[pickaxeName]
  if (!material) return false
  const count = (name) =>
    bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
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
    bot.chat(`${pickaxeName} crafteado!`)
    return true
  } catch (err) { bot.chat(`Error: ${err.message}`); return false }
}

function reportPickaxes() {
  const found = ['wooden_pickaxe','stone_pickaxe','iron_pickaxe',
                  'golden_pickaxe','diamond_pickaxe','netherite_pickaxe']
    .map(name => ({
      name,
      count: bot.inventory.items().filter(i => i.name === name).reduce((s,i) => s+i.count, 0)
    }))
    .filter(p => p.count > 0)
  if (!found.length) { bot.chat('No tengo ningún pico.'); return }
  bot.chat('Picos: ' + found.map(p => `${p.name}:${p.count}`).join(' | '))
}

// =====================
//   ARMADURA
// =====================
async function equipBestArmor() {
  bot.chat('Revisando armadura...')
  let equipped = 0

  for (const [slot, priority] of Object.entries(ARMOR_PRIORITY)) {
    const slotIndex = slot === 'head' ? 5 : slot === 'chest' ? 6 : slot === 'legs' ? 7 : 8
    const current     = bot.inventory.slots[slotIndex]
    const currentTier = current ? priority.indexOf(current.name) : Infinity

    let bestName = null
    let bestTier = Infinity

    for (let i = 0; i < priority.length; i++) {
      if (bot.inventory.items().some(item => item.name === priority[i])) {
        bestName = priority[i]; bestTier = i; break
      }
    }

    if (chestLocation && bestTier >= currentTier) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(
          chestLocation.x, chestLocation.y, chestLocation.z, 2
        ))
        const chest = await bot.openChest(
          bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
        )
        for (let i = 0; i < priority.length; i++) {
          if (i >= currentTier) break
          const found = chest.containerItems().find(item => item.name === priority[i])
          if (found) {
            await chest.withdraw(found.type, null, 1)
            bot.chat(`Saqué ${found.name} del cofre.`)
            if (i < bestTier) { bestName = found.name; bestTier = i }
            break
          }
        }
        chest.close()
      } catch (err) {
        bot.chat(`Error al buscar armadura en cofre: ${err.message}`)
      }
    }

    if (bestName && bestTier < currentTier) {
      const item = bot.inventory.items().find(i => i.name === bestName)
      if (item) {
        try {
          await bot.equip(item, slot)
          bot.chat(`🛡️ ${slot}: ${bestName}`)
          equipped++
        } catch (err) { bot.chat(`No pude equipar ${bestName}: ${err.message}`) }
      }
    } else if (current) {
      bot.chat(`🛡️ ${slot}: ${current.name} (ya es lo mejor disponible)`)
    } else {
      bot.chat(`🛡️ ${slot}: sin armadura disponible`)
    }
  }

  if (equipped === 0) bot.chat('No encontré mejoras para la armadura actual.')
  else bot.chat(`✅ Equipadas ${equipped} pieza(s) nueva(s).`)

  await reEquipTool()
}

// =====================
//   GRANJA
// =====================
async function harvestWheat() {
  if (!farmLocation) { bot.chat('Registrá la granja con "farm x y z".'); return }

  const seeds = bot.inventory.items()
    .filter(i => i.name === 'wheat_seeds').reduce((s, i) => s + i.count, 0)
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
      matching: (b) => b && b.position && b.name === 'wheat' && b.getProperties().age === 7,
      maxDistance: 32
    })
    if (!wheat) { bot.chat(`Cosecha terminada. ${harvested} plantas.`); break }
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        wheat.position.x, wheat.position.y, wheat.position.z, 1
      ))
      await safeDig(wheat)
      harvested++
      const seed     = bot.inventory.items().find(i => i.name === 'wheat_seeds')
      const farmland = bot.blockAt(wheat.position.offset(0, -1, 0))
      if (seed && farmland?.name === 'farmland') {
        try { await bot.equip(seed, 'hand'); await bot.placeBlock(farmland, new Vec3(0, 1, 0)) }
        catch {}
      }
    } catch { await bot.waitForTicks(5) }
  }
}

async function makeBread() {
  const wheatCount = bot.inventory.items()
    .filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)
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
  } catch (err) {
    bot.chat(`No pude comer ${foodItem.name}: ${err.message}`)
    console.error('consumeFood error:', err)
  }
}

async function eatFood() {
  if (bot.food >= 20) { bot.chat('No tengo hambre.'); return }

  let food = findFoodInInventory()
  if (food) { await consumeFood(food); await reEquipTool(); return }

  if (chestLocation) {
    bot.chat('Sin comida en inventario. Buscando en cofre...')
    try {
      await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2)
      const chest = await bot.openChest(
        bot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z))
      )
      let found = false
      for (const name of FOOD_PRIORITY) {
        const item = chest.containerItems().find(i => i.name === name)
        if (item) {
          await chest.withdraw(item.type, null, Math.min(item.count, 16))
          bot.chat(`Saqué ${name} del cofre.`)
          found = true
          break
        }
      }
      chest.close()
      if (found) {
        food = findFoodInInventory()
        if (food) { await consumeFood(food); await reEquipTool(); return }
      }
    } catch (err) { bot.chat(`Error accediendo al cofre: ${err.message}`) }
  }

  const wheat = bot.inventory.items()
    .filter(i => i.name === 'wheat').reduce((s, i) => s + i.count, 0)
  if (wheat >= 3) {
    bot.chat('Tengo trigo. Haciendo pan...')
    await makeBread()
    food = findFoodInInventory()
    if (food) { await consumeFood(food); await reEquipTool(); return }
  }

  if (farmLocation) {
    bot.chat('Voy a cosechar y hacer pan...')
    await harvestWheat()
    await makeBread()
    food = findFoodInInventory()
    if (food) { await consumeFood(food); await reEquipTool(); return }
  }

  bot.chat('⚠️ No encontré comida en ningún lado.')
}

// =====================
//   SEGUIR
// =====================
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval)
  followInterval = setInterval(() => {
    if (!followingPlayer) { clearInterval(followInterval); return }
    if (miningActive || huntingActive || pathfindingLock) return
    const target = bot.players[username]?.entity
    if (!target) return
    safeSetGoal(new goals.GoalNear(
      target.position.x, target.position.y, target.position.z, 3
    ), true)
  }, 1000)
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
    .sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    )[0] ?? null
}

async function fightMob(mob) {
  bot.chat(`Atacando ${mob.name}.`)
  while (huntingActive && mob.isValid && bot.health > 4) {
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        mob.position.x, mob.position.y, mob.position.z, 2
      ))
    } catch { break }
    try { await bot.attack(mob) } catch { break }
    await bot.waitForTicks(12)
    if (bot.food <= 6) await eatFood()
  }
  if (!mob.isValid)         bot.chat(`${mob.name} eliminado.`)
  else if (bot.health <= 4) { bot.chat('Vida crítica, me retiro!'); bot.pathfinder.setGoal(null) }
}

async function patrol() {
  const pos = bot.entity.position
  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      pos.x + (Math.random() - 0.5) * 32,
      pos.y,
      pos.z + (Math.random() - 0.5) * 32,
      2
    ))
  } catch { await bot.waitForTicks(10) }
}

// =====================
//   EQUIP ITEM
// =====================

// Armor slot names by item suffix
const ARMOR_SLOT_MAP = {
  helmet:      'head',
  chestplate:  'chest',
  leggings:    'legs',
  boots:       'feet',
}

async function equipItem(item) {
  const name = item.name

  // Shield → off-hand (slot 45, equip destination 'off-hand')
  if (name === 'shield') {
    await bot.equip(item, 'off-hand')
    bot.chat(`🛡️ Escudo en mano izquierda.`)
    return
  }

  // Armor → detect slot from item name suffix
  for (const [suffix, slot] of Object.entries(ARMOR_SLOT_MAP)) {
    if (name.endsWith(suffix)) {
      await bot.equip(item, slot)
      bot.chat(`🛡️ ${name} equipado en ${slot}.`)
      return
    }
  }

  // Everything else → main hand
  await bot.equip(item, 'hand')
  bot.chat(`✅ ${name} en mano derecha.`)
}

// =====================
//   HELPERS
// =====================
function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    return b && (b.name === 'lava' || b.name === 'flowing_lava')
  })
}

function setSprintMode(enabled) {
  const movements         = new Movements(bot)
  movements.allowSprinting = enabled
  bot.pathfinder.setMovements(movements)
}

async function safeDig(block) {
  if (!block || block.type === 0) return false

  const fresh = bot.blockAt(block.position)
  if (!fresh || fresh.type === 0 || fresh.name === 'air') return false
  if (PROTECTED_BLOCKS.has(fresh.name)) return false

  await reEquipTool()

  try {
    await bot.dig(fresh, true)
    return true
  } catch (err) {
    if (err.message?.includes('air') || err.message?.includes('already')) return false
    throw err
  }
}

async function reEquipTool() {
  if (miningActive && miningTarget) {
    const needed = PICKAXE_FOR_BLOCK[miningTarget] ?? 'stone_pickaxe'
    await equipPickaxe(needed)
  } else if (huntingActive) {
    await equipBestSword()
  }
}

bot.on('error', err => console.error('❌ Error:', err))
bot.on('end',   ()  => console.log('🔌 Bot desconectado'))