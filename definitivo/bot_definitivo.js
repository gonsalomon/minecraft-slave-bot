// =====================
//   BOT DEFINITIVO v3 - Leñador + Minero + Comerciante + Combatiente
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
const WOOD_BLOCKS = new Set(['oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'])
const LEAVES_BLOCKS = new Set(['oak_leaves','spruce_leaves','birch_leaves','jungle_leaves','acacia_leaves','dark_oak_leaves','mangrove_leaves','cherry_leaves','azalea_leaves','flowering_azalea_leaves'])
const TREE_HEIGHT_LIMIT = 12
const MIN_FREE_SLOTS = 4

const FOOD_PRIORITY = ['golden_carrot','cooked_porkchop','cooked_beef','cooked_mutton','cooked_salmon','cooked_chicken','cooked_cod','bread','baked_potato','carrot','apple','melon_slice','cookie','raw_beef','raw_porkchop','raw_mutton','raw_chicken','raw_salmon','raw_cod','rotten_flesh']

const HOSTILE_MOBS = ['zombie','skeleton','creeper','spider','cave_spider','witch','pillager','vindicator','ravager','blaze','ghast','piglin_brute','hoglin','wither_skeleton','enderman','silverfish','phantom','drowned','husk','stray','bogged','breeze']

const VILLAGE_BLOCKS = new Set(['bed','cartography_table','lectern','composter','blast_furnace','smoker','loom','grindstone','stonecutter','barrel','fletching_table','smithing_table','bell'])
const VILLAGE_RADIUS = 64

const PROTECTED_BLOCKS = new Set([
  'oak_stairs','spruce_stairs','birch_stairs','jungle_stairs','acacia_stairs','dark_oak_stairs','mangrove_stairs','cherry_stairs',
  'bamboo_stairs','stone_stairs','cobblestone_stairs','stone_brick_stairs','sandstone_stairs','granite_stairs','diorite_stairs','andesite_stairs',
  'brick_stairs','nether_brick_stairs','quartz_stairs','red_sandstone_stairs','purpur_stairs','prismarine_stairs','prismarine_brick_stairs',
  'dark_prismarine_stairs','polished_granite_stairs','polished_diorite_stairs','polished_andesite_stairs','mossy_cobblestone_stairs',
  'mossy_stone_brick_stairs','smooth_sandstone_stairs','smooth_quartz_stairs','end_stone_brick_stairs','blackstone_stairs',
  'polished_blackstone_stairs','polished_blackstone_brick_stairs','cut_copper_stairs','exposed_cut_copper_stairs',
  'weathered_cut_copper_stairs','oxidized_cut_copper_stairs','waxed_cut_copper_stairs',
  'oak_slab','spruce_slab','cobblestone_slab','stone_slab','ladder','scaffolding',
  'chest','crafting_table','furnace','bed','enchanting_table','torch','glass','glass_pane'
])

const TOOL_MATERIAL_MAP = {
  wooden_axe:'_planks', wooden_pickaxe:'_planks', wooden_shovel:'_planks',
  stone_axe:'cobblestone', stone_pickaxe:'cobblestone', stone_shovel:'cobblestone',
  iron_axe:'iron_ingot', iron_pickaxe:'iron_ingot', iron_shovel:'iron_ingot',
}

const PICKAXE_REQUIRED = {
  'stone':'wooden_pickaxe','cobblestone':'wooden_pickaxe','coal_ore':'wooden_pickaxe','deepslate_coal_ore':'wooden_pickaxe',
  'iron_ore':'stone_pickaxe','deepslate_iron_ore':'stone_pickaxe','lapis_ore':'stone_pickaxe','deepslate_lapis_ore':'stone_pickaxe',
  'gold_ore':'stone_pickaxe','deepslate_gold_ore':'stone_pickaxe',
  'diamond_ore':'iron_pickaxe','deepslate_diamond_ore':'iron_pickaxe',
  'emerald_ore':'iron_pickaxe','deepslate_emerald_ore':'iron_pickaxe',
  'redstone_ore':'iron_pickaxe','deepslate_redstone_ore':'iron_pickaxe',
  'obsidian':'diamond_pickaxe','ancient_debris':'diamond_pickaxe'
}

const PICKAXE_TIER = {'wooden_pickaxe':1,'stone_pickaxe':2,'golden_pickaxe':2,'iron_pickaxe':3,'diamond_pickaxe':4,'netherite_pickaxe':5}

const PICKAXE_CRAFT = {
  'wooden_pickaxe':{planks:3,sticks:2,planksType:'oak_planks'},
  'stone_pickaxe':{cobblestone:3,sticks:2},
  'iron_pickaxe':{iron_ingot:3,sticks:2},
  'golden_pickaxe':{gold_ingot:3,sticks:2},
  'diamond_pickaxe':{diamond:3,sticks:2}
}

const OPTIMAL_Y = {
  'coal_ore':96,'deepslate_coal_ore':0,'iron_ore':16,'deepslate_iron_ore':-16,
  'gold_ore':-16,'deepslate_gold_ore':-16,'lapis_ore':0,'deepslate_lapis_ore':-32,
  'diamond_ore':-58,'deepslate_diamond_ore':-58,'redstone_ore':-58,'deepslate_redstone_ore':-58,
  'emerald_ore':-16,'ancient_debris':15,'obsidian':-40
}

const WEAPON_PRIORITY = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword','netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe']
const AXE_PRIORITY = ['netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe']

const ARMOR_PRIORITY = {
  head:['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
  torso:['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
  legs:['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
  feet:['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots']
}

const CombatState = {IDLE:'idle',APPROACHING:'approaching',BLOCKING:'blocking',ATTACKING:'attacking',RETREATING:'retreating',HEALING:'healing'}
const HUNT_CONFIG = {combatRange:3,safeHealth:12,safeFood:12,retreatHealth:8,blockChance:0.7,blockDuration:20,attackCooldown:12,fallbackDistance:15,awarenessRadius:16}
const SPECIAL_MOBS = {
  creeper:{strategy:'hit_and_run',safeDistance:4},skeleton:{strategy:'shield_rush',safeDistance:2},
  spider:{strategy:'aggressive',safeDistance:2},enderman:{strategy:'avoid',safeDistance:8},
  witch:{strategy:'rush',safeDistance:3},blaze:{strategy:'ranged_dodge',safeDistance:5}
}
const DODGE_CONFIG = {enabled:true,detectionRadius:8,safeDistance:12,checkInterval:500}
const TORCH_CONFIG = {lightLevel:7}

// ===================== ESTADO GLOBAL =====================
let chestLocations = [], chestBlacklist = [], craftingTableLocation = null

function getClosestChest() {
  if (!chestLocations.length) return null
  const pos = bot.entity.position
  return chestLocations
    .filter(c => !chestBlacklist.some(b => b.x===c.x && b.y===c.y && b.z===c.z))
    .sort((a,b) => Math.hypot(a.x-pos.x,a.z-pos.z) - Math.hypot(b.x-pos.x,b.z-pos.z))[0] ?? null
}
function getChestLocation() { return chestLocations[0] ?? null }
function isChestBlacklisted(x,y,z) { return chestBlacklist.some(c=>c.x===x&&c.y===y&&c.z===z) }

let bedLocation=null, villageLocation=null, villageBedLocation=null, mineLocation=null, villagerTrades={}
let explorationActive=false, woodcuttingActive=false
let miningActive=false, miningTarget=null, currentChunkMining=null
let pendingConfirmation=null, pendingDirectionConfirmation=null
let tradingActive=false, huntingActive=false, patrolActive=false
let following=false, followInterval=null, autoFollowEnabled=false, cuidameMode=false
let currentCombatState=CombatState.IDLE, currentTarget=null, lastShieldUse=0
let pathfindingLock=false, pendingGoal=null
let isEating=false, isDodging=false, dodgeInterval=null
let lastChunkX=0, lastChunkZ=0

const STATE_FILE = './definitivo_state.json'
const MINING_STATE_FILE = './mining_state.json'

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(STATE_FILE,'utf8'))
    chestLocations=d.chestLocations??[]; chestBlacklist=d.chestBlacklist??[]
    craftingTableLocation=d.craftingTableLocation??null; bedLocation=d.bedLocation??null
    villageLocation=d.villageLocation??null; villageBedLocation=d.villageBedLocation??null
    mineLocation=d.mineLocation??null; villagerTrades=d.villagerTrades??{}
    console.log('📂 Estado cargado')
  } catch { console.log('📂 Sin estado previo') }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({chestLocations,chestBlacklist,craftingTableLocation,bedLocation,villageLocation,villageBedLocation,mineLocation,villagerTrades},null,2))
}

