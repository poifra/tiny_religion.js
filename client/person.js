'use strict';

class Job {
    constructor(name, path, ext) {
        this.name = name;
        Person.jobs.add(this);
        PIXI.loader.add(name, path, null, res => this.init(res.texture));
        Object.merge(this, ext);
    }
    init(texture) {
        this.texture = new PIXI.TiledTexture(texture, 8, 12);
    }
}
class Person extends PIXI.AnimatedSprite {
    constructor(x, y, job, kingdom, island, isSummon = false) {
        super(job.texture, 10, true);
        this.decal = { x: 4, y: 10 };
        this.x = x;
        this.y = y;
        this.job = job;

        this.health = 100;
        this.sinceTookDamage = 0;
        this.speed = 0.25;
        this.target = null;
        this.movements = [];

        this.island = island;
        this.kingdom = kingdom;
        this.isSummon = isSummon;
    }
    get z() { return this.y; }

    get targetReached() {
        return Math.dst(this.x, this.y, this.target.x, this.target.y) < this.speed;
    }

    get job() { return this._job; }
    set job(val) {
        this._job = val;
        if (val.person) val.person.apply(this, arguments);
        this.setTiledTexture(val.texture);
    }

    takeDamage(amount, game) {
        this.health -= amount;
        this.sinceTookDamage = 10;
        if (this.health <= 0) this.die(game);
    }
    die(game) {
        this.shouldRemove = true;
        game.addChild(new SFX(this.x, this.y, Blood));
    }

    update(delta, game) {
        if (this.health < 100) this.health = Math.min(this.health + 0.1, 100);
        if (this.sinceTookDamage > 0) this.sinceTookDamage--;
        if (this.praying > 0) {
            this.praying--;
            this.tileX = 0;
            return;
        }

        if (this.job.update && this.job.update.apply(this, arguments)) return;

        // Movement
        let dstToTarget;
        if (!this.target || (this.x===this.target.x && this.y===this.target.y)) {
            if (this.target) {
                this.island.people.remove(this);
                this.island = this.target.island;
                this.island.people.add(this);
            }
            if (!this.movements.length) this.findNextTarget(game);
            this.speed = (Math.random() + 1) / 4 + this.kingdom.islandCount / 10;
            this.target = this.movements.shift();
            dstToTarget = Math.dst(this.x, this.y, this.target.x, this.target.y);
            let ratio = this.speed / dstToTarget;
            this.movX = (this.target.x - this.x) * ratio,
            this.movY = (this.target.y - this.y) * ratio;
        }
        else dstToTarget = Math.dst(this.x, this.y, this.target.x, this.target.y);

        if (dstToTarget < this.speed) {
            this.x = this.target.x;
            this.y = this.target.y;
        } else {
            this.x += this.movX;
            this.y += this.movY;
        }

        // Visuals
        this.tileY = Math.abs(this.movX) > Math.abs(this.movY) ?
            (this.movX > 0 ? this.tileY = 1 : this.tileY = 2) :
            (this.movY > 0 ? this.tileY = 3 : this.tileY = 4);
        this.tint = this.sinceTookDamage > 4 ? 0xFFFFFF : this.kingdom.tint;
        super.update(delta);
    }
    findNextTarget(game) {
        if (this.job.findNextTarget &&
            this.job.findNextTarget.apply(this, arguments)
        ) return;
        this.movements.push(this.island.getRandomPoint());
        let wantsToLeave = (Math.random() * (game.islands.length + 10))|0;
        if (wantsToLeave < game.islands.length)
            this.moveTo(game.islands, wantsToLeave);
    }
    moveTo(islands, index) {
        let currentIndex = islands.indexOf(this.island);
        let dir = Math.sign(index - currentIndex);

        for (let i = currentIndex; i !== index; i += dir) {
            let prev = islands[i], next = islands[i+dir];
            let bridge = dir === 1 ? prev.bridge : next.bridge;
            if (!bridge || !bridge.finished) return;
            this.movements.push({
                x: bridge.x - dir * 90,
                y: bridge.y + Math.random() * 20 - 15,
                island: prev
            }, {
                x: bridge.x + dir * 90,
                y: bridge.y + Math.random() * 20 - 15,
                island: next
            });
        }
    }

