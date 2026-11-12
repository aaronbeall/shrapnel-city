// GAMEPLAY FUNCTIONS

// update the HUD state
_global.updateDisplay = function(property){
	switch(property){
		
		case "health":
			//_root.HUD_mc.health_txt.text = _player.health;
			var f = 100 - Math.round(99 * (_player.health / _player.healthMax));
			f = Math.min(100, Math.max(1, f));
			_root.HUD_mc.healthbar_mc.gotoAndStop(f);
			if(_player.health > _root.HUD_mc.health || _player.healthMax > _root.HUD_mc.healthMax){
				_root.HUD_mc.healthFlash_mc.gotoAndPlay(1);
			}
			_root.HUD_mc.health = _player.health;
			_root.HUD_mc.healthMax = _player.healthMax;
			break;
		
		case "wep1":
			if(_player.weapon1.id != _root.HUD_mc.weapon1){
				_root.HUD_mc.weapon1 = _player.weapon1.id;
				_root.HUD_mc.weapon1_txt.text = _player.weapon1.fullname.toUpperCase();
				_root.HUD_mc.weapon1_mc.gotoAndStop(_player.weapon1.id + 1);
				_root.HUD_mc.flash1_mc.gotoAndPlay(1);
			}
			case "ammo1":
			_root.HUD_mc.ammo1_txt.text = _player.weapon1.ammo != Infinity ? _player.weapon1.ammo : "∞";
			break;
			
		case "wep2":
			if(_player.weapon2.id != _root.HUD_mc.weapon2){
				_root.HUD_mc.weapon2 = _player.weapon2.id;
				_root.HUD_mc.weapon2_txt.text = _player.weapon2.name.toUpperCase();
				_root.HUD_mc.weapon2_mc.gotoAndStop(_player.weapon2.id + 1);
				_root.HUD_mc.flash2_mc.gotoAndPlay(1);
			}
			case "ammo2":
			_root.HUD_mc.ammo2_txt.text = _player.weapon2.ammo != Infinity ? _player.weapon2.ammo : "∞";
			_root.HUD_mc.weapon2_txt._visible = _root.HUD_mc.weapon2_mc._visible = _root.HUD_mc.ammo2_txt._visible = _player.weapon2.ammo > 0;
			if(_player.weapon2.ammo <= 0)
				_root.HUD_mc.weapon2 = null;
			break;
			
		default:
			updateDisplay("health");
			updateDisplay("wep1");
			updateDisplay("wep2");
			break;
	}
}

// shake the screen
_global.SHAKE_INTERVAL = 3;
_global.shake = function(strength){
	shakeCount = int(strength) * SHAKE_INTERVAL;
}

// flash the screen
_global.flashScreen = function(){
	_root.attachMovie('screenFlash', 'screenFlash_mc', _root.screenDepth);
	_root.screenFlash_mc.onEnterFrame = function(){
		this.removeMovieClip();
	}
}

// get the next shot depth
_global.shotID = function(){
	if(++shotCount > shotMax) shotCount = 1;
	return shotCount;
}

// determine actual damage based on damage amount
_global.getDamage = function(damage){
	return damage + random(damage);
}

// rotate towards target
_global.smartRotation = function(currentRotation, targetRotation, rotationSpeed){
	if(Math.abs(currentRotation - targetRotation) <= rotationSpeed){
		return targetRotation;
	}else{
		var dif = currentRotation - targetRotation;
		if(dif < 0)
			dif += 360;
		if(dif >= 180)
			currentRotation += rotationSpeed;
		else
			currentRotation -= rotationSpeed;
		return currentRotation;
	}
}

// make an action notification popup
_global.notify = function(targetMC, msg, duration){
	// don't allow concurrent notifications
	if(lastNotifyFrame == _root.frames && lastNotify._x == targetMC._x && lastNotify._y == targetMC._y)
		lastNotify.removeMovieClip();
	_global.lastNotifyFrame = _root.frames;
	
	// create notification
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		label:msg,
		duration:duration
	}
	_global.lastNotify = _screen.attachMovie("notification", "notify_mc" + d, d, init);
}

// show a message
_global.showMessage = function(msg, killTriggers){
	if(!_root.message_mc){
		var init = {
			text:msg,
			_x:screenWidth / 2,
			_y:screenHeight / 2,
			killTriggers:killTriggers
		}
		_root.attachMovie("message", "message_mc", _root.screenDepth, init);
	}
}

// register a trigger response
_global.registerTrigger = function(targetMC, id){
	trace(['?-> register trigger '+id, targetMC._name]);
	if(!_root.triggers[id]) _root.triggers[id] = [];
	_root.triggers[id].push(targetMC);
}

