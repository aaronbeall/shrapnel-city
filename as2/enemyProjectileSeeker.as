#include "enemyProjectile.as"

// init
var targetAngle = _rotation;
cacheAsBitmap = false;

// update
var _update = update;
update = function(){
	
	if(_rotation != targetAngle){
		_rotation = smartRotation(_rotation, targetAngle, turnSpeed || speed);
		trajectory = getVector(speed, _rotation);
		//samples = Math.ceil(speed/sampleSize);
		trajectory.x /= samples;
		trajectory.y /= samples;
	}
	
	_update();
}

// target aquisition
function acquireTarget(){
	targetAngle = getAngle(this, _player);
}