    pray() {
        this.praying = Math.random() * 50 + 75;
    }
}
Person.jobs = [];
let Villager = new Job('villager', 'images/Villager.png', {
    person() { this.sinceBaby = 0; },
    update(delta, game) {
        this.sinceBaby++;
        if (this.island.kingdom !== this.kingdom) return;
        this.island.buildings.filter(b =>
            b.type === FallingTree && !b.finished && b.isInRadius(this))
        .forEach(b => b.progressBuild(1, game));
    },
    doBaby(game) {
        if (this.kingdom.housed) return null;
        if (Math.random() * 3000 < this.sinceBaby) {
            this.sinceBaby = 0;
            let baby = new Person(this.x, this.y,
                Villager, this.kingdom, this.island);
            game.addChild(baby, new SFX(this.x, this.y, Sparkle));
            this.island.people.add(baby);
            if (this.kingdom.isPlayer) game.god.event('baby', 1, this.position);
        }
    }
}),
Builder = new Job('builder', 'images/Builder.png', {
    update(delta, game) {
        if (this.building && this.building.finished) this.building = null;
        if (this.island.kingdom !== this.kingdom) return;
        this.island.buildings.filter(b =>
            b.type !== FallingTree && b.type !== Tree && !b.finished
            && b.isInRadius(this))
        .forEach(b => b.progressBuild(this.kingdom.workshopCount + 1, game));
    },
    findNextTarget(game) {
        if (this.building && !this.building.finished) {
            moveTo(game.islands, game.islands.indexOf(this.building.island));
            let x = (Math.random() * 2 - 1) * this.building.radius * 0.75;
            let y = (Math.random() * 2 - 1) * this.building.radius * 0.75;
            if (this.building.type === Bridge) {
                x /= 4; y /= 4;
                x -= 100;
            }
            // TODO; clamp movement inside island
            this.movements.push({
                x: this.building.x + x,
                y: this.building.y + y,
                island: this.building.island
            });
            return true;
        }
    }
}),
Warrior = new Job('warrior', 'images/Warrior.png', {
    update(delta, game) {
        let targets = this.island.people.filter(p => p.kingdom !== this.kingdom
            && p.sinceTookDamage <= 0
            && Math.dst2(this.x, this.y, p.x, p.y) < 32 * 32);
        let target = targets[(Math.random() * targets.length)|0];
        if (!target) return;
        target.takeDamage(3 + this.kingdom.barracksCount, game);
        if (this.kingdom.isPlayer) {
            game.god.event('fight', 1, this.position);
            if (target.health <= 0) game.god.event('kill', 1, target.position);
        }
    }
}),
Priest = new Job('priest', 'images/Priest.png', {
    person() { this.sinceSummon = 0; },
    update(delta, game) {
        this.sinceSummon++;
        let targets = this.island.people.filter(p => p.kingdom !== this.kingdom
            && Math.dst2(this.x, this.y, p.x, p.y) < 48 * 48);
        let target = targets[(Math.random() * targets.length)|0];
        if (!target) return;
        if (this.kingdom.isPlayer) game.god.event('converting', 1, this.position);
        if (Math.random() * 1000 < this.templeCount + 1) {
            target.kingom = this.kingdom;
            game.addChild(new SFX(target.x, target.y, Summon));
            if (this.kingdom.isPlayer) game.god.event('convert', 1, this.position);
        }
    },
    doSummon(game) {
        if (this.kingdom.templed) return null;
        if (Math.random() * 5000 < this.sinceSummon) {
            this.sinceSummon = 0;
            let summon = new Person(this.x, this.y,
                Villager, this.kingdom, this.island, true);
            game.addChild(summon, new SFX(this.x, this.y, Summon));
            this.island.people.add(summon);
            if (this.kingdom.isPlayer) game.god.event('summon', 1, this.position);
        }
    }
});