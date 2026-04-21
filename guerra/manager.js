const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Vec3 = require('vec3');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcData = require('minecraft-data')('1.21.1');

const MASTER = 'gonsalomon';
const STATE_FILE = './manager_state.json';

// ===================== CONSTANTES =====================
const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_porkchop', 'cooked_beef', 'bread',
  'apple', 'carrot', 'baked_potato', 'cooked_mutton', 'cooked_chicken',
  'cooked_salmon', 'cooked_cod'
];

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'witch', 'pillager', 'vindicator', 'ravager', 'blaze',
  'ghast', 'hoglin', 'wither_skeleton', 'enderman', 'silverfish',
  'phantom', 'drowned', 'husk', 'stray'
];

const VILLAGE_BLOCKS = new Set([
  'bed', 'cartography_table', 'lectern', 'composter', 'blast_furnace',
  'smoker', 'loom', 'grindstone', 'stonecutter', 'barrel',
  'fletching_table', 'smithing_table', 'bell'
]);

const VILLAGE_RADIUS = 64;

// ===================== LEÑADOR =====================
const WOOD_BLOCKS = new Set(['oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log']);
const LEAVES_BLOCKS = new Set(['oak_leaves','spruce_leaves','birch_leaves','jungle_leaves','acacia_leaves','dark_oak_leaves','mangrove_leaves','cherry_leaves','azalea_leaves','flowering_azalea_leaves']);
const TREE_HEIGHT_LIMIT = 12;

let woodcuttingActive = false;
let tradingActive = false;

// ===================== COMBATE =====================
const WEAPON_PRIORITY = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword','netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe'];
const AXE_PRIORITY = ['netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe'];

const CombatState = { IDLE: 'idle', APPROACHING: 'approaching', BLOCKING: 'blocking', ATTACKING: 'attacking', RETREATING: 'retreating', HEALING: 'healing' };
const HUNT_CONFIG = { combatRange: 3, safeHealth: 12, safeFood: 12, retreatHealth: 8, blockChance: 0.7, blockDuration: 20, attackCooldown: 12, fallbackDistance: 15, awarenessRadius: 16 };
const SPECIAL_MOBS = {
  creeper: { strategy: 'hit_and_run', safeDistance: 4 },
  skeleton: { strategy: 'shield_rush', safeDistance: 2 },
  spider: { strategy: 'aggressive', safeDistance: 2 },
  enderman: { strategy: 'avoid', safeDistance: 8 },
  witch: { strategy: 'rush', safeDistance: 3 },
  blaze: { strategy: 'ranged_dodge', safeDistance: 5 }
};
const DODGE_CONFIG = { enabled: true, detectionRadius: 8, safeDistance: 12, checkInterval: 500 };

let currentCombatState = CombatState.IDLE;
let currentTarget = null;
let lastShieldUse = 0;
let patrolActive = false;
let cuidameMode = false;
let isDodging = false;

// ===================== ESTADO =====================
let chestLocation = null;
let craftingTableLocation = null;
let bedLocation = null;
let villageLocation = null;
let villageBedLocation = null;
let villagerTrades = {};

let explorationActive = false;
let followingPlayer = false;
let followInterval = null;
let autoFollowEnabled = true;
let pathfindingLock = false;
let pendingGoal = null;
let isEating = false;
let dodgeInterval = null;
let miningActive = false;
let huntingActive = false;
let chestLocations = [];
let chestBlacklist = [];

const depositState = { active: false, lastRun: 0, lastInventoryHash: null, cooldown: 5000 };
const activeWorkers = new Map();

// ===================== BOT MANAGER =====================
const managerBot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: 'General_Lucas',
  version: '1.21.11'
});

managerBot.loadPlugin(pathfinder);

