// PROJECTILE SEEKER
// homes in on enemies

type = "seeker";
#include "projectile.as"

// params
if(minTargetAngle == undefined) minTargetAngle = 180;
if(targetFunc == undefined) targetFunc = targetByAngleDifSeekingDamage;
if(turnSpeed == undefined) turnSpeed = 10;
if(targetBoxes == undefined) targetBoxes = false;

//init
cacheAsBitmap = false;

// vars
var target = target, targetAngle;

// update
var _update = update;
update = function(time){
	
	// seeking on target
	if(target.health <= 0) target = null;
	if(target && _rotation != targetAngle){
		targetAngle = getAngle(this, target);
		_rotation = smartRotation(_rotation, targetAngle, turnSpeed || speed);
		trajectory = getVector(speed, _rotation);
		xSample = trajectory.x / samples;
		ySample = trajectory.y / samples;
		
		/*if(!_root['graphics'+_name]) _root.createEmptyMovieClip('graphics'+_name,shotID());
		with(_root['graphics'+_name]){
			clear();
			moveTo(this._x,this._y);
			lineStyle(2,0xff0000,15);
			lineTo(target.mc._x,target.mc._y);
			_alpha = random(100);
		}*/
	}
	
	_update(time);
}

// die
function onDie(){
	target.seekingDamage -= damage;
	target = null;
}

// target acquisition
function acquireTarget(refreshAngle){
	if(!target /*|| target.mc._parent == _screen.boxes_mc*/){
		target = findTarget(this, _root.enemies, targetFunc, minTargetAngle);
		if(!target && targetBoxes)
			target = findTarget(this, _root.boxes, targetFunc, minTargetAngle);
	}
	if(target && refreshAngle)
		_rotation = getAngle(this, target);
}