// broadcast trigger notification
_global.trigger = function(id){
	trace(['!-> trigger '+id, _root.triggers[id] || "--no registered triggers--"]);
	for(var i in _root.triggers[id])
		_root.triggers[id][i].onTrigger(id);
}

// create some sparks
_global.makeSparks = function(targetMC, opacity){
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		_rotation:rand(360),
		_xscale:75 + jitter(50),
		_yscale:75 + jitter(50),
		_alpha:opacity*100
	}
	_screen.attachMovie('spark', 'spark_mc' + d, d, init);
}

// create puff of smoke
_global.makeSmoke = function(targetMC, initScale, fadeSpeed, scaleSpeed, driftTrajectory){
	var d = shotID();
	var init = {
		_x:targetMC._x + jitter(5),
		_y:targetMC._y + jitter(5),
		_xscale:initScale + jitter(5),
		_yscale:initScale + jitter(5),
		_rotation:jitter(15),
		fadeSpeed:fadeSpeed || 4,
		scaleSpeed:scaleSpeed || 2,
		driftTrajectory:driftTrajectory || null
	}
	_screen.attachMovie('smoke', 'smoke_mc' + d, d, init);
}

_global.makeSmokeColumn = function(targetMC, lifespan){
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		lifespan:lifespan || (frameRate * 3)
	}
	_screen.attachMovie('smokeColumn', 'smokeColumn_mc' + d, d, init);
}

// create a brass shell
_global.makeShell = function(targetMC, angle, xScale, yScale){
	var d = shotID();
	var init = {
		_x:_player._x,
		_y:_player._y,
		_rotation:angle,
		_xscale:xScale || 100,
		_yscale:yScale || 100
	}
	_screen.shell_mc.duplicateMovieClip("shell_mc" + d, d, init);
}

// create some eletricity zapping
_global.makeZaps = function(targetMC, lifespan){
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		_rotation:rand(360),
		lifespan:lifespan,
		blendMode:"add",
		_alpha:50
	}
	if(typeof(targetMC) == "movieclip")
		init.targetMC = targetMC;
	if(targetMC.radius)
		init._xscale = init._yscale = (targetMC.radius / 50) * 200;
	_screen.attachMovie('zaps', 'zaps_mc' + d, d, init);
}

// make a flash of light graphic
_global.makeLightFlash = function(targetMC){
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y
	}
	_screen.attachMovie('lightFlash', 'lightFlash_mc' + d, d, init);
}

// make a fireball explosion graphic
_global.makeFireball = function(targetMC, type, scale){
	if(!scale) scale = 100 + jitter(10);
	if(!type) type = "miniExplosion";
	var d = shotID();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		_rotation:rand(360),
		_xscale:scale,
		_yscale:scale
	}
	_screen.attachMovie(type, "explosion_mc" + d, d, init);
}

// create a blast mark
_global.makeBlastmark = function(targetMC, blastID, init){
	//_screen.blasts_mc.hit_mc.gotoAndStop(blastID);
	var blast = _root.blasts[blastID];
	var mat = new flash.geom.Matrix();
	mat.translate(blast.xOffset, blast.yOffset);
	if(init){
		mat.rotate(((init.rotation||rand(360)) / 180) * Math.PI);
		if(init.scale) mat.scale(init.scale[0] / 100, init.scale[1] / 100);
		targetMC.onBlastInit(_screen.blasts_mc.hit_mc);
	}else{
		mat.rotate(rand(360));
	}
	mat.translate(targetMC._x, targetMC._y);
	//blasts_bmp.draw(_screen.blasts_mc.hit_mc, mat);
	//blasts_bmp.draw(blast.bmp, mat);
	background_bmp.draw(blast.bmp, mat);
}

// create blastmark on the player
_global.makePlayerBlastmark = function(targetMC, blastID){
	var d = _player.blasts_mc.getNextHighestDepth();
	var p = { x:targetMC._x, y:targetMC._y };
	targetMC._parent.localToGlobal(p);
	_player.blasts_mc.globalToLocal(p);
	var init = {
		_x:p.x,
		_y:p.y,
		_rotation:rand(360)
	}
	var mc = _player.blasts_mc.attachMovie('hit', 'hit_mc' + d, d, init);
	mc.gotoAndStop(blastID);
}

