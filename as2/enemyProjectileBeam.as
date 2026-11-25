// ENEMY PROJECTILE BEAM (first used by level 10 Interface: the Laser Turret)
// An instant beam, like the player's laser (projectileLaser.as), that stops at the first wall or
// at the player's ship, which it hits once.

// params
if(damage == undefined) damage = 30;
if(fadeSpeed == undefined) fadeSpeed = 20;
if(blastMark == undefined) blastMark = 2;

// init
var original = _parent[stripNums(_name)];
if(this != original)
	_root.shots.push(this);
else
	_visible = false;

// beam fire
if(this != original){
	sampleSize = 6;
	trajectory = getVector(sampleSize, _rotation);
	origin = {_x:_x, _y:_y};
	var hitShip = false;
	while(true){
		_x += trajectory.x;
		_y += trajectory.y;
		if(wallHitTest(_x, _y))
			break;
		else if(_x < 0 || _x > levelWidth || _y < 0 || _y > levelHeight)
			break;
		else if(_player._visible && !_player.dying && _player.core_mc.hitTest(_x + _screen._x, _y + _screen._y, true)){
			hitShip = true;
			break;
		}
	}
	if(hitShip){
		_player.hitPlayer(getDamage(damage), _rotation);
		makePlayerBlastmark(this, blastMark);
	}else
		makeBlastmark(this, blastMark);
	makeSparks(this, 100);

	// graphics: the beam stretched from the muzzle to where it stopped
	_yscale = getDistance(this, origin);
	_xscale = 100 + jitter(20);
	_x = origin._x;
	_y = origin._y;
}

function update(){
	if(_alpha - fadeSpeed <= 0){
		_root.shots.remove(this);
		this.kill();
	}else{
		_alpha -= fadeSpeed;
		_xscale += 8;
	}
}