function saveMiningProgress() {
  if (!miningActive) return
  fs.writeFileSync(MINING_STATE_FILE, JSON.stringify({
    active:miningActive, target:miningTarget,
    chunkX:currentChunkMining?.chunkX, chunkZ:currentChunkMining?.chunkZ,
    startX:currentChunkMining?.startX, startZ:currentChunkMining?.startZ,
    layer:currentChunkMining?.startY,
    posX:Math.floor(bot.entity.position.x), posZ:Math.floor(bot.entity.position.z)
  },null,2))
}

function loadMiningProgress() {
  try { const d=JSON.parse(fs.readFileSync(MINING_STATE_FILE,'utf8')); if(d.active&&d.target) return d } catch {}
  return null
}
function clearMiningProgress() { if(fs.existsSync(MINING_STATE_FILE)) fs.unlinkSync(MINING_STATE_FILE) }

// ===================== UTILS =====================
function sendPrivateMessage(msg) {
  if (MASTER && bot.players[MASTER]) bot.chat(`/tell ${MASTER} ${msg}`)
  else console.log(`[→${MASTER}] ${msg}`)
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)) }

async function safeSetGoal(goal, priority=false) {
  if (pathfindingLock) { pendingGoal={goal,priority}; return false }
  try {
    pathfindingLock=true; bot.pathfinder.setGoal(goal,priority); return true
  } finally {
    setTimeout(()=>{
      pathfindingLock=false
      if(pendingGoal){const{goal,priority}=pendingGoal;pendingGoal=null;safeSetGoal(goal,priority)}
    },1000)
  }
}

async function safeGoto(x, y, z, range=2) {
  let w=0
  while(pathfindingLock && w<30){await sleep(100);w++}
  if(pathfindingLock){pathfindingLock=false;try{bot.pathfinder.setGoal(null)}catch{};await sleep(50)}
  try{bot.pathfinder.setGoal(null)}catch{}
  setSprintMode(false)
  try {
    pathfindingLock=true
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(x,y,z,range)),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('safeGoto_timeout')),30000))
    ])
    return true
  } catch(e) {
    if(!e.message?.includes('GoalChanged')&&!e.message?.includes('timeout')&&!e.message?.includes('Timeout'))
      console.error('⚠️ safeGoto:',e.message)
    try{bot.pathfinder.setGoal(null)}catch{}
    return false
  } finally { setSprintMode(true); pathfindingLock=false }
}

function setSprintMode(enabled) {
  const m=new Movements(bot); m.allowSprinting=enabled; m.allowParkour=true; m.allowSneaking=true
  bot.pathfinder.setMovements(m)
}

function hasFreeSlots(required=MIN_FREE_SLOTS) { return (36-bot.inventory.items().length)>=required }

function hasLavaNearby(pos) {
  return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>{
    const b=bot.blockAt(pos.offset(dx,dy,dz))
    return b&&(b.name==='lava'||b.name==='flowing_lava')
  })
}

function getInventoryHash() {
  return bot.inventory.items()
    .filter(i=>!i.name.includes('pickaxe')&&!i.name.includes('sword')&&!Object.values(ARMOR_PRIORITY).flat().includes(i.name)&&!FOOD_PRIORITY.includes(i.name))
    .map(i=>`${i.name}:${i.count}`).sort().join('|')
}

// ===================== COMIDA Y SALUD =====================
function findBestFood() {
  for(const n of FOOD_PRIORITY){const i=bot.inventory.items().find(i=>i.name===n);if(i)return i}
  return null
}

async function openChestSafe(block) {
  return new Promise((res,rej)=>{
    const t=setTimeout(()=>rej(new Error('Chest open timeout')),5000)
    bot.openChest(block).then(c=>{clearTimeout(t);res(c)}).catch(e=>{clearTimeout(t);rej(e)})
  })
}

async function getFoodFromChest() {
  const chest=getClosestChest(); if(!chest) return false
  try {
    await safeGoto(chest.x,chest.y,chest.z,2); await sleep(500)
    const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    if(!b?.name.includes('chest')) return false
    const c=await openChestSafe(b); let found=false
    for(const n of FOOD_PRIORITY){const i=c.containerItems().find(i=>i.name===n);if(i){await c.withdraw(i.type,null,Math.min(i.count,16));found=true;break}}
    c.close(); return found
  } catch(e){console.error('getFoodFromChest:',e.message);return false}
}

async function eatFood() {
  if(isEating) return; isEating=true
  try {
    let food=findBestFood()
    if(!food&&getClosestChest()){if(await getFoodFromChest())food=findBestFood()}
    if(!food){sendPrivateMessage('⚠️ No tengo comida');return}
    await bot.equip(food,'hand'); await bot.consume(); await sleep(500)
  } catch(e){console.error('eatFood:',e)}
  finally{isEating=false}
}

async function checkHealthAndHunger() {
  if(bot.food<18||bot.health<14) await eatFood()
}

// ===================== DEPÓSITO =====================
const depositState={active:false,lastRun:0,lastInventoryHash:null,cooldown:5000}

async function depositInChest() {
  const chest=getClosestChest(); if(!chest){sendPrivateMessage('⚠️ Sin cofre.');return}
  if(depositState.active){let w=0;while(depositState.active&&w<100){await sleep(50);w++};return}
  const hash=getInventoryHash()
  if(hash!==''&&hash===depositState.lastInventoryHash) return
  const now=Date.now()
  if(now-depositState.lastRun<depositState.cooldown) await sleep(depositState.cooldown-(now-depositState.lastRun))
  depositState.active=true; depositState.lastRun=Date.now()
  try {
    if(!await safeGoto(chest.x,chest.y,chest.z,2)) return
    const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    if(!b?.name.includes('chest')){sendPrivateMessage('No encuentro cofre.');return}
    const armorNames=new Set(Object.values(ARMOR_PRIORITY).flat())
    const keep=new Set()
    for(const i of bot.inventory.items()){
      if(i.name.includes('pickaxe')||i.name.includes('sword')||i.name.includes('axe')||armorNames.has(i.name)||(FOOD_PRIORITY.includes(i.name)&&bot.food<18))
        keep.add(i.type)
    }
    const c=await openChestSafe(b); let n=0
    for(const i of bot.inventory.items()){if(!keep.has(i.type)){await c.deposit(i.type,null,i.count);n+=i.count}}
    c.close()
    if(n>0) sendPrivateMessage(`✅ Depositados ${n} items`)
    depositState.lastInventoryHash=getInventoryHash()
    await reEquipTool()
  } catch(e){if(!e.message?.includes('GoalChanged')&&!e.message?.includes('timeout'))console.error('depositInChest:',e.message)}
  finally{depositState.active=false}
}

async function depositExcessIfNeeded() {
  if(hasFreeSlots()) return
  if(!getClosestChest()){sendPrivateMessage('⚠️ Inventario lleno y sin cofre.');return}
  await depositInChest()
}

// ===================== SEGUIMIENTO =====================
function startFollowing(username) {
  if(followInterval) clearInterval(followInterval)
  following=true
  followInterval=setInterval(()=>{
    if(!following&&autoFollowEnabled){
      const t=bot.players[MASTER]?.entity
      if(t&&t.position.distanceTo(bot.entity.position)>3)safeSetGoal(new goals.GoalNear(t.position.x,t.position.y,t.position.z,3),true)
      return
    }
    if(!following) return
    const t=bot.players[username]?.entity
    if(t) safeSetGoal(new goals.GoalNear(t.position.x,t.position.y,t.position.z,3),true)
  },1000)
}

function stopFollowing() {
  following=false
  if(followInterval){clearInterval(followInterval);followInterval=null}
  bot.pathfinder.setGoal(null)
}

