// instance shot_mcFlamer on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 25;
	blastRange = 0;
	shakeStrength = 0;
	useFlash = false;
	speed = 25;
	accel = .9;
	influence = 1.0;
	
	// fire params
	blendMode = "add";
	lifespan = 1;
	growSpeed = 5;
	
	
	// init
	_xscale = _yscale = 25 + jitter(10);
	age = speed;
	initDamage = damage;
	
	function onUpdate(){
		// aging
		age *= accel;
		if(age < lifespan){
			die();
			this.kill();
		}
		var life = age/initSpeed;
		_xscale = _yscale += growSpeed;//maxSize*(1-life);
		_alpha = 100*life;
		_rotation += jitter(180*life);
		
		// fire damage
		blastRange = _width/2;
		damage = initDamage*life;
		makeExplosion(this);
	}
	
	function hitFunc(type){
		if(type == "wall"){
			_x -= xSample;
			_y -= ySample;
		}
		this.update = onUpdate;
	}
}
