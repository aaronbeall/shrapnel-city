onClipEvent(load){
	
	// PLAYER PARAMS
	health = 100;
	healthMax = 100;
	healthLow = 25;
	speedMax = 9;
	speedMin = .1
	turnSpeed = 6;
	turnAccel = 1.5;
	accel = 2;
	decel = .9;
	bounce = .75;
	strafeAccel = 1;
	radius = 19;
	shadowHeight = 15;
	indicatorFade = 15;
	deathControl = 15;
	//invisible = true;
	
	// WEAPONS
	// name - short name identifier
	// shot - instance name of shot MC that the weapon fires
	// ammo - starting ammo, and used to store ammo
	// max - the max ammo that can be carried
	// refire - frames between shots, time based on swf framerate
	// spread - total amount of angle spread, ex 12 would be -6 to 6
	// fullname - as it appears in the HUD
	// fire - the fire graphic to use
	// burst [optional] - burst count per fire command
	// burstReload [optional] - refire time between bursts
	// key - category and hotkey groups:
	// 1 - machine weapons
	// 2 - energy weapons
	// 3 - kinetic weapons
	// 4 - special weapons
	// 5 - laser weapons
	// 6 - concussion bombs
	// 7 - propelled bombs
	// 8 - cluster bombs
	// 9 - missiles
	// 0 - laser devices
	weapons1 = [
		{name:"Energizer", shot:"shot_mcEnergizer", ammo:Infinity, max:Infinity, refire:4, spread:12, fullname:"Energizer Gun", fire:1, key:1}, 
		{name:"Bolter", shot:"shot_mc", ammo:200, max:999, refire:2, spread:8, fullname:"Bolter Cannon", fire:1, key:1}, 
		{name:"Plasma", shot:"shot_mcPlasma", ammo:0, max:200, refire:10, spread:6, fullname:"Plasma Cannon", fire:2, key:2}, 
		{name:"Vertigo", shot:"shot_mcBurstPlasma", ammo:0, max:300, refire:2, spread:7, fullname:"Vertigo Cannon", burst:3, burstReload:6, fire:2, key:2}, 
		{name:"Phoenix", shot:"shot_mcPhoenix", ammo:0, max:200, refire:4, spread:7, fullname:"Phoenix Cannon", fire:4, key:2}, 
		{name:"Gatling", shot:"shot_mcEnergizer", ammo:0, max:Infinity, refire:1, spread:16, fullname:"Gatling Gun", fire:1, key:1}, 
		{name:"Banshee", shot:"shot_mcBanshee", ammo:0, max:600, refire:1, spread:24, fullname:"Banshee Cannon", fire:1, key:1}, 
		{name:"Spreader", shot:"shot_mcSpreader", ammo:0, max:150, refire:8, spread:6, fullname:"Spreader Cannon", fire:6, key:2}, 
		{name:"Hailstorm", shot:"shot_mcStorm", ammo:0, max:150, refire:1, spread:6, fullname:"Hailstorm Cannon", burst:3, burstReload:15, fire:6, key:2}, 
		{name:"Hydra", shot:"shot_mcHydra", ammo:0, max:250, refire:5, spread:8, fullname:"Hydra Cannon", fire:6, key:2}, 
		{name:"Pulse", shot:"shot_mcPulse", ammo:0, max:200, refire:4, spread:8, fullname:"Pulse Cannon", fire:6, key:2}, 
		{name:"Vendetta", shot:"shot_mcVendetta", ammo:0, max:250, refire:5, spread:8, fullname:"Vendetta Cannon", fire:5, key:2}, 
		{name:"Auto Cannon", shot:"shot_mcAuto", ammo:0, max:250, refire:3, spread:8, fullname:"Auto Cannon", fire:5, key:2}, 
		{name:"Flak", shot:"shot_mcFlak", ammo:0, max:50, refire:10, spread:4, fullname:"Flak Cannon", fire:5, key:3}, 
		{name:"Shredder", shot:"shrap_mc", ammo:0, max:null, refire:1, spread:16, fullname:"Shredder", fire:5, key:3}, 
		{name:"Stinger", shot:"frag_mc", ammo:0, max:null, refire:1, spread:6, fullname:"Stinger", fire:5, key:3}, 
		{name:"Railgun", shot:"shot_mcRail", ammo:0, max:75, refire:10, spread:2, fullname:"Railgun", fire:5, key:3}, 
		{name:"Minigun", shot:"shot_mcBullet", ammo:0, max:750, refire:1, spread:2, fullname:"Minigun", fire:5, key:3}, 
		{name:"Flamer", shot:"shot_mcFlamer", ammo:0, max:600, refire:1, spread:14, fullname:"Flamer Unit", fire:7, burst:3, key:4}, 
		{name:"Reaper", shot:"shot_mcReaper", ammo:0, max:200, refire:6, spread:8, fullname:"Reaper Cannon", fire:7, key:4}, 
		{name:"Laser", shot:"shot_mcLaser", ammo:0, max:100, refire:11, spread:0, fullname:"Laser", fire:3, key:5}, 
		{name:"Super Laser", shot:"shot_mcSuperLaser", ammo:0, max:500, refire:1, spread:0, fullname:"Super Laser", fire:3, key:5}, 
		{name:"Heat Ray", shot:"shot_mcUltraLaser", ammo:0, max:300, refire:1, spread:0, fullname:"Death Ray", burst:5, burstReload:20, fire:3, key:5}
	]
	for(var i in weapons1) weapons1[i].id = int(i);
	weapons2 = [
		{name:"Carbon Bomb", shot:"shot_mcBomb", ammo:2, max:20, refire:15, spread:4, key:6}, 
		{name:"Thermal Bomb", shot:"shot_mcGrenade", ammo:0, max:10, refire:25, spread:4, key:6}, 
		{name:"Impact Mortar", shot:"shot_mcMort", ammo:0, max:5, refire:15, spread:4, key:7}, 
		{name:"Stun Bomb", shot:"shot_mcStun", ammo:0, max:12, refire:15, spread:4, key:6}, 
		{name:"Shrapnel Bomb", shot:"shot_mcFrag", ammo:0, max:5, refire:35, spread:0, key:8}, 
		{name:"Splinter Bomb", shot:"shot_mcSplinter", ammo:0, max:5, refire:10, spread:4, key:8}, 
		{name:"Plasma Bomb", shot:"shot_mcPlasmaBomb", ammo:0, max:5, refire:25, spread:4, key:8}, 
		{name:"Pulse Bomb", shot:"shot_mcPulseBomb", ammo:0, max:5, refire:25, spread:4, key:8}, 
		{name:"Spikey Bomb", shot:"shot_mcSpikey", ammo:0, max:5, refire:25, spread:4, key:8}, 
		{name:"Cluster Bomb", shot:"shot_mcCluster", ammo:0, max:5, refire:35, spread:6, key:8}, 
		{name:"Spitfire Bomb", shot:"shot_mcSpitfire", ammo:0, max:3, refire:35, spread:6, key:8}, 
		{name:"Smart Bomb", shot:"shot_mcSmart", ammo:0, max:10, refire:35, spread:6, key:8}, 
		{name:"Pepper Bombs", shot:"shot_mcSpitling", ammo:0, max:50, refire:3, spread:10, key:7}, 
		{name:"Rocket Pod", shot:"shot_mcRocket", ammo:0, max:50, refire:3, spread:18, key:9}, 
		{name:"Drunken Rockets", shot:"shot_mcDrunken", ammo:0, max:20, refire:20, spread:4, key:9}, 
		{name:"Missile", shot:"shot_mcMissile", ammo:0, max:20, refire:10, spread:2, key:9}, 
		{name:"Heatseeker", shot:"shot_mcSeeker", ammo:0, max:10, refire:15, spread:2, key:9}, 
		{name:"Trident Missiles", shot:"shot_mcHellfire", ammo:0, max:5, refire:15, spread:2, key:9}, 
		{name:"Warp Missile", shot:"shot_mcWarpMissile", ammo:0, max:15, refire:15, spread:2, key:9}, 
		{name:"Smart Missile", shot:"shot_mcSmartMissile", ammo:0, max:5, refire:15, spread:2, key:9}, 
		{name:"Mega Missile", shot:"shot_mcMega", ammo:0, max:1, refire:70, spread:2, key:9}, 
		{name:"Synapse Bomb", shot:"shot_mcSynapse", ammo:0, max:1, refire:60, spread:10, key:7}, 
		{name:"Shock Bomb", shot:"shot_mcShock", ammo:0, max:1, refire:60, spread:6, key:6}, 
		{name:"Laser Bomb", shot:"shot_mcLaserBomb", ammo:0, max:5, refire:30, spread:2, key:0}, 
		{name:"Laser Anhilator", shot:"shot_mcSuperLaserBomb", ammo:0, max:1, refire:30, spread:2, key:0}
	]
	for(var i in weapons2) weapons2[i].id = int(i);
	
	trace(weapons1.length + " primary weapons, " + weapons2.length + " secondary weapons, " + (weapons1.length + weapons2.length) + " total");
	
	weapon1 = weapons1[1];
	weapon2 = weapons2[0];
	
	inventory = [];
	
	// VARS
	turn = 0;
	xSpeed = 0;
	ySpeed = 0;
	speed = 0;
	dead = dying = false;
	deathTime = 0;
	refire1 = 0;
	refire2 = 0;
	firing1 = false;
	shotCount1 = 0;
	
	// INIT
	stop();
	var point = new Object();
	var KEY_X = 88, KEY_Z = 90;
	indicator_mc._visible = false;
	exhaust_mc._visible = false;
	damage_mc._visible = false;
	damage_mc.stop();
	_parent.shadow_mc._x = _x + shadowHeight;
	_parent.shadow_mc._y = _y + shadowHeight;
	_parent.shadow_mc._rotation = _rotation;
	hide();
	updateDisplay();
	
	/*var shipRadius = 0;
	for(var h in hits_mc){
		var d = getDistance({_x:0, _y:0}, hits_mc[h]);
		if(d > shipRadius) shipRadius = d;
	}
	shipRadius = Math.ceil(shipRadius + 1);*/
	
	
	// FUNCTIONS
	
	// hit by something
	function hitPlayer(damage, angle){
		health -= int(damage);
		if(health <= 0){
			if(angle != undefined)
				thrust(Math.min(damage, speedMax * 2), angle);
			if(!dying){
				dying = true;
				gotoAndStop("norm");
				deathRoll();
				for(var mc in _screen.vision_mc)
					_screen.vision_mc[mc].active = false;
				indicator_mc._visible = false;
				damage_mc._visible = false;
				damage_mc.stop();
			}
		}else{
			if(angle != undefined)
				thrust(Math.min(damage / 10, speedMax * 2), angle);
			indicate("hit");
		}
		if(health <= healthLow && !damage_mc._visible && !dying){
			damage_mc._visible = true;
			damage_mc.play();
		}
		updateDisplay("health");
	}
	
	// show indicator graphics
	function indicate(type){
		indicator_mc._visible = true;
		indicator_mc._alpha = 100;
		indicator_mc.gotoAndStop(type);
	}
	
	// test for any collision around player
	function hitTestPerimeter(){
		for(var h in hits_mc){
			var p = {x:hits_mc[h]._x, y:hits_mc[h]._y};
			hits_mc.localToGlobal(p);
			_screen.globalToLocal(p);
			if(wallHitTest(p.x, p.y, impassThreshold)) return true;
		}
		return false;
	}
	
	// thrust player in a direction
	function thrust(speed, angle){
		var delta = getVector(speed, angle);
		xSpeed += delta.x;
		ySpeed += delta.y;
	}
	
	// change weapon
	function changeWep(version,id,dir){
		
		var weapon = this['weapon' + version];
		var weapons = this['weapons' + version];
		
		if(id == undefined || id == null){
			if(!dir) dir = 1;
			var id = weapon.id;
			var i = 0;
			do {
				id += dir;
				if(id > weapons.length - 1) id = 0;
				if(id < 0) id = weapons.length-1;
			} while(weapons[id].ammo <= 0 && ++i < weapons.length);
		}
		if(id == weapon.id) return;
		
		weapon = this['weapon' + version] = weapons[id];
		if(weapon.ammo) notify(this, weapon.name + "(" + weapon.ammo + ")");
		this["refire" + version] = 0;
		this["shotCount" + version] = 0;
		this["firing" + version] = false;
		updateDisplay("wep" + version);
	}
	
	// find a weapon by its name
	function wepByName(version, name){
		var weapons = this['weapons' + version];
		for(var i in weapons){
			if(weapons[i].name == name)
				return weapons[i];
		}
	}
	
	// dying sequence
	function deathRoll(){
		exhaust_mc._visible = false;
		deathTime = 0;
		onEnterFrame = function(){
			deathTime++;
			if(deathTime > deathControl) gotoAndStop("norm");
			_rotation += Math.max(rand(3) + 1, speed * 3);
			if(speed < .05 && xSpeed < .05 && ySpeed < .05){
				dead = true;
				gotoAndPlay("death");
				_parent.shadow_mc._visible = false;
				setTimeout(showDialog, 1000, "diedScreen");
				makeShrapnel(this, "scrap_mc", 25);
				makeShrapnel(this, "frag_mc", 15);
				makeShrapnel(this, "debris_mc", 15, 360, {debrisType:"gray", explosive:true});
				makeBlastmark(this, 10, {_xscale:80, _yscale:80});
				delete onEnterFrame;
			}else if(randomPerSecond(5)){
				makeFireball(randomPointOn(this), "miniExplosion", 50 + rand(100));
			}
		}
	}
	
	// hide and disable player
	function hide(){
		dead = dying = true;
		_visible = _screen.shadow_mc._visible = false;
		xSpeed = ySpeed = 0;
	}
	
	// activate player
	function spawn(){
		dead = dying = false;
		_visible = _screen.shadow_mc._visible = true;
		_player.blasts_mc._alpha = 100;
	}
	
	// main update function
	function update(time){
		
		if(dead) return;
		
		if(scrolling){
			//var look = getVector(100, _rotation)
			screenTargetX = -(_x/* + look.x*/) + screenWidth/2;
			screenTargetY = -(_y/* + look.y*/) + screenHeight/2;
			screenTargetX = Math.min(Math.max(-level_bmp.width + screenWidth, screenTargetX), 0);
			screenTargetY = Math.min(Math.max(-level_bmp.height + screenHeight, screenTargetY), 0);
			_screen._x += int((screenTargetX - _screen._x) / 4);
			_screen._y += int((screenTargetY - _screen._y) / 4);
		}
	
		// MOVEMENT CALCULATIONS
		
		// deccelerate
		xSpeed *= decel;
		ySpeed *= decel;
		
		// thrust input
		if(!dying){
			if(Key.isDown(Key.UP)){
				/*if(speed < speedMax)*/ thrust(accel, _rotation);
				exhaust_mc._visible = true;
				exhaust_mc._xscale = exhaust_mc._yscale = 75 + rand(50);
			}else if(Key.isDown(Key.DOWN)){
				/*if(speed < speedMax)*/ thrust(-accel, _rotation);
				exhaust_mc._visible = false;
			}else if(exhaust_mc._visible){
				exhaust_mc._visible = false;
			}
			if(Key.isDown(KEY_X)){
				/*if(speed < speedMax)*/ thrust(strafeAccel, _rotation + 90);
			}else if(Key.isDown(KEY_Z)){
				/*if(speed < speedMax)*/ thrust(strafeAccel, _rotation - 90);
			}
		}
		
		// maintain speed limit
		speed = getLength({x:xSpeed, y:ySpeed});
		if(speed > speedMax){
			xSpeed *= speedMax / speed;
			ySpeed *= speedMax / speed;
			speed = speedMax;
		}
		
		// collisions
		if(speed > speedMin){
			
			var xSample = xSpeed * time, ySample = ySpeed * time;
			
			// move
			_x += xSample;
			_y += ySample;
			
			// check for collision
			if(hitTestPerimeter()){
				
				// bounce
				var hit = findCollision({x:_x/* + xSample*/, y:_y/* + ySample*/}, 180, radius, impassThreshold);
				if(hit){
					
					// bounce vector
					var reflect = reflectVector({x:xSpeed, y:ySpeed}, normalizeVector(hit.vector));
					
					// change direction
					xSpeed = reflect.x * bounce;
					ySpeed = reflect.y * bounce;
					
					// sparks
					makeSparks({_x:_x + hit.vector.x, _y:_y + hit.vector.y}, speed / speedMax);
					
					// check for stuck in corner, and move in direction of least resistence
					/*if(hitTestPerimeter()){
						//var hit = findCollision({x:_x, y:_y}, 45, radius);
						//if(hit){
							var delta = getVector(Math.max(1, speed), hit.angle - 180);
							_x += delta.x * time;
							_y += delta.y * time;
						//}
					}*/
					
					// move out of collision
					var d = Math.ceil(speed);
					do {
						hit = findCollision({x:_x, y:_y}, 180, radius, impassThreshold);
						if(hit){
							var delta = getVector(1, hit.angle - 180);
							_x += delta.x;
							_y += delta.y;
						}
					}while(d-- && hit);
				}
			}
		}
		
		// VISION REGISTRATION FOR ENEMIES
		if(!dying){
			var scrX = _x + _screen._x, scrY = _y + _screen._y;
			for(var mc in _screen.vision_mc){
				_screen.vision_mc[mc].active = (!invisible || firing1 || firing2) && _screen.vision_mc[mc].hitTest(scrX, scrY, true);
				//_screen.vision_mc._visible = true;
				//_screen.vision_mc[mc]._alpha = _screen.vision_mc[mc].active ? 25 : 0;
			}
		}
		
		if(!dying || deathTime < deathControl){
			
			// TURNING
			if(Key.isDown(Key.LEFT)){
				if(turn == 0){
					turn = turnAccel;
				}else{
					turn *= turnAccel;
					if(turn > turnSpeed) turn = turnSpeed;
				}
				_rotation -= turn * time;
			}else if(Key.isDown(Key.RIGHT)){
				if(turn == 0){
					turn = turnAccel;
				}else{
					turn *= turnAccel;
					if(turn > turnSpeed) turn = turnSpeed;
				}
				_rotation += turn * time;
			}else{
				turn = 0;
			}
			
			// SHOOTING
			// primary weapon
			if(refire1 < weapon1.refire) refire1 += time;
			if(Key.isDown(Key.SPACE)) firing1 = true;
			else if(!weapon1.burst || shotCount1 == 0) firing1 = false;
			if(firing1 && refire1 >= weapon1.refire && weapon1.ammo > 0){
				_root.stats.shots++;
				refire1 = 0;
				if(weapon1.burst){
					shotCount1++;
					if(shotCount1 >= weapon1.burst){
						shotCount1 = 0;
						if(weapon1.burstReload)
							refire1 = -(weapon1.burstReload - weapon1.refire);
						firing1 = false;
					}
				}else{
					shotCount1 = 0;
					firing1 = false;
				}
				var d = shotID();
				if(_currentframe < 5) this.gotoAndStop("attack");
				fire_mc.gotoAndStop(weapon1.fire);
				fire_mc._xscale = 100 * (random(2) ? -1 : 1) + jitter(50);
				fire_mc._yscale = 100 + jitter(50);
				//fire_mc._rotation = jitter(10);
				weapon1.ammo--;
				updateDisplay("ammo1");
				point = new Object();
				point.x = muzzle_mc._x;
				point.y = muzzle_mc._y;
				localToGlobal(point);
				_screen.globalToLocal(point);
				var init = {
					_rotation:_rotation + jitter(weapon1.spread),
					_x:point.x,
					_y:point.y,
					xSpeed:xSpeed,
					ySpeed:ySpeed
				}
				fire_mc._rotation = init._rotation - _rotation;
				_screen[weapon1.shot].duplicateMovieClip("shot_mc" + d, d, init);
				
				// auto select new weapon if ammo expired
				if(weapon1.ammo <= 0){
					changeWep(1);
					if(weapon1.id == 0) changeWep(1, null, -1);
				}
			}else{
				this.gotoAndStop("norm");
			}
			
			// secondary weapon
			if(refire2 < weapon2.refire) refire2 += time;
			if(Key.isDown(Key.CONTROL) && refire2 >= weapon2.refire && weapon2.ammo > 0){
				_root.stats.bombs++;
				refire2 = 0;
				var d = shotID();
				weapon2.ammo--;
				updateDisplay("ammo2");
				point = new Object();
				point.x = muzzle_mc._x;
				point.y = muzzle_mc._y;
				localToGlobal(point);
				_screen.globalToLocal(point);
				var init = {
					_rotation:_rotation + jitter(weapon2.spread),
					_x:point.x,
					_y:point.y,
					xSpeed:xSpeed,
					ySpeed:ySpeed
				}
				_screen[weapon2.shot].duplicateMovieClip("shot_mc" + d, d, init);
				thrust(-weapon2.refire / 10, _rotation);
				
				// auto select new weapon if ammo expired
				if(weapon2.ammo <= 0){
					changeWep(2);
					//if(weapon2.id == 0) changeWep(2,null,-1);
				}
			}
			
			// POWER UP
			//var p, pickup = false;
			if(this.core_mc.hitTest(_screen.powerups_mc)){
				var i = _root.powerups.length;
				while(i--){
					if(this.core_mc.hitTest(_root.powerups[i]))
						_root.powerups[i].pickup();
				}
			}
		}
		
		// SHADOW
		_parent.shadow_mc._x = _x + shadowHeight;
		_parent.shadow_mc._y = _y + shadowHeight;
		_parent.shadow_mc._rotation = _rotation;
		
		// INDICATOR
		if(indicator_mc._visible){
			indicator_mc._alpha -= indicatorFade;
			if(indicator_mc._alpha <= 0){
				indicator_mc._visible = false;
				indicator_mc.gotoAndStop(1);
			}else{
				indicator_mc._rotation = -_rotation;
			}
		}
		
		// DAMAGE
		if(damage_mc._visible){
			if(randomPerSecond(4))
				makeShrapnel(randomPointOn(this), "particle_mcDust", 1, 360, {scale:35});
			if(randomPerSecond(1))
				makeSparks(randomPointOn(this));
		}
	}
}

