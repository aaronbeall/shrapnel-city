// ENEMY TURRET
// vision management, aiming, shooting, stun response, not movable

#include "enemyObject.as"

// init
_name = "enemyTurret_mc" + getDepth();
movable = false;
turret_mc._rotation = _rotation;
core_mc.cacheAsBitmap = true;
if(turret_mc) _rotation = 0;

// params
if(turnSpeed == undefined) turnSpeed = 5;
if(shot == undefined) shot = "shot_mcEYellow";
if(shotSpread == undefined) shotSpread = 4;
if(refireRate == undefined) refireRate = 25;
if(burstCount == undefined) burstCount = 0;
if(burstReload == undefined) burstReload = 25;
if(visionRange == undefined) visionRange = null;
if(debrisType == undefined) debrisType = "gray";
if(debrisCount == undefined) debrisCount = Math.min(1 + random(health * .05), 15);
if(particleType == undefined) particleType = "particle_mcFire";
if(autoVision == undefined) autoVision = false;

// turrets init - INCOMPLETE
/*var turrets = [];
var turretBase = turret_mc ? turret_mc : this;
for(var i in turretBase)
	if(turretBase[i]._name.indexOf("turret_mc") == 0)
		turrets.push(turretBase[i]);*/

// muzzles init
var muzzles = [];
var muzzleBase = turret_mc ? turret_mc : this;
for(var i in muzzleBase)
	if(muzzleBase[i]._name.indexOf("muzzle") == 0)
		muzzles.push(muzzleBase[i]);

// vars
var initHealth = health;
var refire = 0;
var flashMC = turret_mc ? turret_mc.flash_mc : flash_mc;
var point = {};
var LOS_SAMPLE_SIZE = 15;
var LOS_CHECK_INTERVAL = 15;
var losCheck = LOS_CHECK_INTERVAL + _root.enemies.length % LOS_CHECK_INTERVAL; // LOS check is staggered across frames for enemies to reduce per-frame cpu
var attacking = false;
var shotCount = 0;
var stunned = 0;
var vision = [];
var visionMC = null;
var AUTO_VISION_ANGLES = 90;
var targetRotation;
var visionRangeSquare = visionRange * visionRange;

// vision registration
function registerVision(){
	
	// check to see if current mapping is out of date
	// REMOVED: doesn't account for enemy moving into a new vision area
	/*if(vision.length){
		var invalid = false;
		for(var v in vision){
			if(!vision[i].hitTest(_x + _screen._x, _y + _screen._y, true)){
				invalid = true;
				break;
			}
		}
		if(!invalid)
			return;
	}*/
	
	// register new maps
	vision = [];
	for(var i in _screen.vision_mc){
		if(_screen.vision_mc[i].hitTest(_x + _screen._x, _y + _screen._y, true))
			vision.push(_screen.vision_mc[i]);
	}
	
	// if no maps available, make one
	if(!vision.length)
		vision.push(makeVision());
}
if(!autoVision)
	registerVision();

// automatic vision mapping
function makeVision(){
	var i = AUTO_VISION_ANGLES, points = [];
	while(i--){
		var x = _x, y = _y;
		var v = getVector(LOS_SAMPLE_SIZE, (i / AUTO_VISION_ANGLES) * 360);
		do{
			x += v.x;
			y += v.y;
		}while(!wallHitTest(x, y))
		points.push({x:x, y:y});
	}
	var d = _screen.vision_mc.getNextHighestDepth();
	var mc = _screen.vision_mc.createEmptyMovieClip('vision_mc' + d, d);
	mc.beginFill(random(0xFFFFFF), 100);
	mc.moveTo(points[0].x, points[0].y);
	for(var i = 1; i < points.length; i++)
		mc.lineTo(points[i].x, points[i].y);
	mc.endFill();

	mc._visible = false;
	//_screen.vision_mc._visible = true;
	mc._alpha = 25;
	
	visionMC = mc;
	
	return mc;
}
if(autoVision || !vision.length){
	
	trace("auto vision map creation for " + _name);
	
	// staggered creation - 1 per frame from start of level
	setTimeout(makeVision, _root.enemies.length * frameRate);
	
	// because the expensive LOS check is eliminated, staggered check interval not needed
	LOS_CHECK_INTERVAL = 0;
	
	/*onPress = function(){ _screen.vision_mc._visible = visionMC._visible = true; }
	onRelease = function(){ _screen.vision_mc._visible = visionMC._visible = false; }*/
}

