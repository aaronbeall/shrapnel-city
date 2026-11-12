// PARTICLE - visual effect, no collisions of any sort

// params
lifespan = 5 + random(25);
speed = Math.random() * 15;
drag = .8;
scale = (scale || 100) + Math.random() * 25;
transparency = 75 + Math.random() * 25;
drift = Math.random() * 3;

type = "particle";
#include "projectile.as"

// init
gotoAndStop(random(_totalframes) + 1);
_rotation += 45;
var f = 1 + int(_totalframes * (Math.abs(_rotation) / 180) + jitter(15));
f = Math.min(_totalframes, Math.max(1, f));
gotoAndStop(f)
_xscale = _yscale = scale;
if(Math.random() < .5)
	blendMode = "add";
//filters = [new flash.filters.BlurFilter()];

// vars
var age = 0;

// update
update = function(time){
	
	// age fade
	age += time;
	var life = 1 - (age / lifespan);
	_xscale = _yscale = scale * life;
	_alpha = transparency * life;
	
	// move
	_x += trajectory.x * time;
	_y += trajectory.y * time;
	
	// decay speed
	var drag = Math.pow(drag, time);
	trajectory.x += jitter(drift);
	trajectory.y += jitter(drift);
	trajectory.x *= drag;
	trajectory.y *= drag;
	
	if(age > lifespan){
		die();
		this.removeMovieClip();
	}
}