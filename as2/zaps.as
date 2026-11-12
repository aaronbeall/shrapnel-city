// ZAPS

// init
age = age || 0;

function onZapComplete(){
	stop();
	var delay = 50 + random(1000);
	age += _totalframes + (delay / frameRate);
	if(age < lifespan){
		setTimeout(replay, delay, this);
	}else{
		//trace("removing zaps: old age")
		this.removeMovieClip();
	}
}

function replay(mc){
	if(mc && !mc.targetMC || mc.targetMC.health > 0){
		if(mc.targetMC && mc.targetMC.movable){
			_x = mc.targetMC._x;
			_y = mc.targetMC._y;
		}
		mc._rotation = rand(360);
		mc.play();
	}else{
		//trace("removing zaps: target died")
		mc.removeMovieClip();
	}
}