// ===================== DORMIR =====================
async function sleepInBed() {
  const loc=bedLocation||villageBedLocation; if(!loc){sendPrivateMessage('❌ Sin cama.');return}
  await safeGoto(loc.x,loc.y,loc.z,2)
  const bed=bot.blockAt(new Vec3(loc.x,loc.y,loc.z))
  if(!bed?.name.includes('bed')){sendPrivateMessage('❌ No encuentro cama.');return}
  try{await bot.sleep(bed);sendPrivateMessage('💤 Durmiendo...');bot.once('wake',()=>sendPrivateMessage('☀️ Buenos días!'))}
  catch(e){sendPrivateMessage(`❌ No puedo dormir: ${e.message}`)}
}

// ===================== ALDEA =====================
function isInVillageArea(pos, extra=0) {
  if(!villageLocation) return false
  return Math.hypot(pos.x-villageLocation.x,pos.z-villageLocation.z)<=(VILLAGE_RADIUS+extra)
}

async function findVillage() {
  const sx=Math.floor(bot.entity.position.x),sy=Math.floor(bot.entity.position.y),sz=Math.floor(bot.entity.position.z)
  const beds=[],work=[],bells=[],vs=[]
  for(let x=sx-VILLAGE_RADIUS;x<=sx+VILLAGE_RADIUS;x++)
    for(let z=sz-VILLAGE_RADIUS;z<=sz+VILLAGE_RADIUS;z++)
      for(let y=Math.max(0,sy-10);y<=Math.min(255,sy+10);y++){
        const b=bot.blockAt(new Vec3(x,y,z)); if(!b) continue
        if(b.name==='bed')beds.push({x,y,z})
        else if(VILLAGE_BLOCKS.has(b.name)){if(b.name==='bell')bells.push({x,y,z});else work.push({x,y,z})}
      }
  Object.values(bot.entities).forEach(e=>{
    if(e.type==='mob'&&(e.name==='villager'||e.name==='villager_v2')&&e.position.distanceTo(bot.entity.position)<=VILLAGE_RADIUS) vs.push(e)
  })
  if(beds.length+work.length+bells.length+vs.length<3){sendPrivateMessage('❌ Sin aldea.');return false}
  const all=[...beds,...work,...bells,...vs.map(v=>v.position)]
  const cx=all.reduce((s,p)=>s+p.x,0)/all.length, cy=all.reduce((s,p)=>s+p.y,0)/all.length, cz=all.reduce((s,p)=>s+p.z,0)/all.length
  villageLocation={x:Math.floor(cx),y:Math.floor(cy),z:Math.floor(cz)}
  let nb=null,md=Infinity
  for(const b of beds){const d=Math.hypot(b.x-cx,b.z-cz);if(d<md){md=d;nb=b}}
  villageBedLocation=nb; saveState()
  sendPrivateMessage(`🏘️ Aldea en ${villageLocation.x} ${villageLocation.y} ${villageLocation.z}`)
  return true
}

// ===================== LEÑADOR =====================
async function ensureAxe() {
  const eq=bot.inventory.slots[36]; if(eq?.name.includes('axe')) return true
  const axe=bot.inventory.items().find(i=>i.name.includes('axe'))
  if(axe){await bot.equip(axe,'hand');return true}
  const logs=bot.inventory.items().filter(i=>i.name.includes('_log'))
  if(logs.length){
    await craftPlanks(logs[0].name); await sleep(300); await craftSticks(); await sleep(300)
    if(await craftTool('wooden_axe')){const a=bot.inventory.items().find(i=>i.name.includes('axe'));if(a){await bot.equip(a,'hand');return true}}
  }
  sendPrivateMessage('❌ Sin hacha'); return false
}

async function craftTool(toolName) {
  if(!craftingTableLocation){sendPrivateMessage('❌ Sin mesa');return false}
  const mk=TOOL_MATERIAL_MAP[toolName]; if(!mk) return false
  if(mk==='_planks'){for(const l of bot.inventory.items().filter(i=>i.name.includes('_log'))){await craftPlanks(l.name);await sleep(300)}}
  else if(mk==='cobblestone'){const c=bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((s,i)=>s+i.count,0);if(c<3)await mineCobblestone(3-c)}
  if(bot.inventory.items().filter(i=>i.name==='stick').reduce((s,i)=>s+i.count,0)<2) await processWoodToSticks()
  await safeGoto(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z,2)
  const table=bot.blockAt(new Vec3(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z))
  if(!table?.name.includes('crafting_table')){sendPrivateMessage('❌ Sin mesa');return false}
  const id=mcData.itemsByName[toolName]?.id; if(!id) return false
  const r=bot.recipesFor(id,null,1,table); if(!r.length) return false
  try{await bot.craft(r[0],1,table);sendPrivateMessage(`✅ Crafteado ${toolName}`);return true}
  catch(e){console.error('craftTool:',e.message);return false}
}

async function craftPlanks(logType) {
  if(!craftingTableLocation) return false
  const pt=logType.replace('_log','_planks')
  try{
    await safeGoto(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z,2)
    const table=bot.blockAt(new Vec3(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z))
    if(!table?.name.includes('crafting_table')) return false
    const li=bot.inventory.items().find(i=>i.name===logType); if(li) await bot.equip(li,'hand')
    await sleep(200)
    const r=bot.recipesFor(mcData.itemsByName[pt]?.id,null,null,table)
    if(r.length){await bot.craft(r[0],null,table);return true}
  }catch(e){console.error('craftPlanks:',e.message)}
  return false
}

async function craftSticks() {
  try{
    const p=bot.inventory.items().filter(i=>i.name.includes('_planks')).reduce((s,i)=>s+i.count,0)
    if(p<2) return false
    const r=bot.recipesFor(mcData.itemsByName['stick'].id,null,1,null)
    if(!r.length) return false
    await bot.craft(r[0],Math.floor(p/2),null); return true
  }catch(e){console.error('craftSticks:',e.message);return false}
}

async function processWoodToSticks() {
  for(const l of bot.inventory.items().filter(i=>i.name.includes('_log'))){await craftPlanks(l.name);await sleep(500)}
  await sleep(1000); await craftSticks()
}

async function mineCobblestone(amount) {
  let n=0
  while(n<amount){
    const s=bot.findBlock({matching:b=>b&&(b.name==='stone'||b.name==='cobblestone'),maxDistance:32}); if(!s) break
    await safeGoto(s.position.x,s.position.y,s.position.z,1); await bot.dig(s); n++; await sleep(100)
  }
}

function findCompleteTree(maxDistance=120) {
  try{
    const log=bot.findBlock({matching:b=>{if(!WOOD_BLOCKS.has(b?.name))return false;if(isInVillageArea(b.position))return false;return true},maxDistance})
    if(!log) return null
    const blocks=[]
    for(let y=-1;y<=TREE_HEIGHT_LIMIT;y++){const b=bot.blockAt(log.position.offset(0,y,0));if(b&&WOOD_BLOCKS.has(b.name))blocks.push(b)}
    return blocks.length?{blocks,basePos:blocks[0].position}:null
  }catch(e){console.error('findCompleteTree:',e.message);return null}
}

async function cutTree(tree) {
  woodcuttingActive=true
  if(!await ensureAxe()){woodcuttingActive=false;return false}
  for(const b of tree.blocks){
    if(!explorationActive&&!woodcuttingActive) break
    try{await safeGoto(b.position.x,b.position.y,b.position.z,2);await bot.dig(b);await sleep(100);await depositExcessIfNeeded()}
    catch(e){if(e.message?.includes('Digging aborted'))await sleep(500)}
  }
  try{await breakLeavesAround(tree.basePos);await pickupNearbyItems();await plantSapling(tree.basePos)}
  catch(e){console.error('cutTree post:',e)}
  woodcuttingActive=false; return true
}

async function breakLeavesAround(treePos) {
  const leaves=[]
  for(let dx=-3;dx<=3;dx++) for(let dy=-1;dy<=TREE_HEIGHT_LIMIT;dy++) for(let dz=-3;dz<=3;dz++){
    const b=bot.blockAt(treePos.offset(dx,dy,dz)); if(b&&LEAVES_BLOCKS.has(b.name)) leaves.push(b)
  }
  for(const l of leaves){try{await safeGoto(l.position.x,l.position.y,l.position.z,2);await bot.dig(l);await sleep(50)}catch{}}
}

