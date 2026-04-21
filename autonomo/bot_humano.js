// ==========================================
//   BOT HUMANO - SISTEMA DE VOLUNTAD PROPIA
// ==========================================
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcData = require('minecraft-data')('1.21.1');

const MASTER = process.env.MC_MASTER || 'gonsalomon';

const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT) || 25565,
    username: 'humanoid',
    version: '1.21.1'
});

bot.loadPlugin(pathfinder);

// --- ESTADO INTERNO ---
let botContext = {
    mode: 'ESTATICO', // 'ESTATICO' (Aldea) o 'DINAMICO' (Escolta)
    subTask: null,    // Tarea secundaria, ej: 'mine_coal_ore'
    isShielding: false,
    priorities: {
        SURVIVAL: 0.9,
        DEFENSE: 0.85,
        MASTER: 0.7,
        VILLAGE: 0.5
    }
};

const RECHAZO_FRASES = [
    "¡Ahora no! Estoy tratando de no morir.",
    "Dame un segundo, primero tengo que encargarme de esto...",
    "Imposible, tengo prioridades más urgentes ahora.",
    "¿No ves que me están disparando? ¡Esperá!",
    "Primero la salud, después tus órdenes."
];

// ==========================================
// 1. REFLEJOS DE COMBATE Y ESCUDO
// ==========================================
function handleCombatReflexes() {
    const entities = Object.values(bot.entities);
    
    // Detectar amenazas inmediatas (Creeper cerca, Esqueleto apuntando, Zombie pegando)
    const threat = entities.find(e => {
        const dist = bot.entity.position.distanceTo(e.position);
        return (e.name === 'creeper' && dist < 4) || 
               (e.name === 'skeleton' && dist < 15) ||
               (e.name === 'zombie' && dist < 3);
    });

    const shield = bot.inventory.items().find(i => i.name === 'shield');

    if (threat && shield) {
        if (!botContext.isShielding) {
            bot.equip(shield, 'off-hand');
            bot.activateItem(true);
            botContext.isShielding = true;
        }
        // Si es un zombie o mob cuerpo a cuerpo cerca, atacar mientras se cubre
        if (bot.entity.position.distanceTo(threat.position) < 3.5) {
            bot.attack(threat);
        }
    } else if (botContext.isShielding) {
        bot.deactivateItem();
        botContext.isShielding = false;
    }
}

// ==========================================
// 2. CEREBRO: TOMA DE DECISIONES
// ==========================================
async function brainTick() {
    if (bot.health < 1) return;

    handleCombatReflexes();

    // Prioridad 0: Supervivencia Crítica
    const hungerLevel = (20 - bot.food) / 20;
    const healthLevel = (20 - bot.health) / 20;

    if (healthLevel > 0.6 || hungerLevel > 0.7) {
        await handleSurvival(healthLevel, hungerLevel);
        return;
    }

    // Lógica por MODO
    if (botContext.mode === 'DINAMICO') {
        await logicDinamico();
    } else {
        await logicEstatico();
    }
}

async function handleSurvival(health, hunger) {
    if (hunger > 0.5) {
        const food = bot.inventory.items().find(i => i.name.includes('cooked') || i.name === 'bread');
        if (food) {
            await bot.equip(food, 'hand');
            await bot.consume();
        }
    }
    if (health > 0.5) {
        // Alejarse del peligro más cercano
        const enemy = bot.nearestEntity(e => e.type === 'hostile');
        if (enemy) {
            const p = enemy.position;
            bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalNear(p.x, p.y, p.z, 10)));
        }
    }
}

async function logicDinamico() {
    const player = bot.players[MASTER]?.entity;
    if (!player) return;

    const dist = bot.entity.position.distanceTo(player.position);

    if (dist > 6) {
        // Prioridad: Seguir al maestro
        const { x, y, z } = player.position;
        bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 3));
    } else if (botContext.subTask) {
        // Si está cerca del maestro, realiza la tarea secundaria
        await performSubTask(botContext.subTask.replace('mine_', ''));
    }
}

async function logicEstatico() {
    // Buscar zombies que amenacen aldeanos
    const threat = Object.values(bot.entities).find(e => 
        e.name === 'zombie' && 
        Object.values(bot.entities).some(v => v.name === 'villager' && v.position.distanceTo(e.position) < 10)
    );

    if (threat) {
        bot.pathfinder.setGoal(new goals.GoalFollow(threat, 2));
        bot.attack(threat);
    } else {
        // Aquí podrías añadir scanVillagers() de tu bot_comerciante.js
        if (Math.random() > 0.95) bot.chat("Aldea bajo control.");
    }
}

async function performSubTask(blockName) {
    const block = bot.findBlock({
        matching: mcData.blocksByName[blockName]?.id,
        maxDistance: 15
    });

    if (block && !bot.pathfinder.isMining()) {
        try {
            const movements = new Movements(bot);
            bot.pathfinder.setMovements(movements);
            await bot.collectBlock.collect(block);
        } catch (e) { /* Ignorar interrupciones de movimiento */ }
    }
}

// ==========================================
// 3. SISTEMA DE COMANDOS Y VOLUNTAD
// ==========================================
bot.on('chat', async (username, message) => {
    if (username !== MASTER) return;

    // Calcular "Urgencia Interna"
    const urgenciaHambre = (20 - bot.food) / 10;
    const hayAmenaza = botContext.isShielding ? 0.9 : 0;
    const prioridadInterna = Math.max(urgenciaHambre, hayAmenaza);

    // Si el bot está ocupado sobreviviendo, rechaza la orden
    if (prioridadInterna > botContext.priorities.MASTER) {
        const frase = RECHAZO_FRASES[Math.floor(Math.random() * RECHAZO_FRASES.length)];
        bot.chat(frase);
        return;
    }

    // Procesar comandos
    const parts = message.toLowerCase().split(' ');
    if (parts === 'seguime') {
        botContext.mode = 'DINAMICO';
        botContext.subTask = parts ? `mine_${parts}` : null;
        bot.chat(parts ? `Te sigo y mino ${parts}.` : "Escoltando...");
    } 
    else if (parts === 'quedate') {
        botContext.mode = 'ESTATICO';
        botContext.subTask = null;
        bot.chat("Cuidando la aldea.");
    }
    else if (parts === 'status') {
        bot.chat(`Modo: ${botContext.mode} | Vida: ${Math.round(bot.health)} | Tarea: ${botContext.subTask || 'Ninguna'}`);
    }
});

// ==========================================
// 4. INICIALIZACIÓN
// ==========================================
bot.on('spawn', () => {
    const movements = new Movements(bot);
    movements.allowSprinting = true;
    bot.pathfinder.setMovements(movements);
    
    console.log(`✅ ${bot.username} ha despertado con voluntad propia.`);
    
    // Pulso cerebral cada 1 segundo para reflejos rápidos
    setInterval(brainTick, 1000);
});

bot.on('kicked', console.log);
bot.on('error', console.log);