// ===================== UTILIDADES =====================
function sendPrivateMessage(message) {
  if (MASTER && managerBot.players[MASTER]) {
    managerBot.chat(`/tell ${MASTER} ${message}`);
  } else {
    console.log(`[No enviado a ${MASTER}]: ${message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeSetGoal(goal, priority = false) {
  if (pathfindingLock) {
    pendingGoal = { goal, priority };
    return false;
  }
  try {
    pathfindingLock = true;
    managerBot.pathfinder.setGoal(goal, priority);
    return true;
  } catch (err) {
    console.error('safeSetGoal error:', err);
    return false;
  } finally {
    setTimeout(() => {
      pathfindingLock = false;
      if (pendingGoal) {
        const { goal, priority } = pendingGoal;
        pendingGoal = null;
        safeSetGoal(goal, priority);
      }
    }, 1000);
  }
}

async function safeGoto(x, y, z, range = 2) {
  let waited = 0;
  while (pathfindingLock && waited < 30) {
    await sleep(100);
    waited++;
  }
  if (pathfindingLock) {
    console.log('⚠️ pathfindingLock timeout en safeGoto, forzando reset');
    pathfindingLock = false;
    if (managerBot.pathfinder?.goal) managerBot.pathfinder.setGoal(null);
    await sleep(50);
  }

  if (managerBot.pathfinder?.goal) {
    managerBot.pathfinder.setGoal(null);
    await sleep(50);
  }

  const protectedBlocks = detectProtectedBlocks(x, y, z, 16);
  setSprintMode(false, protectedBlocks);
  try {
    pathfindingLock = true;
    await managerBot.pathfinder.goto(new goals.GoalNear(x, y, z, range));
  } catch (err) {
    if (err.message?.includes('GoalChanged')) {
      console.log('🔄 GoalChanged ignorado, reintentando...');
      await sleep(100);
      try {
        await managerBot.pathfinder.goto(new goals.GoalNear(x, y, z, range));
      } catch (e) {
        if (!e.message?.includes('GoalChanged')) throw e;
      }
    } else if (err.message?.includes('Timeout')) {
      console.log('⏱️ Timeout en pathfinder, reintentando una vez...');
      await sleep(500);
      try {
        await managerBot.pathfinder.goto(new goals.GoalNear(x, y, z, range));
      } catch (e) {
        if (!e.message?.includes('Timeout')) throw e;
      }
    } else if (!err.message?.includes('GoalChanged')) {
      throw err;
    }
  } finally {
    const protectedBlocks = detectProtectedBlocks(x, y, z, 16);
    setSprintMode(true, protectedBlocks);
    pathfindingLock = false;
  }
}

function detectProtectedBlocks(posX, posY, posZ, radius = 16) {
  const protectedBlocks = new Set();
  for (let x = posX - radius; x <= posX + radius; x++) {
    for (let y = Math.max(0, posY - 5); y <= Math.min(255, posY + 5); y++) {
      for (let z = posZ - radius; z <= posZ + radius; z++) {
        const block = managerBot.blockAt(new Vec3(x, y, z));
        if (block && VILLAGE_BLOCKS.has(block.name)) {
          protectedBlocks.add(block.name);
        }
      }
    }
  }
  return protectedBlocks;
}

function setSprintMode(enabled, forbiddenBlocks = new Set()) {
  const movements = new Movements(managerBot);
  movements.allowSprinting = enabled;
  movements.allowParkour = true;
  movements.allowSneaking = true;
  movements.allowBreakingBlocks = false;

  if (forbiddenBlocks.size > 0) {
    movements.blocksToAvoid.clear();
    for (const blockName of forbiddenBlocks) {
      const blockId = mcData.blocksByName[blockName]?.id;
      if (blockId !== undefined) {
        movements.blocksToAvoid.add(blockId);
      }
    }
  }

  managerBot.pathfinder.setMovements(movements);
}

// ===================== COMIDA, SALUD Y SUEÑO =====================
function findBestFood() {
  for (const name of FOOD_PRIORITY) {
    const item = managerBot.inventory.items().find(i => i.name === name);
    if (item) return item;
  }
  return null;
}

async function getFoodFromChest() {
  if (!chestLocation) return false;
  await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2);
  const chestBlock = managerBot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z));
  if (!chestBlock || !chestBlock.name.includes('chest')) return false;
  const chest = await managerBot.openChest(chestBlock);
  let found = false;
  for (const name of FOOD_PRIORITY) {
    const item = chest.containerItems().find(i => i.name === name);
    if (item) {
      await chest.withdraw(item.type, null, Math.min(item.count, 16));
      found = true;
      break;
    }
  }
  chest.close();
  return found;
}

async function eatFood() {
  if (isEating) return;
  isEating = true;
  try {
    let food = findBestFood();
    if (!food && chestLocation) {
      const got = await getFoodFromChest();
      if (got) food = findBestFood();
    }
    if (!food) {
      sendPrivateMessage('⚠️ No tengo comida. Necesito más.');
      return;
    }
    await managerBot.equip(food, 'hand');
    await managerBot.consume();
    await sleep(500);
  } catch (err) {
    console.error('Error comiendo:', err);
  } finally {
    isEating = false;
  }
}

async function checkHealthAndHunger() {
  if (managerBot.food < 18 || managerBot.health < 14) {
    await eatFood();
  }
}

async function sleepInBed() {
  const loc=bedLocation||villageBedLocation; if(!loc){sendPrivateMessage('❌ Sin cama.');return}
  await safeGoto(loc.x,loc.y,loc.z,2)
  const bed=bot.blockAt(new Vec3(loc.x,loc.y,loc.z))
  if(!bed?.name.includes('bed')){sendPrivateMessage('❌ No encuentro cama.');return}
  try{await bot.sleep(bed);sendPrivateMessage('💤 Durmiendo...');bot.once('wake',()=>sendPrivateMessage('☀️ Buenos días!'))}
  catch(e){sendPrivateMessage(`❌ No puedo dormir: ${e.message}`)}
}

// ===================== DEPÓSITO =====================
function getInventoryHash() {
  return managerBot.inventory.items()
    .filter(i => !i.name.includes('pickaxe') && !i.name.includes('sword') && !i.name.includes('axe') && !FOOD_PRIORITY.includes(i.name))
    .map(i => `${i.name}:${i.count}`)
    .sort()
    .join('|');
}

// ===================== LEÑADOR - CRAFTS =====================
async function craftPlanks(logName) {
  try {
    const planksName = logName.replace('_log', '_planks');
    const item = managerBot.inventory.items().find(i => i.name === logName);
    if (!item) return false;
    const recipe = managerBot.recipesFor(mcData.itemsByName[planksName]?.id, null, 1, null);
    if (!recipe.length) return false;
    await managerBot.craft(recipe[0], item.count, null);
    return true;
  } catch (e) { console.error('craftPlanks:', e.message); return false; }
}

async function craftSticks() {
  try {
    const planks = managerBot.inventory.items().filter(i => i.name.includes('_planks')).reduce((s, i) => s + i.count, 0);
    if (planks < 2) return false;
    const recipe = managerBot.recipesFor(mcData.itemsByName['stick'].id, null, 1, null);
    if (!recipe.length) return false;
    await managerBot.craft(recipe[0], Math.floor(planks / 2), null);
    return true;
  } catch (e) { console.error('craftSticks:', e.message); return false; }
}

async function processWoodToSticks() {
  for (const log of managerBot.inventory.items().filter(i => i.name.includes('_log'))) {
    await craftPlanks(log.name);
    await sleep(500);
  }
  await sleep(1000);
  await craftSticks();
}

function findCompleteTree(maxDistance = 120) {
  try {
    const logBlock = managerBot.findBlock(b => {
      if (!WOOD_BLOCKS.has(b?.name)) return false;
      if (isInVillageArea(b.position)) return false;
      return true;
    }, maxDistance);
    if (!logBlock) return null;
    const blocks = [];
    for (let y = -1; y <= TREE_HEIGHT_LIMIT; y++) {
      const b = managerBot.blockAt(logBlock.position.offset(0, y, 0));
      if (b && WOOD_BLOCKS.has(b.name)) blocks.push(b);
    }
    return blocks.length ? { blocks, basePos: blocks[0].position } : null;
  } catch (e) { console.error('findCompleteTree:', e.message); return null; }
}

function isInVillageArea(pos) {
  if (!villageLocation) return false;
  const dist = Math.sqrt((pos.x - villageLocation.x) ** 2 + (pos.z - villageLocation.z) ** 2);
  return dist < VILLAGE_RADIUS;
}

async function cutTree(tree) {
  woodcuttingActive = true;
  // Asegurar tener hacha
  const axe = managerBot.inventory.items().find(i => i.name.includes('axe'));
  if (axe) await managerBot.equip(axe, 'hand');
  
  for (const b of tree.blocks) {
    if (!explorationActive && !woodcuttingActive) break;
    try {
      await safeGoto(b.position.x, b.position.y, b.position.z, 2);
      await managerBot.dig(b);
      await sleep(100);
      await depositInChest();
    } catch (e) { if (e.message?.includes('Digging aborted')) await sleep(500); }
  }
  try {
    // Recoger items y plantar
    const items = Object.values(managerBot.entities).filter(e => e.name === 'item' && e.position.distanceTo(managerBot.entity.position) < 5);
    for (const i of items) {
      try { await safeSetGoal(new goals.GoalNear(i.position.x, i.position.y, i.position.z, 1), true); await sleep(200); } catch {}
    }
    // Plantar
    const sapling = managerBot.inventory.items().find(i => i.name.includes('sapling'));
    if (sapling) {
      for (const [dx, , dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const adj = tree.basePos.offset(dx, 0, dz);
        if (managerBot.blockAt(adj)?.name === 'air') {
          const below = managerBot.blockAt(adj.offset(0, -1, 0));
          if (below && below.name !== 'air') {
            await safeGoto(adj.x, adj.y, adj.z, 1);
            await managerBot.equip(sapling, 'hand');
            try { await managerBot.placeBlock(below, new Vec3(0, 1, 0)); sendPrivateMessage('🌱 Plantada'); return true; } catch {}
          }
        }
      }
    }
  } catch (e) { console.error('cutTree post:', e); }
  woodcuttingActive = false;
  return true;
}

async function depositInChest() {
  if (!chestLocation) { sendPrivateMessage('⚠️ No hay cofre registrado.'); return; }
  if (depositState.active) { while (depositState.active) await sleep(50); return; }

  const currentHash = getInventoryHash();
  if (currentHash !== '' && currentHash === depositState.lastInventoryHash) {
    console.log('📦 Inventario sin cambios, salteando.');
    return;
  }

  const now = Date.now();
  if (now - depositState.lastRun < depositState.cooldown) {
    await sleep(depositState.cooldown - (now - depositState.lastRun));
  }

  depositState.active = true;
  depositState.lastRun = Date.now();

  try {
    await safeGoto(chestLocation.x, chestLocation.y, chestLocation.z, 2);
    const chestBlock = managerBot.blockAt(new Vec3(chestLocation.x, chestLocation.y, chestLocation.z));
    if (!chestBlock || !chestBlock.name.includes('chest')) {
      sendPrivateMessage('No encuentro el cofre.');
      return;
    }

    const keepTypes = new Set();
    for (const item of managerBot.inventory.items()) {
      const isFood = FOOD_PRIORITY.includes(item.name) && managerBot.food < 18;
      const isTool = item.name.includes('pickaxe') || item.name.includes('sword') || item.name.includes('axe');
      if (isFood || isTool) keepTypes.add(item.type);
    }

    const chest = await managerBot.openChest(chestBlock);
    let depositedCount = 0;
    for (const item of managerBot.inventory.items()) {
      if (keepTypes.has(item.type)) continue;
      await chest.deposit(item.type, null, item.count);
      depositedCount += item.count;
    }
    chest.close();

    if (depositedCount > 0) sendPrivateMessage(`✅ Depositados ${depositedCount} items`);
    depositState.lastInventoryHash = getInventoryHash();
  } catch (err) {
    if (!err.message?.includes('GoalChanged')) console.error('depositInChest error:', err);
  } finally {
    depositState.active = false;
  }
}

async function checkInventoryAndDeposit() {
  const items = managerBot.inventory.items();
  const hasNonFood = items.some(i => !FOOD_PRIORITY.includes(i.name) && !i.name.includes('pickaxe') && !i.name.includes('sword'));
  if (hasNonFood && chestLocation) {
    await depositInChest();
  }
}

// ===================== ALDEANOS Y TRADES =====================
function getNearestVillager(maxDistance = 64, profession = null) {
  let nearest = null;
  let minDist = maxDistance;

  Object.values(managerBot.entities).forEach(entity => {
    if (entity.name === 'villager' || entity.name === 'villager_v2') {
      if (profession && entity.metadata && entity.metadata[18]) {
        const professionData = entity.metadata[18];
        if (professionData.profession !== profession) return;
      }
      if (entity.metadata && entity.metadata[18]) {
        const professionData = entity.metadata[18];
        if (professionData.profession === 'none' || professionData.profession === 'nitwit') {
          return;
        }
      }
      const dist = entity.position.distanceTo(managerBot.entity.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = entity;
      }
    }
  });
  return nearest;
}

async function fetchVillagerTrades(villagerEntity) {
  let villagerWindow = null;
  let trades = null;
  let attempts = 0;

  while (attempts < 3 && (!trades || trades.length === 0)) {
    try {
      villagerWindow = await managerBot.openVillager(villagerEntity);
      await sleep(200);
      trades = villagerWindow.trades;
      if (trades && trades.length > 0) {
        return { trades, window: villagerWindow };
      }
      villagerWindow.close();
      await sleep(500);
      attempts++;
    } catch (err) {
      console.error(`Intento ${attempts+1} fallido:`, err.message);
      if (villagerWindow) villagerWindow.close();
      attempts++;
      await sleep(1000);
    }
  }
  return { trades: null, window: null };
}

async function readVillagerTrades(profession = null) {
  const villager = getNearestVillager(64, profession);
  if (!villager) {
    sendPrivateMessage(`❌ No hay aldeanos${profession ? ` ${profession}` : ' con oficio'} cerca.`);
    return;
  }

  try {
    await safeGoto(villager.position.x, villager.position.y, villager.position.z, 2);
    await sleep(500);

    const { trades, window } = await fetchVillagerTrades(villager);
    if (!trades || trades.length === 0) {
      sendPrivateMessage(`❌ No se pudieron obtener trades después de 3 intentos.`);
      return;
    }

    villagerTrades[villager.id] = trades;
    saveState();
    sendPrivateMessage(`✅ Aldeano registrado con ${trades.length} ofertas.`);
    if (window) window.close();
  } catch (err) {
    console.error('Error leyendo trades:', err.message);
    sendPrivateMessage(`❌ Error: ${err.message}`);
  }
}

async function investigateAllVillagers() {
  const vs=Object.values(bot.entities).filter(e=>{
    if(e.name!=='villager'&&e.name!=='villager_v2') return false
    const p=e.metadata?.[18]?.profession; return p&&p!=='none'&&p!=='nitwit'
  })
  if(!vs.length){sendPrivateMessage('❌ Sin aldeanos con oficio.');return}
  sendPrivateMessage(`🔍 Escaneando ${vs.length} aldeanos...`)
  const names={farmer:'granjero',librarian:'bibliotecario',cleric:'clérigo',armorer:'armero',weaponsmith:'herrero armas',toolsmith:'herrero herr.',butcher:'carnicero',leatherworker:'peletero',mason:'albañil',fletcher:'flechero',shepherd:'pastor',fisherman:'pescador',cartographer:'cartógrafo'}
  let ok=0,fail=0
  for(let i=0;i<vs.length;i++){
    const v=vs[i]; if(!v.isValid){fail++;continue}
    const prof=v.metadata?.[18]?.profession||'?'
    sendPrivateMessage(`🔎 ${i+1}/${vs.length}: ${names[prof]||prof}`)
    try{
      if(!await safeGoto(v.position.x,v.position.y,v.position.z,3)){fail++;continue}
      await sleep(500); if(!v.isValid){fail++;continue}
      let win=null
      try{win=await bot.openVillager(v);await sleep(300)}catch{sendPrivateMessage('  ⚠️ No responde');fail++;continue}
      const trades=win?.trades
      if(trades?.length){
        villagerTrades[v.id]=trades; ok++
        if(prof==='librarian'){
          const books=trades.filter(t=>t.outputItem?.name==='enchanted_book')
          if(books.length){
            sendPrivateMessage('  📚 Encantamientos:')
            for(const t of books){
              try{const e=t.outputItem.nbt?.value?.StoredEnchantments?.value?.value;if(e)for(const en of e)sendPrivateMessage(`    • ${en.id.value.replace('minecraft:','')} ${en.lvl.value}`)}catch{}
            }
          }
        }
        sendPrivateMessage(`  ✅ ${trades.length} ofertas`)
      }else{sendPrivateMessage('  ⚠️ Sin ofertas');fail++}
      try{win?.close()}catch{}
    }catch(e){sendPrivateMessage(`  ❌ ${(e.message||'').substring(0,40)}`);fail++}
    if(i<vs.length-1) await sleep(2000)
  }
  saveState(); sendPrivateMessage(`📊 ${ok} OK, ${fail} fallidos`)
}

// ===================== OPTIMIZAR ALDEA =====================
async function tradeWithFletcher(fletcher) {
  if (!villagerTrades[fletcher.id]) return false;
  try {
    await safeGoto(fletcher.position.x, fletcher.position.y, fletcher.position.z, 3);
    await sleep(500);
    if (!fletcher.isValid) return false;
    const win = await managerBot.openVillager(fletcher);
    await sleep(300);
    const trades = win.trades;
    if (!trades?.length) { win.close(); return false; }
    let done = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (!t.inputItem1 || t.uses >= t.maxUses) continue;
      const needsStick = (t.inputItem1?.name === 'stick') || (t.inputItem2?.name === 'stick');
      if (!needsStick) continue;
      const need = (t.inputItem1?.name === 'stick' ? t.inputItem1.count : 0) + (t.inputItem2?.name === 'stick' ? t.inputItem2.count : 0);
      if (managerBot.inventory.items().filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0) < need) continue;
      try {
        if (typeof win.trade === 'function') await win.trade(i);
        else if (typeof win.selectTrade === 'function') { win.selectTrade(i); await sleep(200); await managerBot.clickWindow(2, 0, 0); }
        done++;
        await sleep(600);
      } catch (e) { console.error('trade:', e.message); }
    }
    try { win.close(); } catch {}
    return done > 0;
  } catch (e) { console.error('tradeWithFletcher:', e.message); return false; }
}

async function optimizeVillage() {
  sendPrivateMessage('🎯 Optimizando aldea...');
  try {
    await investigateAllVillagers();
    await sleep(2000);
    tradingActive = true;
    let cycles = 0;
    while (tradingActive && cycles < 100) {
      cycles++;
      await checkHealthAndHunger();
      // Asegurar sticks
      const sticks = managerBot.inventory.items().filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0);
      if (sticks < 128) {
        const tree = findCompleteTree(30);
        if (tree) { await cutTree(tree); await processWoodToSticks(); }
      }
      // Trade con flecheros
      const fletchers = Object.values(managerBot.entities).filter(e => (e.name === 'villager' || e.name === 'villager_v2') && e.metadata?.[18]?.profession === 'fletcher');
      if (!fletchers.length) { await sleep(10000); continue; }
      for (const f of fletchers) { try { await tradeWithFletcher(f); await sleep(1500); } catch { } }
      await sleep(5000);
    }
    sendPrivateMessage('🎯 Optimización completada');
  } catch (e) { sendPrivateMessage(`❌ Error: ${e.message}`); }
  finally { tradingActive = false; }
}

// ===================== ALDEA =====================
async function findVillage() {
  const startX = Math.floor(managerBot.entity.position.x);
  const startY = Math.floor(managerBot.entity.position.y);
  const startZ = Math.floor(managerBot.entity.position.z);

  const beds = [];
  const workBlocks = [];
  const bells = [];
  const villagers = [];

  sendPrivateMessage('🔍 Buscando aldea en radio de 64 bloques...');

  for (let x = startX - VILLAGE_RADIUS; x <= startX + VILLAGE_RADIUS; x++) {
    for (let z = startZ - VILLAGE_RADIUS; z <= startZ + VILLAGE_RADIUS; z++) {
      for (let y = Math.max(0, startY - 10); y <= Math.min(255, startY + 10); y++) {
        const block = managerBot.blockAt(new Vec3(x, y, z));
        if (!block) continue;
        if (block.name === 'bed') {
          beds.push({ x, y, z });
        } else if (VILLAGE_BLOCKS.has(block.name)) {
          if (block.name === 'bell') {
            bells.push({ x, y, z });
          } else {
            workBlocks.push({ x, y, z });
          }
        }
      }
    }
  }

  Object.values(managerBot.entities).forEach(entity => {
    if (entity.type === 'mob' && (entity.name === 'villager' || entity.name === 'villager_v2')) {
      const dist = entity.position.distanceTo(managerBot.entity.position);
      if (dist <= VILLAGE_RADIUS) villagers.push(entity);
    }
  });

  const totalIndicators = beds.length + workBlocks.length + bells.length + villagers.length;
  if (totalIndicators < 3) {
    sendPrivateMessage('❌ No encontré suficientes indicadores de aldea.');
    return false;
  }

  const allPoints = [...beds, ...workBlocks, ...bells, ...villagers.map(v => v.position)];
  const centerX = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length;
  const centerY = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length;
  const centerZ = allPoints.reduce((sum, p) => sum + p.z, 0) / allPoints.length;

  villageLocation = { x: Math.floor(centerX), y: Math.floor(centerY), z: Math.floor(centerZ) };

  let nearestBed = null;
  let minDist = Infinity;
  for (const bed of beds) {
    const dist = Math.sqrt((bed.x - centerX) ** 2 + (bed.z - centerZ) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearestBed = bed;
    }
  }
  villageBedLocation = nearestBed;

  saveState();
  sendPrivateMessage(`🏘️ Aldea encontrada en ${villageLocation.x} ${villageLocation.y} ${villageLocation.z}`);
  sendPrivateMessage(`🛏️ Cama de aldea: ${villageBedLocation ? `${villageBedLocation.x} ${villageBedLocation.y} ${villageBedLocation.z}` : 'ninguna'}`);
  return true;
}

// ===================== DEFENSA =====================
// ===================== COMBATE - FUNCIONES =====================
function getNearestHostile(maxDist) {
  return Object.values(managerBot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) && e.position.distanceTo(managerBot.entity.position) < maxDist)
    .sort((a, b) => a.position.distanceTo(managerBot.entity.position) - b.position.distanceTo(managerBot.entity.position))[0] ?? null;
}

function getMobsAttackingVillagers(maxDist) {
  const villagers = Object.values(managerBot.entities).filter(e => e.type === 'mob' && (e.name === 'villager' || e.name === 'villager_v2'));
  if (!villagers.length) return [];
  return Object.values(managerBot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) && e.position.distanceTo(managerBot.entity.position) <= maxDist && villagers.some(v => e.position.distanceTo(v.position) < 8))
    .sort((a, b) => Math.min(...villagers.map(v => a.position.distanceTo(v.position))) - Math.min(...villagers.map(v => b.position.distanceTo(v.position))));
}

function getHostileNearVillage(center, radius = 32) {
  return Object.values(managerBot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_MOBS.includes(e.name) && e.position.distanceTo(managerBot.entity.position) < 32 && center && e.position.distanceTo(new Vec3(center.x, center.y, center.z)) < radius)
    .sort((a, b) => a.position.distanceTo(managerBot.entity.position) - b.position.distanceTo(managerBot.entity.position))[0] ?? null;
}

function evaluateThreat(mob) {
  const sp = SPECIAL_MOBS[mob.name];
  const d = mob.position.distanceTo(managerBot.entity.position);
  let t = (sp ? 30 : 0) + (sp?.strategy === 'hit_and_run' ? 20 : 0);
  t += d < 2 ? 40 : d < 4 ? 20 : d < 6 ? 10 : 0;
  t += managerBot.health < HUNT_CONFIG.retreatHealth ? 50 : managerBot.health < HUNT_CONFIG.safeHealth ? 25 : 0;
  return { level: t, shouldEngage: t < 60 && managerBot.health > HUNT_CONFIG.retreatHealth, strategy: sp?.strategy || 'normal' };
}

function hasShield() {
  const offHand = managerBot.inventory.slots[45];
  return offHand && offHand.name === 'shield';
}

async function equipShield() {
  if (hasShield()) return true;
  const s = managerBot.inventory.items().find(i => i.name === 'shield');
  if (s) { await managerBot.equip(s, 'off-hand'); return true; }
  return false;
}

async function useShield(dur = HUNT_CONFIG.blockDuration) {
  if (!hasShield() || Date.now() - lastShieldUse < 100) return false;
  lastShieldUse = Date.now();
  try { managerBot.activateItem(); setTimeout(() => { if (currentCombatState === CombatState.BLOCKING) managerBot.deactivateItem(); }, dur * 50); return true; } catch { return false; }
}

function stopShield() { if (hasShield()) managerBot.deactivateItem(); }

async function equipBestWeapon() {
  const hand = managerBot.inventory.slots[36];
  if (hand && WEAPON_PRIORITY.includes(hand.name)) return hand.name;
  for (const n of WEAPON_PRIORITY) {
    const w = managerBot.inventory.items().find(i => i.name === n);
    if (w) { await managerBot.equip(w, 'hand'); return n; }
  }
  // Craftear espada de piedra si tiene crafting table
  if (craftingTableLocation) {
    const cobble = managerBot.inventory.items().filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);
    if (cobble < 2) await mineCobblestone(2 - cobble);
    await processWoodToSticks();
    try {
      await safeGoto(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z, 2);
      const table = managerBot.blockAt(new Vec3(craftingTableLocation.x, craftingTableLocation.y, craftingTableLocation.z));
      const recipe = managerBot.recipesFor(mcData.itemsByName['stone_sword']?.id, null, 1, table);
      if (recipe.length) {
        await managerBot.craft(recipe[0], 1, table);
        const sword = managerBot.inventory.items().find(i => i.name === 'stone_sword');
        if (sword) { await managerBot.equip(sword, 'hand'); return 'stone_sword'; }
      }
    } catch {}
  }
  return null;
}

async function attackMob(mob) {
  if (!mob?.isValid) return false;
  try { managerBot.lookAt(mob.position.offset(0, 1, 0)); await managerBot.attack(mob); return true; } catch { return false; }
}

async function fightMob(mob) {
  if (!mob?.isValid) return false;
  if (!await equipBestWeapon()) { sendPrivateMessage('⚠️ Sin arma'); return false; }
  await equipShield();
  currentTarget = mob;
  currentCombatState = CombatState.APPROACHING;
  while (mob.isValid && currentCombatState !== CombatState.RETREATING) {
    if (managerBot.health < HUNT_CONFIG.retreatHealth) { currentCombatState = CombatState.RETREATING; break; }
    if (mob.position.distanceTo(managerBot.entity.position) > HUNT_CONFIG.combatRange) {
      await safeSetGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, HUNT_CONFIG.combatRange));
    } else {
      if (hasShield() && Math.random() < HUNT_CONFIG.blockChance) await useShield(10);
      await attackMob(mob);
    }
    await managerBot.waitForTicks(HUNT_CONFIG.attackCooldown);
  }
  currentCombatState = CombatState.IDLE;
  currentTarget = null;
  stopShield();
  return !mob.isValid;
}

async function mineCobblestone(amount) {
  let n = 0;
  while (n < amount) {
    const stone = managerBot.findBlock(b => b && (b.name === 'stone' || b.name === 'cobblestone'), 32);
    if (!stone) break;
    await safeGoto(stone.position.x, stone.position.y, stone.position.z, 1);
    await managerBot.dig(stone);
    n++;
    await sleep(100);
  }
}

// ===================== PATRULLA Y CUIDAME =====================
async function patrol() {
  patrolActive = true;
  sendPrivateMessage('🛡️ Patrullando...');
  const center = villageLocation ? { ...villageLocation } : null;
  let angle = 0;
  while (patrolActive) {
    await checkHealthAndHunger();
    const attackers = getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius);
    if (attackers.length) { sendPrivateMessage(`⚔️ ${attackers[0].name} ataca aldeano!`); await fightMob(attackers[0]); await pickupNearbyItems(); continue; }
    if (center) {
      const near = getHostileNearVillage(center, 20);
      if (near && evaluateThreat(near).shouldEngage) { sendPrivateMessage(`⚠️ ${near.name} cerca`); await fightMob(near); await pickupNearbyItems(); continue; }
      angle += 0.1;
      const tx = center.x + Math.cos(angle) * 20;
      const tz = center.z + Math.sin(angle) * 20;
      if (Math.hypot(tx - managerBot.entity.position.x, tz - managerBot.entity.position.z) > 5) {
        try { await safeSetGoal(new goals.GoalNear(tx, managerBot.entity.position.y, tz, 3)); } catch {}
      }
    } else {
      const p = managerBot.entity.position;
      const a = (Date.now() / 1000) % (Math.PI * 2);
      try { await safeSetGoal(new goals.GoalNear(p.x + Math.cos(a) * 10, p.y, p.z + Math.sin(a) * 10, 5)); } catch {}
    }
    await managerBot.waitForTicks(10);
  }
}

function stopPatrol() { patrolActive = false; sendPrivateMessage('🛡️ Patrulla detenida'); }

async function startCuidame() {
  cuidameMode = true;
  followingPlayer = true;
  sendPrivateMessage('🛡️ CUIDAME activado');
  startFollowing(MASTER);
  while (cuidameMode && followingPlayer) {
    await checkHealthAndHunger();
    const attackers = getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius);
    if (attackers.length) { await fightMob(attackers[0]); await pickupNearbyItems(); continue; }
    const mob = getNearestHostile(HUNT_CONFIG.awarenessRadius);
    if (mob && evaluateThreat(mob).shouldEngage) { await fightMob(mob); await pickupNearbyItems(); }
    await managerBot.waitForTicks(5);
  }
}

function stopCuidame() {
  cuidameMode = false;
  stopFollowing();
  sendPrivateMessage('🛡️ CUIDAME desactivado');
}

function pickupNearbyItems() {
  const items = Object.values(managerBot.entities).filter(e => e.name === 'item' && e.position.distanceTo(managerBot.entity.position) < 5);
  for (const i of items) {
    try { safeSetGoal(new goals.GoalNear(i.position.x, i.position.y, i.position.z, 1), true); sleep(200); } catch {}
  }
}

function startDodgeSystem() {
  if (dodgeInterval) clearInterval(dodgeInterval);
  dodgeInterval = setInterval(async () => {
    if (isDodging || !DODGE_CONFIG.enabled) return;
    const mob = getNearestHostile(DODGE_CONFIG.detectionRadius);
    if (!mob) return;
    const we = explorationActive, ww = woodcuttingActive, wm = miningActive, wf = followingPlayer;
    if (we) explorationActive = false;
    if (ww) woodcuttingActive = false;
    if (wm) miningActive = false;
    if (wf) { followingPlayer = false; if (followInterval) clearInterval(followInterval); followInterval = null; }
    managerBot.pathfinder.setGoal(null);
    isDodging = true;
    try {
      const pos = managerBot.entity.position;
      const mp = mob.position;
      const dx = pos.x - mp.x;
      const dz = pos.z - mp.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      await safeSetGoal(new goals.GoalNear(pos.x + (dx / len) * DODGE_CONFIG.safeDistance, pos.y, pos.z + (dz / len) * DODGE_CONFIG.safeDistance, 2), true);
      await managerBot.waitForTicks(20);
    } catch (e) { console.error('dodge:', e); }
    finally {
      isDodging = false;
      if (we) explorationActive = true;
      if (ww) woodcuttingActive = true;
      if (wm) miningActive = true;
      if (wf) { followingPlayer = true; startFollowing(MASTER); }
    }
  }, DODGE_CONFIG.checkInterval);
}

async function dodgeMob(mob) {
  const pos = managerBot.entity.position;
  const mobPos = mob.position;
  const dx = pos.x - mobPos.x;
  const dz = pos.z - mobPos.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const flee = new Vec3(pos.x + (dx / len) * 8, pos.y, pos.z + (dz / len) * 8);
  await safeSetGoal(new goals.GoalNear(flee.x, flee.y, flee.z, 2), true);
}

// ===================== DORMIR =====================
async function sleepInBed() {
  let bedLoc = bedLocation || villageBedLocation;
  if (!bedLoc) {
    sendPrivateMessage('❌ No hay cama registrada (ni personal ni de aldea).');
    return;
  }
  await safeGoto(bedLoc.x, bedLoc.y, bedLoc.z, 2);
  const bed = managerBot.blockAt(new Vec3(bedLoc.x, bedLoc.y, bedLoc.z));
  if (!bed?.name.includes('bed')) {
    sendPrivateMessage('❌ No encuentro la cama.');
    return;
  }
  try {
    await managerBot.sleep(bed);
    sendPrivateMessage('💤 Durmiendo...');
    managerBot.once('wake', () => sendPrivateMessage('☀️ Buenos días!'));
  } catch (err) {
    sendPrivateMessage(`❌ No puedo dormir: ${err.message}`);
  }
}

// ===================== SEGUIMIENTO =====================
function startFollowing(username) {
  if (followInterval) clearInterval(followInterval);
  followInterval = setInterval(() => {
    if (!followingPlayer && autoFollowEnabled && !miningActive && !huntingActive && !explorationActive) {
      const target = managerBot.players[MASTER]?.entity;
      if (target && target.position.distanceTo(managerBot.entity.position) > 3) {
        safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true);
      }
      return;
    }
    if (!followingPlayer) return;
    if (miningActive || huntingActive || pathfindingLock) return;
    const target = managerBot.players[username]?.entity;
    if (target) safeSetGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3), true);
  }, 1000);
}

function stopFollowing() {
  followingPlayer = false;
  if (followInterval) clearInterval(followInterval);
  followInterval = null;
  try { managerBot.pathfinder.setGoal(null); } catch {}
}

// ===================== EXPLORACIÓN =====================
async function exploreChunks() {
  if (!explorationActive) return;
  const cx = Math.floor(managerBot.entity.position.x / 16);
  const cz = Math.floor(managerBot.entity.position.z / 16);
  const nextX = cx + (Math.random() > 0.5 ? 1 : -1);
  const nextZ = cz + (Math.random() > 0.5 ? 1 : -1);
  await safeGoto(nextX * 16 + 8, managerBot.entity.position.y, nextZ * 16 + 8, 8);
  setTimeout(() => { if (explorationActive) exploreChunks(); }, 5000);
}

function startExploration() {
  if (explorationActive) return;
  explorationActive = true;
  exploreChunks();
}

function stopExploration() {
  explorationActive = false;
}

// ===================== PICKUP DE ITEMS =====================
function pickupNearbyItems() {
  const items = Object.values(managerBot.entities).filter(e => e.name === 'item' && e.position.distanceTo(managerBot.entity.position) < 3);
  if (items.length > 0) {
    console.log(`📦 Recogiendo ${items.length} items cercanos`);
  }
}

// ===================== ESTADO =====================
function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    chestLocation = data.chestLocation ?? null;
    craftingTableLocation = data.craftingTableLocation ?? null;
    bedLocation = data.bedLocation ?? null;
    villageLocation = data.villageLocation ?? null;
    villageBedLocation = data.villageBedLocation ?? null;
    villagerTrades = data.villagerTrades ?? {};
    console.log('📂 Estado cargado:', data);
  } catch {
    console.log('📂 Sin estado previo, arrancando limpio.');
  }
}

function saveState() {
  const data = { chestLocation, craftingTableLocation, bedLocation, villageLocation, villageBedLocation, villagerTrades };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const parts = message.split(' ');
  const cmd = parts[0].toLowerCase();

  if (cmd === 'ayuda' || cmd === 'help' || cmd === 'aiuda') {
    sendPrivateMessage('📋 COMANDOS MANAGER:');
    sendPrivateMessage('🎖️ ENJAMBRE: levantar [rol] [cantidad], estado, matar [nombre], dispersión');
    sendPrivateMessage('🚶 MOVIMIENTO: explora, explorar, sigue, bancá, quieto, auto');
    sendPrivateMessage('⚔️ COMBATE: patrulla, cuidame, atacar, para patrulla, para cuidame');
    sendPrivateMessage('🏘️ ALDEA: busca aldea, ofertas, trades, investigar, optimizar, entidades, dormi');
    sendPrivateMessage('📦 INVENTARIO: cofre x y z, mesa x y z, cama x y z, deposita, pos, salud, data');
    return;
  }

  if (cmd === 'pos') {
    const p = managerBot.entity.position;
    sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`);
    return;
  }

  if (cmd === 'salud') {
    sendPrivateMessage(`❤️ Vida:${Math.round(managerBot.health)}/20 🍗 Hambre:${Math.round(managerBot.food)}/20`);
    return;
  }

  if (cmd === 'data') {
    sendPrivateMessage(`📦 Cofre: ${chestLocation ? `${chestLocation.x} ${chestLocation.y} ${chestLocation.z}` : 'no'}`);
    sendPrivateMessage(`🛏️ Cama: ${bedLocation ? `${bedLocation.x} ${bedLocation.y} ${bedLocation.z}` : 'no'}`);
    sendPrivateMessage(`🏘️ Aldea: ${villageLocation ? `${villageLocation.x} ${villageLocation.y} ${villageLocation.z}` : 'no'}`);
    sendPrivateMessage(`🛏️ Cama aldea: ${villageBedLocation ? `${villageBedLocation.x} ${villageBedLocation.y} ${villageBedLocation.z}` : 'no'}`);
    return;
  }

  if (cmd === 'cofre' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number);
    if ([x, y, z].some(isNaN)) return;
    chestLocation = { x, y, z };
    saveState();
    sendPrivateMessage(`✅ Cofre guardado en ${x} ${y} ${z}`);
    return;
  }

  if (cmd === 'mesa' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number);
    if ([x, y, z].some(isNaN)) return;
    craftingTableLocation = { x, y, z };
    saveState();
    sendPrivateMessage(`✅ Mesa guardada en ${x} ${y} ${z}`);
    return;
  }

  if (cmd === 'cama' && parts.length === 4) {
    const [x, y, z] = parts.slice(1).map(Number);
    if ([x, y, z].some(isNaN)) return;
    bedLocation = { x, y, z };
    saveState();
    sendPrivateMessage(`✅ Cama guardada en ${x} ${y} ${z}`);
    return;
  }

  if (cmd === 'explora' || cmd === 'explorar') {
    if (explorationActive) {
      stopExploration();
      sendPrivateMessage('🛑 Exploración detenida.');
    } else {
      startExploration();
      sendPrivateMessage('🧭 Exploración iniciada.');
    }
    return;
  }

  if (cmd === 'seguime' || cmd === 'sigue') {
    autoFollowEnabled = true;
    followingPlayer = true;
    startFollowing(MASTER);
    sendPrivateMessage('🏃 Siguiendo al maestro...');
    return;
  }

  if (cmd === 'quieto' || cmd === 'bancá' || cmd === 'banca') {
    autoFollowEnabled = false;
    stopFollowing();
    sendPrivateMessage('🚫 Me quedo quieto.');
    return;
  }

  if (cmd === 'auto') {
    autoFollowEnabled = !autoFollowEnabled;
    sendPrivateMessage(autoFollowEnabled ? '✅ Modo auto ACTIVADO' : '❌ Modo auto DESACTIVADO');
    if (autoFollowEnabled && !followingPlayer) {
      followingPlayer = true;
      startFollowing(MASTER);
    }
    return;
  }

  if (cmd === 'deposita') {
    await depositInChest();
    return;
  }

   if(cmd==='dormi'){await sleepInBed();return}

  if (cmd === 'busca' && parts[1] === 'aldea') {
    await findVillage();
    return;
  }

  if (cmd === 'ofertas') {
    const profession = parts.length > 1 ? parts[1] : null;
    await readVillagerTrades(profession);
    return;
  }

  if (cmd === 'investigar') {
    await investigateAllVillagers();
    return;
  }

  // === OPTIMIZAR ALDEA ===
  if (cmd === 'optimizar') {
    await optimizeVillage();
    return;
  }

  if (cmd === 'trades') {
    const uuids = Object.keys(villagerTrades);
    if (uuids.length === 0) {
      sendPrivateMessage('❌ No hay aldeanos registrados. Usa "ofertas" para registrar uno.');
      return;
    }
    if (parts.length === 1) {
      sendPrivateMessage(`📜 Aldeanos registrados (${uuids.length}):`);
      uuids.forEach((uuid, index) => {
        const trades = villagerTrades[uuid];
        sendPrivateMessage(`  ${index + 1}. UUID: ${uuid.slice(-8)} - ${trades.length} ofertas`);
      });
      sendPrivateMessage('Usa "trades <número>" para ver detalles de uno.');
    } else {
      const num = parseInt(parts[1]) - 1;
      if (isNaN(num) || num < 0 || num >= uuids.length) {
        sendPrivateMessage('❌ Número inválido.');
        return;
      }
      const uuid = uuids[num];
      const trades = villagerTrades[uuid];
      sendPrivateMessage(`📜 Ofertas del aldeano ${num + 1} (UUID: ${uuid.slice(-8)}):`);
      for (let i = 0; i < trades.length; i += 3) {
        const batch = trades.slice(i, i + 3);
        batch.forEach((trade, index) => {
          const input1 = trade.inputItem1 ? `${trade.inputItem1.count}x ${trade.inputItem1.name}` : '?';
          const input2 = trade.inputItem2 ? ` + ${trade.inputItem2.count}x ${trade.inputItem2.name}` : '';
          const output = trade.outputItem ? `${trade.outputItem.count}x ${trade.outputItem.name}` : '?';
          const uses = `${trade.uses}/${trade.maxUses}`;
          const xp = trade.xp || 0;
          sendPrivateMessage(`  ${i + index + 1}. ${input1}${input2} → ${output} (usos: ${uses}, XP: ${xp})`);
        });
        if (i + 3 < trades.length) await sleep(1000);
      }
    }
    return;
  }

  if (cmd === 'dormi') {
    await sleepInBed();
    return;
  }

  if (cmd === 'entidades') {
    const entities = Object.values(managerBot.entities).filter(e => e.position.distanceTo(managerBot.entity.position) < 32);
    const counts = {};
    entities.forEach(e => {
      counts[e.name] = (counts[e.name] || 0) + 1;
    });
    const summary = Object.entries(counts).map(([name, count]) => `${count}x ${name}`).join(', ');
    sendPrivateMessage(`📋 Entidades cercanas: ${summary || 'ninguna'}`);
    return;
  }

  // === COMANDOS DE ENJAMBRE ===
  if (cmd === 'levantar' && parts.length >= 2) {
    const role = parts[1].toLowerCase();
    const count = parts[2] ? parseInt(parts[2]) : 1;

    for (let i = 0; i < count; i++) {
      const botName = `${role.charAt(0).toUpperCase() + role.slice(1)}_${Math.floor(Math.random() * 1000)}`;
      
      const worker = spawn('node', ['worker.js', botName, role], {
        stdio: 'inherit',
        env: { ...process.env }
      });

      activeWorkers.set(botName, worker);
    }
    sendPrivateMessage(`🚀 Desplegando ${count} worker(s) de rol: ${role}`);
    return;
  }

  if (cmd === 'estado') {
    sendPrivateMessage(`📊 Workers activos: ${activeWorkers.size}`);
    activeWorkers.forEach((worker, name) => {
      sendPrivateMessage(`  - ${name}: ${worker.killed ? 'murió' : 'activo'}`);
    });
    return;
  }

  if (cmd === 'matar' && parts.length >= 2) {
    const targetName = parts.slice(1).join('_');
    const worker = activeWorkers.get(targetName);
    if (worker) {
      worker.kill();
      activeWorkers.delete(targetName);
      sendPrivateMessage(`💀 Worker ${targetName} eliminado.`);
    } else {
      sendPrivateMessage(`❌ Worker ${targetName} no encontrado.`);
    }
    return;
  }

  if (cmd === 'dispersión' || cmd === 'dispersar') {
    managerBot.chat('enjambre dispersión');
    sendPrivateMessage('🔓 Enjambre dispersado.');
    return;
  }

  // === COMBATE ===
  if (cmd === 'patrulla') {
    if (patrolActive) { sendPrivateMessage('⚠️ Ya estoy patrullando'); return; }
    patrol();
    return;
  }

  if (cmd === 'para' && parts[1] === 'patrulla') {
    stopPatrol();
    return;
  }

  if (cmd === 'cuidame') {
    if (cuidameMode) { sendPrivateMessage('⚠️ Ya estoy en modo CUIDAME'); return; }
    startCuidame();
    return;
  }

  if (cmd === 'para' && parts[1] === 'cuidame') {
    stopCuidame();
    return;
  }

  if (cmd === 'atacar') {
    const mob = getNearestHostile(32);
    if (!mob) { sendPrivateMessage('❌ No hay enemigos cercanos'); return; }
    sendPrivateMessage(`⚔️ Atacando ${mob.name}...`);
    await fightMob(mob);
    await pickupNearbyItems();
    return;
  }

  sendPrivateMessage('❌ Comando desconocido. Usa "ayuda" para ver comandos.');
}