// create spawned enemies
_global.makeSpawn = function(targetMC, spawnID, angle, speed, props){
	var d = _screen.enemies_mc.getNextHighestDepth();
	var init = {
		_x:targetMC._x,
		_y:targetMC._y,
		_rotation:angle,
		speed:speed || 0
	}
	for(var i in props)
		init[i] = props[i];
	_screen.enemies_mc.attachMovie(spawnID, "enemy_mc" + d, d, init);
}

// make multiple spawns
_global.makeSpawns = function(targetMC, spawnID, spawnCount, angle, speed, spread, props){
	if(angle == undefined) angle = targetMC._rotation;
	if(spread == undefined) spread = 360;
	if(speed == undefined) speed = targetMC.speed;
	var i = spawnCount;
	while(i--)
		makeSpawn(targetMC, spawnID, angle + jitter(spread), speed, props);
}

// create a powerup
_global.makePowerup = function(targetMC, powerupDrop){
	if(!powerupDrop.probability || Math.random() <= powerupDrop.probability){
		var d = _screen.powerups_mc.getNextHighestDepth();
		powerupDrop._x = targetMC._x;
		powerupDrop._y = targetMC._y;
		_screen.powerups_mc.attachMovie('powerup', 'powerup_mc' + d, d, powerupDrop);
	}
}

// create a static remains from something
_global.makeCorpse = function(targetMC){
	var mat = targetMC.transform.matrix;
	//blasts_bmp.draw(targetMC, mat);
	background_bmp.draw(targetMC, mat);
}

// draw to level walls, used to modify collisions in game (ie doors/gates)
_global.drawOnLevel = function(mc){
	//trace("drawOnLevel() " + mc)
	var mat = mc.transform.concatenatedMatrix;
	mat.tx -= _screen._x;
	mat.ty -= _screen._y;
	level_bmp.draw(mc, mat);
	/*_screen.createEmptyMovieClip("level_bmp_mc", 9999999)
	_screen.level_bmp_mc._alpha = 80;
	_screen.level_bmp_mc.attachBitmap(level_bmp, 1);*/
}

// test projectile for collision with boxes or enemies
_global.projectileHittest = function(targetMC) {
	var box, enemy;
	if((enemy = enemyHittest(targetMC))){
		_root.stats.hits++;
		enemy.hit(getDamage(targetMC.damage), targetMC._rotation);
		if(targetMC.stun){
			enemy.stunned += targetMC.stun;
			if(Math.random() < targetMC.stun / enemy.stunned)
				makeZaps(enemy, enemy.stunned);
		}
		return enemy;
	}else if((box = boxHittest(targetMC))){
		_root.stats.hits++;
		box.hit(getDamage(targetMC.damage), getAngle(targetMC, box)/*targetMC._rotation*/);
		return box;
	}
}

// check for collision with box
_global.boxHittest = function(targetMC){
	if(_screen.boxes_mc.hitTest(targetMC._x + _screen._x, targetMC._y + _screen._y, true)){
		var b = boxes.length;
		while(b--){
			var box = boxes[b];
			if (box._currentframe == 1) {
				var boxCore = box.core_mc || box;
				if (boxCore.hitTest(targetMC._x + _screen._x, targetMC._y + _screen._y, true)){
					return box;
				}
			}
		}
	}
	return false;
}

// check for collision with enemy
_global.enemyHittest = function(targetMC){
	if(_screen.enemies_mc.hitTest(targetMC._x + _screen._x, targetMC._y + _screen._y, true)){
		var e = enemies.length;
		while(e--){
			var enemy = enemies[e];
			if (enemy._currentframe == 1) {
				if (enemy.core_mc.hitTest(targetMC._x + _screen._x, targetMC._y + _screen._y, true)){
					return enemy;
				}
			}
		}
	}
	return false;
}

