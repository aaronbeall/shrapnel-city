stop();

// init
var original = _parent[stripNums(_name)];
original._visible = false;
if(this != original)
	_root.shots.push(this);
cacheAsBitmap = true;

// params
if(damage == undefined) damage = 2;
if(speed == undefined) speed = 5;
if(blastMark == undefined) blastMark = 0;
if(blastRange == undefined) blastRange = 0;
if(frag == undefined) frag = "";
if(fragCount == undefined) fragCount = 0;
if(fragSpread == undefined) fragSpread = 360;

// vars
sampleSize = 8 + random(4);
speed += jitter(speed/10);
trajectory = getVector(speed,_rotation);
samples = Math.ceil(speed/sampleSize);
trajectory.x /= samples;
trajectory.y /= samples;

//function when shot has hit something
function hitFunc(type){
	_root.shots.remove(this);
	var b = type == "wall" && (blastRange || fragCount);
	if(b){ _x -= trajectory.x; _y -= trajectory.y; }
	if(blastRange) makeExplosion(this);
	if(fragCount) makeShrapnel(this, frag, fragCount, fragSpread);
	if(b){ _x += trajectory.x; _y += trajectory.y; }
	_rotation = rand(360);
	cacheAsBitmap = false;
	gotoAndPlay(2);
}

function update(time){
	// subsampled movement
	var i = samples;
	while(i--){
		// move
		_x += trajectory.x * time;
		_y += trajectory.y * time;
		
		// collisions
		if(wallHitTest(_x, _y)) {
			// level collision
			hitFunc("wall");
			makeBlastmark(this, blastMark);
			break;
		}else if(_player.core_mc.hitTest(_x + _screen._x, _y + _screen._y, true)) {
			// player collision
			_player.hitPlayer(getDamage(damage), _rotation);
			hitFunc(); 
			makePlayerBlastmark(this, blastMark);
			break;
		}
	}
	onUpdate();
}