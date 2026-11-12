// SMOKE

// init
_name = "smoke_mc" + getDepth();
_root.shots.push(this);
gotoAndStop(random(_totalframes) + 1);
if(!fadeSpeed) fadeSpeed = 10;
if(!scaleSpeed) scaleSpeed = 5;
fadeSpeed += jitter(fadeSpeed/2);
scaleSpeed += jitter(scaleSpeed/2);
_alpha = 0;

// vars
var fadeIn = true;
var FADE_IN_SPEED = 35 + jitter(15);

// update
function update(time){
	if(fadeIn){
		_alpha += FADE_IN_SPEED * time;
		if(_alpha >= 100)
			fadeIn = false;
	}else{
		_alpha -= fadeSpeed * time;
		if(_alpha <= 0){
			_root.shots.remove(this);
			this.kill();
		}
	}
	_xscale = _yscale += scaleSpeed * time;
	
	if(driftTrajectory){
		_x += driftTrajectory.x * time;
		_y += driftTrajectory.y * time;
	}
}