// bomb explosion
_global.makeExplosion = function(explosion){
	
	var sampleRate = 15, blastRangeSquare = explosion.blastRange * explosion.blastRange;
	
	// explode boxes
	var box;
	var b = boxes.length;
	while(b--){
		box = boxes[b];
		if(box._currentframe == 1){
			var distance = getDistanceSquare(explosion, box);
			if(distance < blastRangeSquare){
				if(lineOfSight(explosion, box, sampleRate)){
					distance = Math.sqrt(distance);
					var percent = 1 - (distance / explosion.blastRange);
					box.hit(explosion.damage * percent, getAngle(explosion, box));
				}
			}
		}
	}
	
	// explode enemies
	var enemy;
	var e = enemies.length;
	while(e--){
		enemy = enemies[e];
		if(enemy._currentframe == 1){
			var distance = getDistanceSquare(explosion, enemy);
			if(distance < blastRangeSquare){
				if(lineOfSight(explosion, enemy, sampleRate)){
					distance = Math.sqrt(distance);
					var percent = 1-(distance / explosion.blastRange);
					enemy.hit(explosion.damage * percent, getAngle(explosion, enemy));
					if(explosion.stun){
						enemy.stunned += int(explosion.stun * percent);
						makeSparks(enemy, percent * 100);
						makeZaps(enemy, enemy.stunned);
					}
				}
			}
		}
	}
	
	// explode player
	var distance = getDistanceSquare(explosion, _player);
	if(distance < blastRangeSquare){
		if(lineOfSight(explosion, _player, sampleRate)){
			distance = Math.sqrt(distance);
			var percent = 1 - (distance / explosion.blastRange);
			_player.hitPlayer(int(explosion.damage * percent), getAngle(explosion, _player));
		}
	}
	
	// shake and flash the screen
	if(explosion.shakeStrength == undefined) 
		shake(explosion.blastRange / 30);
	else if(explosion.shakeStrength > 0)
		shake(explosion.shakeStrength);
	if(explosion.useFlash || (explosion.useFlash == undefined && explosion.damage >= 100))
		flashScreen();
}

// shrapnel explosion
_global.makeShrapnel = function(targetMC, frag, fragCount, spread, props){
	if(spread == undefined) spread = 360;
	while(fragCount--){
		var d = shotID();
		var init = {
			_x:targetMC._x,
			_y:targetMC._y,
			_rotation:targetMC._rotation + jitter(spread),
			shrapnel:true
		}
		for(var i in props)
			init[i] = props[i];
		var mc = _screen[frag].duplicateMovieClip(frag + d, d, init);
	}
}

// weapons target acquisition
_global.findTarget = function(targetMC, objects, compareFunc, minValue, sampleRate){
	if(!sampleRate) sampleRate = 10;
	var i = objects.length, targets = [], mc, val;
	while(i--){
		mc = objects[i];
		val = compareFunc(targetMC, mc);
		if(val <= minValue)
			targets.push({mc:mc, value:val});
	}
	targets.sort(function(a, b){ return a.value - b.value });
	for(var i = 0; i < targets.length; i++){
		if(lineOfSight(targetMC, targets[i].mc, sampleRate)){
			targets[i].mc.seekingDamage += targetMC.damage;
			return targets[i].mc;
		}
	}
}
_global.targetByAngleDifFunc = function(mc1, mc2){
	var angle = getAngle(mc1, mc2);
	return angleDif(angle, mc1._rotation);
}
_global.targetByAngleDifAndHealth = function(mc1, mc2){
	var angle = getAngle(mc1, mc2);
	return angleDif(angle, mc1._rotation) - (mc2.health * .25);
}
_global.targetByAngleDifSeekingDamage = function(mc1, mc2){
	var angle = getAngle(mc1, mc2);
	return angleDif(angle, mc1._rotation) - Math.max(0, mc2.health - mc2.seekingDamage) * .25;
}

// collision with walls
_global.wallHitTest = function(x, y, threshold){
	return (level_bmp.getPixel(int(x), int(y)) <= (threshold||0x000000));
}

// line of sight check
_global.lineOfSight = function(mc1, mc2, sampleRate) {
	var x = mc1._x, y = mc1._y;
	var xV = x - mc2._x; // x,y vector
	var yV = y - mc2._y;
	var d = Math.sqrt((xV * xV) + (yV * yV)); // distance
	var s = int(d / sampleRate); // samples: number of hitTests
	var xS = xV / s; // x,y sample speeds
	var yS = yV / s;
	while(s--){
		if(wallHitTest(x, y)) return false;
		x -= xS;
		y -= yS;
		//mc1.attachMovie("dot","dot"+s,s,{_x:x-mc1._x,_y:y-mc1._y});
	}
	return true;
}

// basic seperated axis reflection/bounce
_global.bounceTrajectory = function(targetMC, trajectory, bounce, sampleSize){
	var hitTop = wallHitTest(targetMC._x, targetMC._y - sampleSize);
	var hitBottom = wallHitTest(targetMC._x, targetMC._y + sampleSize);
	var hitLeft = wallHitTest(targetMC._x - sampleSize, targetMC._y);
	var hitRight = wallHitTest(targetMC._x + sampleSize, targetMC._y);
	/*if(hitTop || hitBottom)
		trajectory.y = -trajectory.y*bounce;
	if(hitLeft || hitRight)
		trajectory.x = -trajectory.x*bounce;
	if(!hitLeft && !hitRight && !hitTop && !hitBottom){
		trajectory.y = -trajectory.y*bounce;
		trajectory.x = -trajectory.x*bounce;
	}*/
	if(hitTop)
		trajectory.y = Math.abs(trajectory.y) * bounce;
	else if(hitBottom)
		trajectory.y = -Math.abs(trajectory.y) * bounce;
	if(hitLeft)
		trajectory.x = Math.abs(trajectory.x) * bounce;
	else if(hitRight)
		trajectory.x = -Math.abs(trajectory.x) * bounce;
	if(!hitLeft && !hitRight && !hitTop && !hitBottom){
		trajectory.y = -trajectory.y * bounce;
		trajectory.x = -trajectory.x * bounce;
	}
	return trajectory;
}

