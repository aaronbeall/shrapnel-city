// GENERIC ENEMY OBJECT
// hit by shots, take damage, die, collide with level and bounce, thrust movement, pushed by shots, drops powerups, creates explosion/blastmark/shrapnel, spawnable

#include "enemy.as"

// init
_name = "enemyObject_mc" + getDepth();

// params
if(health == undefined) health = 100;
if(radius == undefined) radius = (core_mc || this)._width / 2;
if(drag == undefined) drag = .9;
if(bounce == undefined) bounce = .35;
if(resistence == undefined) resistence = health * .25;
if(speedMax == undefined) speedMax = 15;
if(speedMin == undefined) speedMin = .1;
if(blastMark == undefined) blastMark = "";
if(blastRange == undefined) blastRange = radius * 2;
if(damage == undefined) damage = health * .1;
if(debrisCount == undefined) debrisCount = 0;
if(movable == undefined) movable = true;
if(fragCount == undefined) fragCount = 0;
if(frag == undefined) frag = "";
if(spawnCount == undefined) spawnCount = 0;
if(spawn == undefined) spawn = "";
if(spawnInit == undefined) spawnInit = {};
if(deathRoll == undefined) deathRoll = false;
if(fixed == undefined) fixed = false;
if(powerupDrop == undefined) powerupDrop = null;

// vars
var trajectory = {x:0, y:0};
var seekingDamage = 0;
var speed = 0;
var spinSpeed = 0;
var dying = false;

// init speed
if(speed)
	thrust(speed, _rotation);

// spawn trigger
if(spawnTrigger){
	_visible = false;
	_root.enemies.remove(this);
	registerTrigger(this, spawnTrigger);
	
	_onTrigger = onTrigger;
	onTrigger = function(){
		_visible = true;
		_root.enemies.push(this);
		makeShrapnel(this, "particle_mcBlue", 25);
		makeZaps(this, 45);
		makeLightFlash(this);
		
		if(_onTrigger) _onTrigger();
	}
}

// hit
function hit(damage, angle){
	health -= damage;
	if(health <= 0){
		if(deathRoll){
			dying = true;
			speedMax = Math.min(speedMax * 2, damage);
			thrust(speedMax, angle != undefined ? angle + jitter(65) : rand(360));
			spinSpeed = (15 + rand(45)) * randDir();
			return;
		}
		die();
		if(!fixed)
			_rotation = angle + jitter(45) ;
		if(blastMark) makeBlastmark(this, blastMark);
		if(blastRange) makeExplosion(this);
		if(fragCount) makeShrapnel(this, frag, fragCount);
		if(debrisCount) makeShrapnel(this, "debris_mc", debrisCount, 360, {debrisType:debrisType});
		if(spawnCount) makeSpawns(this, spawn, spawnCount, _rotation, radius + Math.random() * radius, 360, spawnInit);
		if(powerupDrop) makePowerup(this, powerupDrop);
		onDie();
	}else{
		if(!fixed && movable){
			thrust(damage / resistence, angle);
			spinSpeed = Math.max(spinSpeed, rand(damage / resistence));
		}
		onHit(damage, angle);
	}
}

// thrust
function thrust(amount, angle){
	var delta = getVector(amount, angle);
	trajectory.x += delta.x;
	trajectory.y += delta.y;
	speed = getLength({x:trajectory.x, y:trajectory.y});
	if(speed > speedMax){
		trajectory.x *= speedMax / speed;
		trajectory.y *= speedMax / speed;
	}
}

// update
function update(time){
	
	// movement (not subsampled)
	if(movable && speed > speedMin){
		
		//trace(_name + " moving")
		
		var oldX = _x, oldY = _y;
		_x += trajectory.x * time;
		_y += trajectory.y * time;
		
		// collisions
		if(wallHitTest(_x, _y)){
			_x = oldX;
			_y = oldY;
			
			// bouncing
			bounceTrajectory(this, trajectory, bounce, speed);
			
			// sparks
			makeSparks(this, (speed / speedMax));
			
			// wall hit
			onWallHit();
			
			// death roll impact
			if(dying && !random(2)){
				deathRoll = false;
				hit(0, rand(360));
			}
		}
		
		// decay
		speed *= drag;
		trajectory.x *= drag;
		trajectory.y *= drag;
	}
	
	// spinning
	if(spinSpeed > speedMin){
		_rotation += spinSpeed * time;
		spinSpeed *= drag;
	}
	
	
	// death roll
	if(dying){
		if(randomPerSecond(5))
			makeFireball(randomPointOn(this), "miniExplosion", 50 + rand(100));
		if(randomPerSecond(15) && speed > speedMax * .5)
			makeShrapnel(randomPointOn(this), "particle_mcFire", 1, 360);
		if(speed > speedMax * .5)
			makeSmoke(this, 50 * (speed / speedMax), 10);
		if(speed <= speedMax * .25){
			deathRoll = false;
			hit(0, rand(360));
		}
	}
	
	onUpdate();
}