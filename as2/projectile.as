// PROJECTILE

// init
stop();
if(type == undefined) type = "bullet";
var original = _parent[stripNums(_name)];
if(this != original)
	_root.shots.push(this);
else
	_visible = false;
cacheAsBitmap = true;

// params
if(damage == undefined) damage = 10;
if(speed == undefined) speed = 20;
if(blastMark == undefined) blastMark = 0;
if(blastInit == undefined) blastInit = null;
if(shakeStrength == undefined) shakeStrength = 0;
if(useFlash == undefined) useFlash = false;
if(fragCount == undefined) fragCount = 0;
if(frag == undefined) frag = "";
if(fragSpread == undefined) fragSpread = 360;
if(blastRange == undefined) blastRange = 0;
if(stun == undefined) stun = 0;
if(influence == undefined) influence = 0;
if(fragInfluence == undefined) fragInfluence = 0;
if(pinnedHit == undefined) pinnedHit = false;
if(accel == undefined) accel = 0;
if(sampleSize == undefined) sampleSize = 6 + random(4);
if(radius == undefined) radius = _width * .5;

// init trajectory
speed += jitter(speed * .025);
initSpeed = speed;
trajectory = getVector(speed, _rotation);
if(influence){
	if(xSpeed) trajectory.x += xSpeed * influence;
	if(ySpeed) trajectory.y += ySpeed * influence;
	speed = getLength(trajectory);
}
samples = Math.ceil(speed / sampleSize);
xSample = trajectory.x / samples;
ySample = trajectory.y / samples;

// function when projectile has hit something
if(!hitFunc){
	hitFunc = function(type){
		die();
		if(blastMark) makeBlastmark(this, blastMark, blastInit);
		var b = type == "wall" && (blastRange || fragCount);
		if(b){ _x -= xSample; _y -= ySample; }
		if(blastRange) makeExplosion(this);
		if(fragCount) makeShrapnel(this, frag, fragCount, fragSpread, {influence:fragInfluence || 0, xSpeed:trajectory.x, ySpeed:trajectory.y});
		if(b){ _x += xSample; _y += ySample; }
		cacheAsBitmap = false;
		if(pinnedHit != true) _rotation = rand(360);
		gotoAndPlay(2);
		onDie();
	}
}

if(!update){
	update = function(time){
		
		// default timescale
		//if(!time)
			//time = 1.0;
		
		// accelerate
		if(accel){
			trajectory.x *= accel;
			trajectory.y *= accel;
			speed *= accel;
			samples = Math.ceil(speed / sampleSize);
			xSample = trajectory.x / samples;
			ySample = trajectory.y / samples;
		}
		
		// sub sampled shot movement
		var i = samples;
		while(i--){
			
			// move shot
			_x += xSample * time;
			_y += ySample * time;
			
			// check for collisions
			if(wallHitTest(_x, _y))
				return hitFunc("wall");
			else if(projectileHittest(this))
				return hitFunc();
			
			onSample();
		}
		
		onUpdate();
	}
}

function die(){
	_root.shots.remove(this);
}

if(this != original){
	onInit();
	if(type == "bullet")
		update(Math.random() * timeScale);
}