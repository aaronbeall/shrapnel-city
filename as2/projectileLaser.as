// PROJECTILE LASER
// instant firing beam weapon

//type = "laser";
//#include "projectile.as"

// params
if(damage == undefined) damage == 100;
if(fadeSpeed == undefined) fadeSpeed = 25;
if(blastInit == undefined) blastInit = null;

// init
var original = _parent[stripNums(_name)];
if(this != original)
	_root.shots.push(this);
else
	_visible = false;

// vars
sampleSize = random(8) + 4;
trajectory = getVector(sampleSize, _rotation);
origin = {_x:_x, _y:_y};

// beam fire
if(this != original){
	while(true){
		
		// MOVE SHOT
		_x += trajectory.x;
		_y += trajectory.y;
		
		// COLLIDE SHOT
		if(wallHitTest(_x,_y))
			break;
		else if(_x < 0 || _x > levelWidth || _y < 0 || _y > levelHeight)
			break;
		else
			projectileHittest(this);
	}
	
	// graphics
	_yscale = getDistance(this, origin);
	_xscale = 100 + jitter(20);
	makeBlastmark(this, 8, blastInit);
	makeSparks(this, 100);
	
	// reset position
	_x = origin._x;
	_y = origin._y;
}

function update(){
	if(_alpha - fadeSpeed <= 0){
		_root.shots.remove(this);
		this.kill();
	}else{
		_alpha -= fadeSpeed;
		_xscale += 5;
	}
}
