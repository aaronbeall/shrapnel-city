// ENEMY MORTAR
// a fixed emplacement that lobs shells over walls: it needs no line of sight, only range.
// Each shell flies in an arc to where the player is heading and bursts there, with a
// closing ring on the ground where it will land (see enemyProjectileMortar.as).
// Params (set before the #include): mortarRange, mortarMinRange (too close to fire),
// mortarLead (0..1, how far ahead of a moving player it aims), mortarSpread (px of scatter).
// With vision zones it also needs the player in one of its zones (the area it covers, sight
// or not), so a pit outside doesn't shell rooms inside; with only its own auto zone (a level
// without zones) range alone decides.

#include "enemyTurret.as"

// params
if(mortarRange == undefined) mortarRange = 420;
if(mortarMinRange == undefined) mortarMinRange = 60;
if(mortarLead == undefined) mortarLead = .6;
if(mortarSpread == undefined) mortarSpread = 22;
if(mortarFlightSpeed == undefined) mortarFlightSpeed = 6;

// vars
var mortarRangeSquare = mortarRange * mortarRange;
var mortarMinSquare = mortarMinRange * mortarMinRange;
refire = random(refireRate);	// staggered, so a group of mortars doesn't fire in step

function inMortarZone(){
	if(visionMC || !vision.length)
		return true;
	for(var i in vision)
		if(vision[i].active)
			return true;
	return false;
}

// mortar AI: replaces the turret's line-of-sight aiming
update = function(time){
	
	_update(time);
	
	// fade muzzle flash
	if(flashMC._visible)
		flashMC._alpha -= 12;
	if(flashMC._alpha <= 0)
		flashMC._visible = false;
	
	// stunned state prevents further actions
	if(stunned){
		if(randomPerSecond(.5))
			makeShrapnel(this, "particle_mcDust", 1 + random(2));
		return stunned--;
	}
	
	// death roll
	if(dying)
		return;
	
	refire += time;
	if(!shot || refire < refireRate)
		return;
	var distance = getDistanceSquare(this, _player);
	attacking = distance < mortarRangeSquare && distance > mortarMinSquare && inMortarZone();
	if(!attacking)
		return;
	refire = 0;
	
	// aim at where the player will be when the shell lands
	var flight = Math.max(20, Math.sqrt(distance) / mortarFlightSpeed);
	var tx = _player._x + _player.xSpeed * flight * mortarLead + jitter(mortarSpread);
	var ty = _player._y + _player.ySpeed * flight * mortarLead + jitter(mortarSpread);
	
	flashMC._alpha = 100;
	flashMC._visible = true;
	makeShrapnel(this, "particle_mcDust", 3 + random(3), 360, {scale:80});
	for(var i in muzzles){
		var d = shotID();
		point.x = muzzles[i]._x;
		point.y = muzzles[i]._y;
		muzzleBase.localToGlobal(point);
		_screen.globalToLocal(point);
		_screen[shot].duplicateMovieClip("shot_mcE" + d, d, {
			_x:point.x,
			_y:point.y,
			targetX:tx,
			targetY:ty,
			speed:mortarFlightSpeed
		});
	}
}