onClipEvent(keyDown){
	if(dead) return;
	var KEY_F1 = 112, KEY_H = 72;
	switch(Key.getCode()){
		case Key.INSERT: Key.isDown(Key.SHIFT) ? changeWep(1, null, -1) : changeWep(1); break;
		case Key.DELETEKEY: Key.isDown(Key.SHIFT) ? changeWep(2, null, -1) : changeWep(2); break;
		case Key.ESCAPE: !_root.dialogScreen_mc ? showDialog("menuScreen") : hideDialog(); break;
		case KEY_F1: case KEY_H: _root.dialogScreen_mc.name != "helpScreen" ? showDialog("helpScreen") : hideDialog(); break;
		
		//case String("p").getCode(): trace("PPPPPP"); break;
	}
	
	// cheating
	if(Key.isDown(Key.CONTROL) && Key.isDown(Key.SHIFT)){
		switch(Key.getCode()){
			
			// invulnerable
			case Key.PGUP: 
				health = Infinity; 
				updateDisplay(); 
				cheat();
				break;
				
			// full health/vulnerable
			case Key.PGDN: 
				health = healthMax; 
				updateDisplay(); 
				cheat();
				break;
				
			// all weapons
			case Key.HOME:
				var w = weapons1.length;
				if(Key.isDown(Key.ALT)) // infinite ammo
					var a = Infinity;
				while(w--)
					weapons1[w].ammo = a || weapons1[w].max || Infinity;
				var w = weapons2.length;
				while(w--)
					weapons2[w].ammo = a || weapons2[w].max || Infinity;
				updateDisplay();
				cheat();
				break;
			
			// kill all enemies and boxes
			case Key.END:
				var b = _root.boxes.length;
				while(b--)
					//_root.boxes[b].gotoAndStop(_root.boxes[b]._totalframes);
					_root.boxes[b].hit(this, _root.boxes[b].health, rand(360));
				var e = _root.enemies.length;
				while(e--)
					//_root.enemies[e].gotoAndStop(_root.enemies[e]._totalframes);
					_root.enemies[e].hit(this, _root.enemies[e].health, rand(360));
				cheat();
				break;
		}
	}
	function cheat(){
		notify(this, "Cheater!"); 
		_player.hasCheated = true; 
	}
}