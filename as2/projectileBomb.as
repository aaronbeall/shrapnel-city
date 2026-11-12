// PROJECTILE BOMB
// bounces off walls, explodes

// overrides
if(type == undefined) type = "bomb";
if(sampleSize == undefined) sampleSize = 5;
if(influence == undefined) influence = 1.0;

#include "projectile.as"

// params
if(bounce == undefined) bounce = .5;
if(drag == undefined) drag = .95;
if(spinSpeed == undefined) spinSpeed = 25;
if(speedMin == undefined) speedMin = 1;
if(fastBounce == undefined) fastBounce = false;

// init
if(spinSpeed){
	_rotation = rand(360);
	cacheAsBitmap = false;
}
var BOUNCE_PERIMITER_SAMPLES = 90;


function update(time){
	
	// subsampled movement
	var samples = Math.ceil(speed / sampleSize);
	var xSample = trajectory.x / samples * time, ySample = trajectory.y / samples  * time;
	var i = samples;
	while(i--){
		var oldX = _x, oldY = _y;
		_x += xSample;
		_y += ySample;
		
		// collisions
		if(wallHitTest(_x, _y)){
			makeSparks(this, speed / initSpeed);
			_x = oldX;
			_y = oldY;
			
			// bouncing
			if(fastBounce){
				bounceTrajectory(this, trajectory, bounce, sampleSize);
				onBounce();
				break;
			}else{
				var hit = findCollision({x:_x + xSample, y:_y + ySample}, BOUNCE_PERIMITER_SAMPLES, radius, wallThreshold);
				if(hit){
					/*_screen.lineStyle(2,0xff0000,100);
					_screen.moveTo(_x,_y);
					_screen.lineTo(_x - hit.vector.x*3,_y - hit.vector.y*3);*/
					var normal = normalizeVector(hit.vector);
					var reflect = reflectVector({x:trajectory.x, y:trajectory.y}, normal);
					
					// change direction
					trajectory.x = reflect.x * bounce;
					trajectory.y = reflect.y * bounce;
					speed *= bounce;
					samples *= bounce;
					
					// check for stuck in corner, and move in direction of least resistence
					if(wallHitTest(_x + trajectory.x / samples, _y + trajectory.y / samples))
						trajectory = getVector(speed, hit.angle - 180);
					
					onBounce();
					break;
				}
			}
			//break;
		}
		onSample();
	}
	
	// spin
	_rotation += spinSpeed * time;
	
	// decay speed
	var drag = Math.pow(drag, time);
	speed *= drag;
	trajectory.x *= drag;
	trajectory.y *= drag;
	spinSpeed *= drag;
	
	// detonate when slowed to stop
	if(speed < speedMin)
		hitFunc();
	
	// particle trail
	if(type == "bomb" && speed >= initSpeed * .5 && randomPerSecond(20))
		makeShrapnel(this, "particle_mcDust", 1, 360, {scale:50});
		
	onUpdate();
}