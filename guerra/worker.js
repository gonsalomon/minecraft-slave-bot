const BotBase = require('./bot_base');
const { goals } = require('mineflayer-pathfinder');

const [,, name, role] = process.argv; // Captura nombre y rol desde el Manager

class Worker extends BotBase {
    constructor(name, role) {
        super(name, role);
        this.setupSwarmEvents();
    }

    setupSwarmEvents() {
        this.bot.on('chat', async (username, msg) => {
            const message = msg.toLowerCase();

            // Sincronización de Guerra
            if (message === 'enjambre guerra') {
                this.isInWarMode = true;
                await this.equipForWar(); // Heredado de BotBase (con Ballestas)
            }

            // Táctica: Formación Tortuga
            if (message === 'enjambre tortuga') {
                this.formarTortuga();
            }
        });
    }

    async formarTortuga() {
        const master = this.bot.players[this.master]?.entity;
        if (!master) return;

        // Geometría de círculo: repartir bots alrededor del player
        const totalBots = 6; // Asumimos un enjambre de 6 para el ejemplo
        const angle = (Math.PI * 2) / totalBots; 
        const radius = 3;

        // Cada bot elige una posición en el círculo según su nombre o ID
        // Aquí simplificamos: el bot va a una posición relativa al Master
        const targetPos = master.position.offset(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius
        );

        this.bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1));
        
        this.bot.once('goal_reached', () => {
            this.bot.lookAt(master.position.offset(0, 1.6, 0)); // Mirar hacia afuera o al master
            this.bot.chat("Posición tortuga asegurada.");
        });
    }
}

new Worker(name, role);