async function plantSapling(basePos) {
  const s=bot.inventory.items().find(i=>i.name.includes('sapling')); if(!s) return false
  for(const [dx,,dz] of [[0,0,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
    const adj=basePos.offset(dx,0,dz)
    if(bot.blockAt(adj)?.name==='air'){
      const below=bot.blockAt(adj.offset(0,-1,0))
      if(below&&below.name!=='air'){
        await safeGoto(adj.x,adj.y,adj.z,1)
        await bot.equip(s,'hand')
        try{await bot.placeBlock(below,new Vec3(0,1,0));sendPrivateMessage('🌱 Plantada');return true}catch{}
      }
    }
  }
  return false
}

async function pickupNearbyItems() {
  const items=Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(bot.entity.position)<5)
  for(const i of items){try{await safeSetGoal(new goals.GoalNear(i.position.x,i.position.y,i.position.z,1),true);await sleep(200)}catch{}}
}

async function exploreChunks() {
  while(explorationActive){
    await checkHealthAndHunger()
    const tree=findCompleteTree(16)
    if(tree&&!woodcuttingActive){await cutTree(tree);await processWoodToSticks();await depositExcessIfNeeded();continue}
    const cx=Math.floor(bot.entity.position.x/16),cz=Math.floor(bot.entity.position.z/16)
    let nx=(cx+1)*16+8,nz=cz*16+8
    if(Math.abs(cx-lastChunkX)>5){nx=cx*16+8;nz=(cz+1)*16+8}
    lastChunkX=cx;lastChunkZ=cz
    await safeGoto(nx,bot.entity.position.y,nz,8); await sleep(2000)
  }
}

// ===================== MINERO =====================
function reportPickaxes() {
  const picks=['wooden_pickaxe','stone_pickaxe','iron_pickaxe','golden_pickaxe','diamond_pickaxe','netherite_pickaxe']
    .map(n=>({n,c:bot.inventory.items().filter(i=>i.name===n).reduce((s,i)=>s+i.count,0)}))
    .filter(p=>p.c>0)
  sendPrivateMessage(picks.length?`⛏️ Picos: ${picks.map(p=>`${p.n}:${p.c}`).join(' | ')}`:'⛏️ Sin picos')
}

async function reEquipTool() {
  if(miningActive&&miningTarget) await ensurePickaxe(miningTarget)
  else if(miningActive) await ensurePickaxe('stone')
}

async function equipPickaxe(name) {
  const item=bot.inventory.items().find(i=>i.name===name); if(item) await bot.equip(item,'hand')
}

async function getPickaxesFromChest() {
  const chest=getClosestChest(); if(!chest) return []
  try{
    await safeGoto(chest.x,chest.y,chest.z,2)
    const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z)); if(!b?.name.includes('chest')) return []
    const c=await openChestSafe(b)
    const picks=c.containerItems().filter(i=>i.name.includes('pickaxe'))
    c.close(); return picks
  }catch{return []}
}

async function ensurePickaxe(blockName) {
  const req=PICKAXE_REQUIRED[blockName]||'stone_pickaxe', reqT=PICKAXE_TIER[req]
  const eq=bot.inventory.slots[36]
  if(eq?.name.includes('pickaxe')&&(PICKAXE_TIER[eq.name]||0)>=reqT) return true
  const inv=bot.inventory.items().filter(i=>i.name.includes('pickaxe')).sort((a,b)=>(PICKAXE_TIER[b.name]||0)-(PICKAXE_TIER[a.name]||0))
  const suit=inv.find(i=>(PICKAXE_TIER[i.name]||0)>=reqT)
  if(suit){await bot.equip(suit,'hand');return true}
  // Buscar en cofre
  const chestPicks=await getPickaxesFromChest()
  const cs=chestPicks.find(p=>(PICKAXE_TIER[p.name]||0)>=reqT)
  if(cs){
    const chest=getClosestChest()
    if(chest){
      await safeGoto(chest.x,chest.y,chest.z,2)
      const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
      const c=await openChestSafe(b); await c.withdraw(cs.type,null,1); c.close()
      const np=bot.inventory.items().find(i=>i.name===cs.name); if(np){await bot.equip(np,'hand');return true}
    }
  }
  // Craftear
  sendPrivateMessage(`🔨 Crafteando pico para ${blockName}...`)
  for(const p of ['stone_pickaxe','iron_pickaxe','diamond_pickaxe']){
    if(PICKAXE_TIER[p]>=reqT&&await tryCraftPickaxe(p)){await equipPickaxe(p);sendPrivateMessage(`✅ ${p}`);return true}
  }
  sendPrivateMessage(`❌ Sin pico para ${blockName}`); return false
}

async function tryCraftPickaxe(name) {
  const r=PICKAXE_CRAFT[name]; if(!r) return false
  for(const [mat,amt] of Object.entries(r)){
    if(mat==='sticks'||mat==='planksType') continue
    const have=bot.inventory.items().filter(i=>i.name===mat).reduce((s,i)=>s+i.count,0)
    if(have<amt){
      if(mat==='cobblestone') await mineCobblestone(amt-have)
      else if(mat==='iron_ingot'){sendPrivateMessage(`⚠️ Sin ${amt-have} iron_ingot`);return false}
      else if(mat==='diamond'){sendPrivateMessage('⚠️ Sin diamantes');return false}
      else return false
    }
  }
  const sticks=bot.inventory.items().filter(i=>i.name==='stick').reduce((s,i)=>s+i.count,0)
  if(sticks<r.sticks){const logs=bot.inventory.items().filter(i=>i.name.includes('_log'));if(logs.length){await craftPlanks(logs[0].name);await craftSticks()}}
  try{
    await safeGoto(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z,2)
    const table=bot.blockAt(new Vec3(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z))
    const recipes=bot.recipesFor(mcData.itemsByName[name].id,null,1,table)
    if(!recipes.length) return false
    await bot.craft(recipes[0],1,table); return true
  }catch{return false}
}

async function ensureTorches() {
  let t=bot.inventory.items().filter(i=>i.name==='torch').reduce((s,i)=>s+i.count,0)
  if(t>=64) return true
  if(!craftingTableLocation) return false
  const coal=bot.inventory.items().filter(i=>i.name==='coal'||i.name==='charcoal').reduce((s,i)=>s+i.count,0)
  const needed=64-t, coalNeeded=Math.ceil(needed/4)
  if(coal<coalNeeded){sendPrivateMessage(`⚠️ Sin carbón (necesito ${coalNeeded})`);return false}
  if(bot.inventory.items().filter(i=>i.name==='stick').reduce((s,i)=>s+i.count,0)<Math.ceil(needed/4)) await processWoodToSticks()
  await safeGoto(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z,2)
  const table=bot.blockAt(new Vec3(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z))
  const r=bot.recipesFor(mcData.itemsByName['torch'].id,null,needed,table)
  if(r.length){await bot.craft(r[0],Math.min(needed,64),table);sendPrivateMessage('🔥 Antorchas listas');return true}
  return false
}

async function placeTorchIfNeeded() {
  if(!miningActive) return
  const pos=bot.entity.position, b=bot.blockAt(pos)
  if(b&&b.light<TORCH_CONFIG.lightLevel){
    let t=bot.inventory.items().find(i=>i.name==='torch')
    if(!t){await ensureTorches();t=bot.inventory.items().find(i=>i.name==='torch')}
    if(!t) return
    const pa=pos.offset(0,1,0)
    if(bot.blockAt(pa)?.name==='air'){
      for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){
        const sup=bot.blockAt(pa.offset(dx,dy,dz))
        if(sup&&sup.diggable===false&&sup.name!=='air'){
          await bot.equip(t,'hand'); await bot.placeBlock(sup,new Vec3(-dx,-dy,-dz)); break
        }
      }
    }
  }
}

async function safeDig(block) {
  if(!block||block.type===0) return false
  const fresh=bot.blockAt(block.position)
  if(!fresh||fresh.type===0||fresh.name==='air') return false
  if(PROTECTED_BLOCKS.has(fresh.name)) return false
  await reEquipTool()
  try{await bot.dig(fresh,true);return true}
  catch(e){if(e.message?.includes('air')||e.message?.includes('already'))return false;throw e}
}

function getSurfaceY(x,z) {
  for(let y=320;y>=-64;y--){const b=bot.blockAt(new Vec3(x,y,z));if(b&&b.name!=='air'&&b.type!==0&&b.diggable!==true)return y+1}
  return 64
}

// ===================== MINERÍA - 3 FUNCIONES PRINCIPALES =====================