// hit
function onHit(damage, angle){
	if(turret_mc){
		//turret_mc._rotation = smartRotation(turret_mc._rotation, angle, damage / (resistence / 10));
		turretSpinSpeed = (damage * 8 + rand(damage * 5)) / resistence;
	}
	stunned = Math.max(int(damage * .5), stunned);
}

// die
function onDie(){
	flashMC._visible = false;
	makeShrapnel(this, "scrap_mc", random(6));
	makeShrapnel(this, "frag_mc", random(6));
	makeShrapnel(this, particleType, Math.min(50, int(initHealth * .25)));
	if(visionMC)
		visionMC.kill();
}

// turret AI
_update = update;
update = function(time){
	
	_update(time);
	
	// fade muzzle flash
	if(flashMC._visible)
		flashMC._alpha -= 50;
	if(flashMC._alpha <= 0)
		flashMC._visible = false;
	
	// turret spin response
	if(turretSpinSpeed > speedMin){
		turret_mc._rotation += turretSpinSpeed;
		turretSpinSpeed *= drag;
	}
	
	// stunned state prevents further actions
	if(stunned){
		if(randomPerSecond(.5))
			makeShrapnel(this, "particle_mcDust", 1 + random(2));
		return stunned--;
	}
	
	// death roll
	if(dying)
		return;
	
	// vision check
	if(--losCheck <= 0){
		losCheck = LOS_CHECK_INTERVAL;
		if(visionMC)
			attacking = visionMC.active;
		else{
			attacking = false
			if(movable && speed > speedMin)
				registerVision();
			for(var i in vision){
				if(vision[i].active){
					if(!visionRange || getDistanceSquare(this, _player) < visionRangeSquare){
						if(lineOfSight(this, _player, LOS_SAMPLE_SIZE)){
							attacking = true;
							break;
						}
					}
				}
			}
		}
	}
	//_alpha = attacking ? 100 : 50;
	
	// attacking player
	refire += time;
	if(attacking || (shotCount && shotCount < burstCount)){
		
		// aiming
		if(attacking)
			targetRotation = getAngle(this, _player);
		
		var aimer = null;
		if(turret_mc){
			aimer = turret_mc;
			if(movable && _rotation != 0){
				targetRotation -= _rotation;
				if(targetRotation < -180)
					targetRotation += 360;
				else if(targetRotation > 180)
					targetRotation -= 360;
			}
		}else if(movable){
			aimer = this;
		}
			
		if(aimer)
			aimer._rotation = smartRotation(aimer._rotation, targetRotation, turnSpeed * time);
			
		// firing
		if(shot && refire >= refireRate && (!aimer || aimer._rotation == targetRotation)){
			refire = 0;
			if(burstCount){
				shotCount++;
				if(shotCount >= burstCount){
					refire = -(burstReload - refireRate);
					shotCount = 0;
				}
			}
			flashMC._alpha = 100;
			flashMC._visible = true;
			for(var i in muzzles){
				var d = shotID();
				point.x = muzzles[i]._x;
				point.y = muzzles[i]._y;
				muzzleBase.localToGlobal(point);
				_screen.globalToLocal(point);
				var init = {
					_rotation:targetRotation + jitter(shotSpread),
					_x:point.x,
					_y:point.y
				}
				if(turret_mc)
					init._rotation += _rotation;
				_screen[shot].duplicateMovieClip("shot_mcE" + d, d, init);
			}
		}
	}
}