// ===================== EVENTOS =====================
managerBot.on('spawn', () => {
  console.log('✅ Manager conectado');
  sendPrivateMessage('🎖️ Manager listo. Usa "ayuda" para comandos.');

  const movements = new Movements(managerBot);
  movements.allowSprinting = true;
  movements.allowParkour = true;
  movements.allowSneaking = true;
  movements.allowBreakingBlocks = false;
  managerBot.pathfinder.setMovements(movements);

  loadState();
  startDodgeSystem();
  setInterval(checkHealthAndHunger, 5000);
  setInterval(() => { if (!miningActive && !huntingActive && !followingPlayer && !depositState.active) pickupNearbyItems(); }, 30000);
  setInterval(checkInventoryAndDeposit, 10000);

  setTimeout(async () => {
    const target = managerBot.players[MASTER]?.entity;
    if (target) {
      followingPlayer = true;
      autoFollowEnabled = true;
      startFollowing(MASTER);
      sendPrivateMessage(`👋 Siguiendo a ${MASTER} automáticamente.`);
    } else {
      sendPrivateMessage(`⚠️ No encuentro a ${MASTER}. Esperando...`);
    }
  }, 2000);
});

managerBot.on('chat', (username, message) => {
  if (username !== MASTER) return;
  
  // Comandos de enjambre que se propagan a los workers
  if (message.toLowerCase().includes('enjambre')) {
    managerBot.chat(message); // Reenviar a workers
    sendPrivateMessage('📡 Orden de enjambre recibida.');
    return;
  }

  // Otros comandos
  handleCommand(message);
});