// Helper compartido: bajar en escalera hasta targetY
async function digStaircaseDownToTarget(startX, startZ, targetY) {
  let x=startX, z=startZ
  while(miningActive&&Math.floor(bot.entity.position.y)>targetY){
    const curY=Math.floor(bot.entity.position.y)
    const down=bot.blockAt(new Vec3(x,curY-1,z))
    if(down?.diggable&&!down.name.includes('lava')){await safeGoto(x,curY,z,1);await safeDig(down)}
    await safeGoto(x,curY-1,z,1)
    const front=bot.blockAt(new Vec3(x+1,curY-1,z))
    if(front?.diggable&&!front.name.includes('lava')) await safeDig(front)
    await placeTorchIfNeeded()
    if(bot.inventory.emptySlotCount()<9){await depositInChest();if(!miningActive)return}
    await bot.waitForTicks(5)
  }
}

// Helper compartido: subir a la superficie desde la columna startX,startZ
async function climbUpToSurface(startX, startZ, surfaceY) {
  let x=startX, z=startZ, curY=Math.floor(bot.entity.position.y)
  while(miningActive&&curY<surfaceY){
    const up=bot.blockAt(new Vec3(x,curY+1,z))
    if(up&&up.name!=='air'){await safeDig(up);await bot.waitForTicks(5)}
    await safeGoto(x,curY+1,z,1)
    curY=Math.floor(bot.entity.position.y)
    await bot.waitForTicks(5)
  }
  sendPrivateMessage(`✅ Superficie Y=${curY}`)
}

// Helper compartido: minar capa de 2 bloques de altura en serpentina por chunk
// Incluye chequeo de inventario y bloques protegidos
async function mineChunkLayer(startX, startZ, layerY, chunkSize) {
  const mineable=new Set(['stone','deepslate','tuff','andesite','diorite','granite','gravel','dirt','sand','sandstone',
    'coal_ore','deepslate_coal_ore','iron_ore','deepslate_iron_ore','gold_ore','deepslate_gold_ore',
    'diamond_ore','deepslate_diamond_ore','emerald_ore','deepslate_emerald_ore','lapis_ore','deepslate_lapis_ore',
    'redstone_ore','deepslate_redstone_ore','copper_ore','deepslate_copper_ore'])

  for(let oz=0;oz<chunkSize&&miningActive;oz++){
    const z=startZ+oz, step=oz%2===0?1:-1
    const xStart=step>0?startX:startX+chunkSize-1
    const xEnd=step>0?startX+chunkSize-1:startX
    for(let x=xStart;(step>0?x<=xEnd:x>=xEnd);x+=step){
      if(!miningActive) return
      // Función 3: parar si inventario casi lleno
      if(bot.inventory.emptySlotCount()<9){
        await depositInChest()
        if(!miningActive) return
      }
      for(let y=layerY;y<=layerY+1;y++){
        const b=bot.blockAt(new Vec3(x,y,z))
        if(!b||b.name==='air') continue
        if(PROTECTED_BLOCKS.has(b.name)){
          sendPrivateMessage(`🛑 Bloque protegido: ${b.name} en X:${x} Y:${y} Z:${z}`)
          miningActive=false; clearMiningProgress(); return
        }
        if((b.name===miningTarget||mineable.has(b.name)||b.diggable)&&!hasLavaNearby(b.position)){
          await safeGoto(b.position.x,b.position.y,b.position.z,1)
          await safeDig(b)
          await placeTorchIfNeeded()
          await bot.waitForTicks(1)
        }
      }
    }
  }
}

// FUNCIÓN 1: minar <block>
// Baja en escalera al Y óptimo del mineral, mina capa completa, sube, avanza al siguiente chunk en +X
async function chunkMiningLoop() {
  const optY=OPTIMAL_Y[miningTarget]??-58
  if(!await ensurePickaxe(miningTarget)){miningActive=false;clearMiningProgress();return}
  const cx=Math.floor(mineLocation.x/16), cz=Math.floor(mineLocation.z/16)
  const sx=cx*16+8, sz=cz*16+8, sy=mineLocation.y
  currentChunkMining={startY:optY,currentY:optY,chunkX:cx,chunkZ:cz,startX:sx,startZ:sz}
  saveMiningProgress(); await ensureTorches()
  if(!await safeGoto(sx,sy,sz,8)||!miningActive) return
  sendPrivateMessage(`📉 Bajando a Y=${optY}...`)
  await digStaircaseDownToTarget(sx,sz,optY); if(!miningActive) return
  sendPrivateMessage(`⛏️ Minando chunk [${cx},${cz}] en Y=${optY}`)
  await mineChunkLayer(cx*16,cz*16,optY,16)
  if(!miningActive){sendPrivateMessage('🛑 Detenido (protegido)');clearMiningProgress();return}
  sendPrivateMessage('⬆️ Subiendo...')
  await climbUpToSurface(sx,sz,sy); if(!miningActive) return
  // Avanzar al siguiente chunk en +X
  const ncx=cx+1, nmx=ncx*16+8, nmz=cz*16+8, nsy=getSurfaceY(nmx,nmz)
  sendPrivateMessage(`🚶 → chunk [${ncx},${cz}]`)
  await safeGoto(nmx,nsy,nmz,8)
  mineLocation={x:nmx,y:nsy,z:nmz}; saveState()
  currentChunkMining={startY:optY,currentY:optY,chunkX:ncx,chunkZ:cz,startX:nmx,startZ:nmz}
  saveMiningProgress()
  if(miningActive) setTimeout(()=>chunkMiningLoop(),500)
}

// FUNCIÓN 2: franja <Y>
// Mina 2 bloques de altura en Y en el chunk actual, luego pregunta dirección para el próximo
async function mineStrip(targetY) {
  if(!mineLocation){sendPrivateMessage('❌ Define mina con "mina x y z"');miningActive=false;return}
  while(miningActive){
    const cx=Math.floor(mineLocation.x/16), cz=Math.floor(mineLocation.z/16)
    const sx=cx*16, sz=cz*16, centerX=sx+8, centerZ=sz+8
    const surY=getSurfaceY(centerX,centerZ)
    if(!await safeGoto(centerX,surY,centerZ,8)||!miningActive) return
    if(Math.floor(bot.entity.position.y)>targetY){
      sendPrivateMessage(`📉 Bajando a Y=${targetY}...`)
      await digStaircaseDownToTarget(centerX,centerZ,targetY)
    }
    if(!miningActive) return
    sendPrivateMessage(`⛏️ Franja Y=${targetY} en chunk [${cx},${cz}]`)
    const prevTarget=miningTarget; miningTarget=null // minar todo en esta capa
    await mineChunkLayer(sx,sz,targetY,16)
    miningTarget=prevTarget
    if(!miningActive) return
    await depositInChest()
    sendPrivateMessage('⬆️ Subiendo...')
    await climbUpToSurface(centerX,centerZ,surY); if(!miningActive) return
    // Preguntar dirección
    const dir=await askDirection(`✅ Chunk [${cx},${cz}] listo.`)
    if(!dir||dir==='para'){miningActive=false;sendPrivateMessage('🛑 Franja detenida.');clearMiningProgress();return}
    let nx=mineLocation.x, nz=mineLocation.z
    if(dir==='este') nx+=16; else if(dir==='oeste') nx-=16
    else if(dir==='sur') nz+=16; else if(dir==='norte') nz-=16
    mineLocation={x:nx,y:getSurfaceY(nx,nz),z:nz}; saveState()
    sendPrivateMessage(`🚶 → [${Math.floor(nx/16)},${Math.floor(nz/16)}]`)
  }
}

// ===================== CONFIRMACIÓN / DIRECCIÓN =====================
function askConfirmation(question) {
  return new Promise(resolve=>{
    pendingConfirmation={resolve,question}; sendPrivateMessage(`❓ ${question} (si/no)`)
    setTimeout(()=>{if(pendingConfirmation?.resolve===resolve){pendingConfirmation=null;sendPrivateMessage('⏰ Sin respuesta, asumiendo no');resolve(false)}},30000)
  })
}

function handleConfirmationResponse(resp) {
  if(!pendingConfirmation) return false
  pendingConfirmation.resolve(['si','sí','yes'].includes(resp.toLowerCase()))
  pendingConfirmation=null; return true
}

