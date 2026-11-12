// REACTOR (death roll animation)

// default params
health = 200;
debrisType = "gray";
debrisCount = 12;
deathDuration = frameRate * 3;
radius = core_mc._height / 2;

#include "box.as"

// vars
var dying = false;
var deathTime = 0;

// death roll
_hit = hit;
hit = function(damage, angle){
	if(!dying){
		health -= damage;
		if(health <= 0){
			dying = true;
			notify(_player, "Reactor meltdown! Take cover!", deathDuration - frameRate);
			onEnterFrame = function(){
				if(++deathTime >= deathDuration){
					_hit(damage, angle);
					delete onEnterFrame;
				}else{
					if(randomPerSecond(15))
						makeShrapnel(randomPointOn(this), "particle_mcBlue", 1, 360);
					if(randomPerSecond(5))
						makeFireball(randomPointOn(this), "miniExplosion", 50 + rand(100));
					else if(randomPerSecond(5))
						makeSparks(randomPointOn(this));
					//else if(randomPerSecond(6))
						//makeShrapnel(randomPointOn(this), "frag_mc", random(5), 360);
				}
			}
		}
	}
}

function onShockwave(){
	//flashScreen();
	//shake(3);
	var d = shotID()
	var shock = _screen.shot_mcShock.duplicateMovieClip("shot_mc" + d, d, {_x:_x, _y:_y});
	new Color(shock).setRGB(0x6666ff);
	shock.blendMode = "add";
	shock._alpha = 25;
	shock.blastMark = 1;
	shock.onInit = function(){
		this.hitFunc();
	}
}

function onParticles(){
	makeShrapnel(this, "particle_mcBlue", 30);
	makeZaps({_x:_x, _y:_y}, 100);
}