managerBot.on('whisper', async (username, message) => {
  if (username !== MASTER) {
    managerBot.chat(`/tell ${username} Solo respondo a ${MASTER}.`);
    return;
  }
  await handleCommand(message);
});

managerBot.on('time', async () => {
  const isNight = managerBot.time.timeOfDay > 12000;
  if (isNight && followingPlayer) {
    stopFollowing();
    if (bedLocation || villageBedLocation) {
      sendPrivateMessage('🌙 Se hizo de noche. Voy a dormir en la cama.');
      await sleepInBed();
    } else {
      sendPrivateMessage('🌙 Se hizo de noche. Me quedo quieto para sobrevivir.');
    }
  } else if (!isNight && !followingPlayer && autoFollowEnabled) {
    sendPrivateMessage('☀️ Amaneció. Voy hacia ti esquivando mobs.');
    followingPlayer = true;
    startFollowing(MASTER);
  }
});

managerBot.on('error', err => {
  if (err.message && err.message.includes('GoalChanged')) {
    console.log('🔄 GoalChanged ignorado');
    pathfindingLock = false;
    return;
  }
  console.error('❌ Error:', err);
  sendPrivateMessage(`❌ Error: ${err.message}`);
});

managerBot.on('end', () => {
  console.log('🔌 Manager desconectado');
  // Limpiar workers
  activeWorkers.forEach((worker) => worker.kill());
  activeWorkers.clear();
});