function askDirection(question) {
  return new Promise(resolve=>{
    pendingDirectionConfirmation={resolve}
    sendPrivateMessage(`❓ ${question}`)
    sendPrivateMessage('Responde: este | oeste | norte | sur | para')
    setTimeout(()=>{if(pendingDirectionConfirmation?.resolve===resolve){pendingDirectionConfirmation=null;sendPrivateMessage('⏰ Sin respuesta, deteniendo');resolve(null)}},60000)
  })
}

function handleDirectionResponse(resp) {
  if(!pendingDirectionConfirmation) return false
  if(['este','oeste','norte','sur','para'].includes(resp.toLowerCase())){
    pendingDirectionConfirmation.resolve(resp.toLowerCase()); pendingDirectionConfirmation=null; return true
  }
  return false
}

// ===================== CHEST ITEMS =====================
async function getItemFromChest(itemName, count) {
  const chest=getClosestChest(); if(!chest) return false
  try{
    await safeGoto(chest.x,chest.y,chest.z,2); await sleep(500)
    const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    const c=await openChestSafe(b)
    const item=c.containerItems().find(i=>i.name===itemName)
    if(!item){c.close();return false}
    await c.withdraw(item.type,null,Math.min(item.count,count)); c.close(); return true
  }catch(e){console.error('getItemFromChest:',e.message);return false}
}

async function getAllItemsFromChest(itemName) {
  const chest=getClosestChest(); if(!chest) return false
  try{
    await safeGoto(chest.x,chest.y,chest.z,2); await sleep(500)
    const b=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    const c=await openChestSafe(b)
    const items=c.containerItems().filter(i=>i.name===itemName)
    if(!items.length){c.close();return false}
    for(const i of items) await c.withdraw(i.type,null,i.count)
    c.close(); return true
  }catch(e){console.error('getAllItemsFromChest:',e.message);return false}
}

async function discoverChests(radius=32) {
  const pos=bot.entity.position, found=[]
  sendPrivateMessage(`🔍 Escaneando radio ${radius}...`)
  for(let x=Math.floor(pos.x)-radius;x<=Math.floor(pos.x)+radius;x++)
    for(let y=Math.floor(pos.y)-radius;y<=Math.floor(pos.y)+radius;y++)
      for(let z=Math.floor(pos.z)-radius;z<=Math.floor(pos.z)+radius;z++)
        try{
          const b=bot.blockAt(new Vec3(x,y,z))
          if(b?.name.includes('chest')&&!chestLocations.some(c=>c.x===x&&c.y===y&&c.z===z)&&!isChestBlacklisted(x,y,z)) found.push({x,y,z})
        }catch{}
  if(found.length){chestLocations.push(...found);saveState();sendPrivateMessage(`📦 ${found.length} cofres nuevos`);found.forEach((c,i)=>sendPrivateMessage(`  ${i+1}. ${c.x} ${c.y} ${c.z}`))}
  else sendPrivateMessage('📦 Sin cofres nuevos')
  return found
}

// ===================== COMERCIANTE =====================
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

async function tradeWithFletcher(fletcher) {
  if(!villagerTrades[fletcher.id]) return false
  try{
    await safeGoto(fletcher.position.x,fletcher.position.y,fletcher.position.z,3); await sleep(500)
    if(!fletcher.isValid) return false
    const win=await bot.openVillager(fletcher); await sleep(300)
    const trades=win.trades; if(!trades?.length){win.close();return false}
    let done=0
    for(let i=0;i<trades.length;i++){
      const t=trades[i]; if(!t.inputItem1||t.uses>=t.maxUses) continue
      const ns=(t.inputItem1?.name==='stick')||(t.inputItem2?.name==='stick'); if(!ns) continue
      const need=(t.inputItem1?.name==='stick'?t.inputItem1.count:0)+(t.inputItem2?.name==='stick'?t.inputItem2.count:0)
      if(bot.inventory.items().filter(i=>i.name==='stick').reduce((s,i)=>s+i.count,0)<need) continue
      try{
        if(typeof win.trade==='function') await win.trade(i)
        else if(typeof win.selectTrade==='function'){win.selectTrade(i);await sleep(200);await bot.clickWindow(2,0,0)}
        done++; await sleep(600)
      }catch(e){console.error('trade:',e.message)}
    }
    try{win.close()}catch{}; return done>0
  }catch(e){console.error('tradeWithFletcher:',e.message);return false}
}

async function optimizeVillage() {
  sendPrivateMessage('🎯 Optimizando aldea...')
  try{
    await investigateAllVillagers(); await sleep(2000)
    tradingActive=true; let cycles=0
    while(tradingActive&&cycles<100){
      cycles++; await checkHealthAndHunger()
      const sticks=bot.inventory.items().filter(i=>i.name==='stick').reduce((s,i)=>s+i.count,0)
      if(sticks<128){const tree=findCompleteTree(30);if(tree){await cutTree(tree);await processWoodToSticks()}}
      const fletchers=Object.values(bot.entities).filter(e=>(e.name==='villager'||e.name==='villager_v2')&&e.metadata?.[18]?.profession==='fletcher')
      if(!fletchers.length){await sleep(10000);continue}
      for(const f of fletchers){try{await tradeWithFletcher(f);await sleep(1500)}catch{}}
      await sleep(5000)
    }
    sendPrivateMessage('🎯 Optimización completada')
  }catch(e){sendPrivateMessage(`❌ Error: ${e.message}`)}
  finally{tradingActive=false}
}

// ===================== COMBATE =====================
function getNearestHostile(maxDist) {
  return Object.values(bot.entities)
    .filter(e=>e.type==='mob'&&HOSTILE_MOBS.includes(e.name)&&e.position.distanceTo(bot.entity.position)<maxDist)
    .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0]??null
}

function getMobsAttackingVillagers(maxDist) {
  const vs=Object.values(bot.entities).filter(e=>e.type==='mob'&&(e.name==='villager'||e.name==='villager_v2'))
  if(!vs.length) return []
  return Object.values(bot.entities)
    .filter(e=>e.type==='mob'&&HOSTILE_MOBS.includes(e.name)&&e.position.distanceTo(bot.entity.position)<=maxDist&&vs.some(v=>e.position.distanceTo(v.position)<8))
    .sort((a,b)=>Math.min(...vs.map(v=>a.position.distanceTo(v.position)))-Math.min(...vs.map(v=>b.position.distanceTo(v.position))))
}

function getHostileNearVillage(center, radius=32) {
  return Object.values(bot.entities)
    .filter(e=>e.type==='mob'&&HOSTILE_MOBS.includes(e.name)&&e.position.distanceTo(bot.entity.position)<32&&center&&e.position.distanceTo(new Vec3(center.x,center.y,center.z))<radius)
    .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0]??null
}

function evaluateThreat(mob) {
  const sp=SPECIAL_MOBS[mob.name], d=mob.position.distanceTo(bot.entity.position)
  let t=(sp?30:0)+(sp?.strategy==='hit_and_run'?20:0)
  t+=d<2?40:d<4?20:d<6?10:0
  t+=bot.health<HUNT_CONFIG.retreatHealth?50:bot.health<HUNT_CONFIG.safeHealth?25:0
  return{level:t,shouldEngage:t<60&&bot.health>HUNT_CONFIG.retreatHealth,strategy:sp?.strategy||'normal'}
}

function hasShield(){const o=bot.inventory.slots[45];return o&&o.name==='shield'}

async function equipShield(){
  if(hasShield()) return true
  const s=bot.inventory.items().find(i=>i.name==='shield'); if(s){await bot.equip(s,'off-hand');return true}
  return false
}

async function useShield(dur=HUNT_CONFIG.blockDuration){
  if(!hasShield()||Date.now()-lastShieldUse<100) return false
  lastShieldUse=Date.now()
  try{bot.activateItem();setTimeout(()=>{if(currentCombatState===CombatState.BLOCKING)bot.deactivateItem()},dur*50);return true}catch{return false}
}

function stopShield(){if(hasShield())bot.deactivateItem()}