// angular collision detection
_global.findCollision = function(point, samples, radius, threshold){
	
	//var t = getTimer()
	
	// create and cache perimeter vectors
	var perimeter, perim = "perim" + samples + "_" + radius;
	if(!arguments.callee[perim]){
		perimeter = arguments.callee[perim] = [];
		var a, v, i = samples;
		while(i--){
			a = (i / samples) * 360;
			v = getVector(radius, a);
			perimeter.push({angle:a, vector:v});
		}
	}else{
		perimeter = arguments.callee[perim];
	}
	
	// sample all points
	var nx = 0, ny = 0, vx, vy, count = 0, i = samples, h;
	while(i--){
		vx = perimeter[i].vector.x;
		vy = perimeter[i].vector.y;
		h = wallHitTest(point.x + vx, point.y + vy, threshold);
		//var mc = _screen.attachMovie('dot','dot'+i, -i, {_x:point.x + vx, _y:point.y + vy, _width:1, _height:1});
		if(h){
			//new Color(mc).setRGB(0x00FF00);
			count++;
			nx -= vx;
			ny -= vy;
		}
	}
	if (count == 0)
		return false;
	var a = -Math.atan2(nx, ny) * (180 / Math.PI);//Math.atan2(ny, nx) * DEGREES;
	var v = getVector(radius, a);//{ x:nx / count, y:ny / count };
	//trace(getTimer() - t)
	return {
		angle:a,
		vector:v
	};
}
/*_global.findCollision = function(point, num, diameter, debug){
	var t = getTimer()
	// find (and cache) the perimeter angles and vectors
	var perimeter;
	if(!arguments.callee['perim'+num+'_'+diameter]){
		perimeter = arguments.callee['perim'+num+'_'+diameter] = [];
		var a, v, i = num;
		while(i--){
			a = (i/num)*360;
			v = getVector(diameter,a);
			perimeter.push({angle:a,vector:v});
		}
	}else{
		perimeter = arguments.callee['perim'+num+'_'+diameter];
	}
	
	// check perimeter of hitTests
	var h, hits = [], i = num;
	while(i--){
		h = wallHitTest(point.x + perimeter[i].vector.x, point.y + perimeter[i].vector.y, impassThreshold);
			if(debug) var mc = _root.attachMovie('dot','dot'+i,i,{_x:point.x + perimeter[i].vector.x,_y:point.y + perimeter[i].vector.y});
		if(h){
			hits.push({angle:perimeter[i].angle, vector:perimeter[i].vector, hit:h});
				if(debug) new Color(mc).setRGB(0x00FF00);
		}
	}
	
	// abort if no hits found
	if(!hits.length) return false;
	
	// order hits so that the biggest angle gap is between first elem and last elem
	var gap = 0, dif, index = 0;
	for(var h=0; h<hits.length; h++){
		dif = angleDif(hits[h].angle,hits[(h||hits.length)-1].angle);
		if(dif > gap){
			gap = dif;
			index = h;
		}
	}
	if(index != 0){
		var pre = hits.slice(0,index);
		hits.splice(0,index+1);
		hits = hits.concat(pre);
	}
	
	// find the median (middle) angle
	var medianHit;
	if(hits.length%2){
		medianHit = hits[Math.floor(hits.length/2)];
	}else{
		// in the case of even hits, find the average between the two median elements
		var a1 = hits[hits.length/2].angle, a2 = hits[hits.length/2 - 1].angle;
		var a = midAngle(a1,a2);
		medianHit = {
			angle:a,
			vector:getVector(diameter,a)
		}
	}
	//if(debug){ var str = '';	for(var h in hits){ str += hits[h].angle + ' | '}; trace(str); }
	
	// return the goods
	medianHit.numHits = hits.length;
		if(debug) trace(medianHit.angle);
	trace(getTimer() - t);
	return medianHit;
}*/