async function equipBestWeapon(){
  const eq=bot.inventory.slots[36]; if(eq&&WEAPON_PRIORITY.includes(eq.name)) return eq.name
  for(const n of WEAPON_PRIORITY){const w=bot.inventory.items().find(i=>i.name===n);if(w){await bot.equip(w,'hand');return n}}
  if(craftingTableLocation){
    const cobble=bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((s,i)=>s+i.count,0)
    if(cobble<2) await mineCobblestone(2-cobble)
    await processWoodToSticks()
    try{
      await safeGoto(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z,2)
      const t=bot.blockAt(new Vec3(craftingTableLocation.x,craftingTableLocation.y,craftingTableLocation.z))
      const r=bot.recipesFor(mcData.itemsByName['stone_sword'].id,null,1,t)
      if(r.length){await bot.craft(r[0],1,t);const sw=bot.inventory.items().find(i=>i.name==='stone_sword');if(sw){await bot.equip(sw,'hand');return 'stone_sword'}}
    }catch{}
  }
  return null
}

async function attackMob(mob){
  if(!mob?.isValid) return false
  try{bot.lookAt(mob.position.offset(0,1,0));await bot.attack(mob);return true}catch{return false}
}

async function fightMob(mob) {
  if(!mob?.isValid) return false
  if(!await equipBestWeapon()){sendPrivateMessage('Sin arma');return false}
  await equipShield()
  currentTarget=mob; currentCombatState=CombatState.APPROACHING
  while(mob.isValid&&currentCombatState!==CombatState.RETREATING){
    if(bot.health<HUNT_CONFIG.retreatHealth){currentCombatState=CombatState.RETREATING;break}
    if(mob.position.distanceTo(bot.entity.position)>HUNT_CONFIG.combatRange)
      await safeSetGoal(new goals.GoalNear(mob.position.x,mob.position.y,mob.position.z,HUNT_CONFIG.combatRange))
    else{if(hasShield()&&Math.random()<HUNT_CONFIG.blockChance)await useShield(10);await attackMob(mob)}
    await bot.waitForTicks(HUNT_CONFIG.attackCooldown)
  }
  currentCombatState=CombatState.IDLE; currentTarget=null; stopShield()
  return !mob.isValid
}

async function patrol() {
  patrolActive=true; sendPrivateMessage('🛡️ Patrullando...')
  const center=villageLocation?{...villageLocation}:null; let angle=0
  while(patrolActive){
    await checkHealthAndHunger()
    const att=getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius)
    if(att.length){sendPrivateMessage(`⚔️ ${att[0].name} ataca aldeano!`);await fightMob(att[0]);await pickupNearbyItems();continue}
    if(center){
      const near=getHostileNearVillage(center,20)
      if(near&&evaluateThreat(near).shouldEngage){sendPrivateMessage(`⚠️ ${near.name} cerca`);await fightMob(near);await pickupNearbyItems();continue}
      angle+=0.1
      const tx=center.x+Math.cos(angle)*20, tz=center.z+Math.sin(angle)*20
      if(Math.hypot(tx-bot.entity.position.x,tz-bot.entity.position.z)>5)
        try{await safeSetGoal(new goals.GoalNear(tx,bot.entity.position.y,tz,3))}catch{}
    }else{
      const p=bot.entity.position,a=(Date.now()/1000)%(Math.PI*2)
      try{await safeSetGoal(new goals.GoalNear(p.x+Math.cos(a)*10,p.y,p.z+Math.sin(a)*10,5))}catch{}
    }
    await bot.waitForTicks(10)
  }
}

function stopPatrol(){patrolActive=false;sendPrivateMessage('🛡️ Patrulla detenida')}

async function startCuidame() {
  cuidameMode=true; following=true; sendPrivateMessage('🛡️ CUIDAME activado')
  startFollowing(MASTER)
  while(cuidameMode&&following){
    await checkHealthAndHunger()
    const att=getMobsAttackingVillagers(HUNT_CONFIG.awarenessRadius)
    if(att.length){await fightMob(att[0]);await pickupNearbyItems();continue}
    const mob=getNearestHostile(HUNT_CONFIG.awarenessRadius)
    if(mob&&evaluateThreat(mob).shouldEngage){await fightMob(mob);await pickupNearbyItems()}
    await bot.waitForTicks(5)
  }
}

function stopCuidame(){cuidameMode=false;stopFollowing();sendPrivateMessage('🛡️ CUIDAME desactivado')}

function startDodgeSystem() {
  if(dodgeInterval) clearInterval(dodgeInterval)
  dodgeInterval=setInterval(async()=>{
    if(isDodging||!DODGE_CONFIG.enabled) return
    const mob=getNearestHostile(DODGE_CONFIG.detectionRadius); if(!mob) return
    const we=explorationActive,ww=woodcuttingActive,wm=miningActive,wf=following
    if(we)explorationActive=false; if(ww)woodcuttingActive=false; if(wm)miningActive=false
    if(wf){following=false;if(followInterval)clearInterval(followInterval)}
    bot.pathfinder.setGoal(null); isDodging=true
    try{
      const pos=bot.entity.position,mp=mob.position,dx=pos.x-mp.x,dz=pos.z-mp.z,len=Math.sqrt(dx*dx+dz*dz)||1
      await safeSetGoal(new goals.GoalNear(pos.x+(dx/len)*DODGE_CONFIG.safeDistance,pos.y,pos.z+(dz/len)*DODGE_CONFIG.safeDistance,2),true)
      await bot.waitForTicks(20)
    }catch(e){console.error('dodge:',e)}
    finally{
      isDodging=false
      if(we)explorationActive=true; if(ww)woodcuttingActive=true; if(wm)miningActive=true
      if(wf){following=true;startFollowing(MASTER)}
    }
  },DODGE_CONFIG.checkInterval)
}

// ===================== COMANDOS =====================
async function handleCommand(message) {
  const parts=message.split(' '), cmd=parts[0].toLowerCase()

  if(cmd==='aiuda'||cmd==='help'){
    sendPrivateMessage('📋 seguime|quieto|auto|cuidame|basta | explora|para | deposita|agarra <item>|agarra todo <item>')
    await sleep(300)
    sendPrivateMessage('⛏️ minar <block> | franja <Y> | parar mina | retomar | picos')
    await sleep(300)
    sendPrivateMessage('🏘️ busca aldea|ofertas|optimiza | patrulla | cofre/mesa/cama/mina x y z | pos|salud|data|descubrir')
    return
  }

  if(cmd==='pos'||cmd==='dondetas'){const p=bot.entity.position;sendPrivateMessage(`📍 X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`);return}
  if(cmd==='salud'){sendPrivateMessage(`❤️ ${Math.round(bot.health)}/20 🍗 ${Math.round(bot.food)}/20`);return}
  if(cmd==='data'){
    const f=l=>l?`${l.x} ${l.y} ${l.z}`:'no'
    sendPrivateMessage(`📦 Cofre:${f(getChestLocation())} Mesa:${f(craftingTableLocation)} Mina:${f(mineLocation)} Cama:${f(bedLocation)} Aldea:${f(villageLocation)}`)
    return
  }

  if(cmd==='deposita'){await depositInChest();return}

  // Cofres
  if(cmd==='cofre'&&parts.length===4){
    const[,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return
    chestLocations.push({x,y,z});saveState();sendPrivateMessage(`✅ Cofre ${chestLocations.length} en ${x} ${y} ${z}`);return
  }
  if(cmd==='cofres'){
    if(!chestLocations.length){sendPrivateMessage('Sin cofres');return}
    chestLocations.forEach((c,i)=>sendPrivateMessage(`  ${i+1}. ${c.x} ${c.y} ${c.z}`));return
  }
  if(cmd==='borra'&&parts[1]==='cofre'){
    const idx=parseInt(parts[2])-1
    if(isNaN(idx)||idx<0||idx>=chestLocations.length){sendPrivateMessage('❌ Índice inválido');return}
    chestLocations.splice(idx,1);saveState();sendPrivateMessage('✅ Cofre borrado');return
  }
  if(cmd==='bloquea'&&parts[1]==='cofre'&&parts.length===5){
    const[,,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return
    chestBlacklist.push({x,y,z});chestLocations=chestLocations.filter(c=>!(c.x===x&&c.y===y&&c.z===z));saveState();sendPrivateMessage('🚫 Bloqueado');return
  }
  if(cmd==='desbloquea'&&parts[1]==='cofre'&&parts.length===5){
    const[,,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return
    chestBlacklist=chestBlacklist.filter(c=>!(c.x===x&&c.y===y&&c.z===z));saveState();sendPrivateMessage('✅ Desbloqueado');return
  }
  if(cmd==='descubrir'){await discoverChests(parseInt(parts[1])||32);return}

  // Ubicaciones
  if(cmd==='mesa'&&parts.length===4){const[,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return;craftingTableLocation={x,y,z};saveState();sendPrivateMessage(`✅ Mesa en ${x} ${y} ${z}`);return}
  if(cmd==='cama'&&parts.length===4){const[,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return;bedLocation={x,y,z};saveState();sendPrivateMessage(`✅ Cama en ${x} ${y} ${z}`);return}
  if(cmd==='mina'&&parts.length===4){const[,x,y,z]=parts.map(Number);if([x,y,z].some(isNaN))return;mineLocation={x,y,z};saveState();sendPrivateMessage(`✅ Mina en ${x} ${y} ${z}`);return}

  // Seguimiento
  if(cmd==='seguime'){
    explorationActive=false;woodcuttingActive=false;miningActive=false;patrolActive=false
    following=true;autoFollowEnabled=true;startFollowing(MASTER)
    sendPrivateMessage(`🚶 Siguiendo a ${MASTER}`);return
  }
  if(cmd==='quieto'||cmd==='basta'){
    if(pendingConfirmation){pendingConfirmation.resolve(false);pendingConfirmation=null}
    if(pendingDirectionConfirmation){pendingDirectionConfirmation.resolve(null);pendingDirectionConfirmation=null}
    stopFollowing();explorationActive=false;woodcuttingActive=false;miningActive=false
    tradingActive=false;patrolActive=false;cuidameMode=false
    bot.pathfinder.setGoal(null);sendPrivateMessage('🛑 Detenido.');return
  }
  if(cmd==='auto'){autoFollowEnabled=!autoFollowEnabled;sendPrivateMessage(autoFollowEnabled?'✅ Auto ON':'❌ Auto OFF');if(autoFollowEnabled&&!following){following=true;startFollowing(MASTER)};return}
  if(cmd==='cuidame'){if(cuidameMode)stopCuidame();else await startCuidame();return}

  // Leñador
  if(cmd==='explora'){if(following)stopFollowing();explorationActive=true;woodcuttingActive=false;sendPrivateMessage('🌲 Leñador ON');exploreChunks();return}
  if(cmd==='para'&&explorationActive){explorationActive=false;woodcuttingActive=false;sendPrivateMessage('🛑 Leñador OFF');return}

  // Minería - Función 1
  if(cmd==='minar'&&parts.length>=2){
    const block=parts[1]
    if(!mcData.blocksByName[block]){sendPrivateMessage(`❌ Bloque ${block} no existe`);return}
    if(!mineLocation){sendPrivateMessage('❌ Define mina con "mina x y z"');return}
    if(miningActive){sendPrivateMessage('⚠️ Ya estoy minando. Usa "parar mina" primero.');return}
    explorationActive=false;woodcuttingActive=false;following=false;patrolActive=false
    if(followInterval)clearInterval(followInterval)
    bot.pathfinder.setGoal(null); await sleep(100)
    miningTarget=block; miningActive=true; saveMiningProgress()
    sendPrivateMessage(`⛏️ Minando ${block}...`); chunkMiningLoop(); return
  }

  // Minería - Función 2
  if(cmd==='franja'&&parts.length===2){
    const y=parseInt(parts[1])
    if(isNaN(y)){sendPrivateMessage('❌ Y inválido. Usa: franja -58');return}
    if(!mineLocation){sendPrivateMessage('❌ Define mina con "mina x y z"');return}
    if(miningActive){sendPrivateMessage('⚠️ Ya estoy minando. Usa "parar mina" primero.');return}
    explorationActive=false;woodcuttingActive=false;following=false;patrolActive=false
    if(followInterval)clearInterval(followInterval)
    bot.pathfinder.setGoal(null); await sleep(100)
    miningActive=true; sendPrivateMessage(`⛏️ Franja Y=${y}...`); mineStrip(y); return
  }

  // Parar / retomar
  if(cmd==='parar'&&parts[1]==='mina'){
    if(pendingDirectionConfirmation){pendingDirectionConfirmation.resolve('para');pendingDirectionConfirmation=null}
    miningActive=false; clearMiningProgress(); sendPrivateMessage('🛑 Minería detenida'); return
  }
  if(cmd==='retomar'){
    if(miningActive){sendPrivateMessage('⚠️ Ya estoy minando.');return}
    const prog=loadMiningProgress(); if(!prog){sendPrivateMessage('❌ Sin progreso guardado.');return}
    miningTarget=prog.target; miningActive=true
    currentChunkMining={startY:prog.layer,currentY:prog.layer,chunkX:prog.chunkX,chunkZ:prog.chunkZ,startX:prog.startX,startZ:prog.startZ}
    if(mineLocation) await safeGoto(prog.posX,prog.layer,prog.posZ,3)
    sendPrivateMessage('▶️ Retomando...'); chunkMiningLoop(); return
  }
  if(cmd==='picos'){reportPickaxes();return}

  // Items del cofre
  if(cmd==='agarra'&&parts.length>=2){
    if(!getChestLocation()){sendPrivateMessage('❌ Sin cofre registrado');return}
    if(parts[1]==='todo'&&parts.length>=3){
      const item=parts.slice(2).join(' ')
      sendPrivateMessage(await getAllItemsFromChest(item)?`✅ Saqué todo el ${item}`:`❌ Sin ${item} en cofre`)
    }else{
      const item=parts.slice(1).join(' ')
      if(await getItemFromChest(item,1))sendPrivateMessage(`✅ Saqué ${item}`)
      else sendPrivateMessage(`❌ Sin ${item} en cofre`)
    }
    return
  }

  // Aldea / comerciante
  if(cmd==='busca'&&parts[1]==='aldea'){await findVillage();return}
  if(cmd==='ofertas'||cmd==='averiguar'){await investigateAllVillagers();return}
  if(cmd==='optimiza'){if(!villageLocation)await findVillage();await optimizeVillage();return}
  if(cmd==='patrulla'){if(patrolActive)stopPatrol();else await patrol();return}
  if(cmd==='dormi'){await sleepInBed();return}

  sendPrivateMessage('❌ Desconocido. Usa "aiuda".')
}

// ===================== EVENTOS =====================
bot.on('spawn',()=>{
  console.log('✅ Bot definitivo v3 conectado')
  sendPrivateMessage('🤖 Bot listo. Usa "aiuda".')
  const m=new Movements(bot); m.allowSprinting=true; m.allowParkour=true; m.allowSneaking=true; bot.pathfinder.setMovements(m)
  loadState()
  setInterval(checkHealthAndHunger,5000)
  setInterval(()=>{if(!explorationActive&&!following&&!miningActive)depositExcessIfNeeded()},30000)
  startDodgeSystem()
})

bot.on('whisper',async(username,message)=>{
  if(username!==MASTER){bot.chat(`/tell ${username} Solo respondo a ${MASTER}.`);return}
  if(pendingConfirmation&&['si','sí','yes','no'].includes(message.toLowerCase())){if(handleConfirmationResponse(message))return}
  if(pendingDirectionConfirmation&&handleDirectionResponse(message)) return
  await handleCommand(message)
})

bot.on('chat',async(username,message)=>{
  if(username===bot.username||username!==MASTER) return
  if(pendingConfirmation&&['si','sí','yes','no'].includes(message.toLowerCase())){if(handleConfirmationResponse(message))return}
  if(pendingDirectionConfirmation&&handleDirectionResponse(message)) return
  await handleCommand(message)
})

bot.on('time',async()=>{
  if(bot.time.timeOfDay>12000&&following&&!cuidameMode){
    stopFollowing()
    if(bedLocation||villageBedLocation){sendPrivateMessage('🌙 Durmiendo...');await sleepInBed()}
    else sendPrivateMessage('🌙 Me quedo quieto.')
  }
})

bot.on('error',err=>{
  const m=err.message||String(err)
  if(m.includes('GoalChanged')||m.includes('timeout')){pathfindingLock=false;return}
  if(m.includes('ECONNREFUSED')||m.includes('ENOTFOUND'))console.error('🔌 Conexión:',m)
  else console.error('❌ Error:',m)
})

bot.on('end',()=>console.log('🔌 Bot desconectado'))