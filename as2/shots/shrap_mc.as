// instance shrap_mc on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "shrapnel";
	speed = 15 + rand(20);
	bounce = 0.65;
	drag = .9;
	damage = 15;
	spinSpeed = 45;
	sampleSize = 10;
	fastBounce = true;
	pinnedHit = true;
	
	// init
	function onInit(){
		_xscale = 100 + jitter(20);
		_yscale = 100 + jitter(20);
	}
	
	// collide with enemies, boxes, and player
	function onSample(){
		if(projectileHittest(this)){
			damage = getDamage(damage * (speed / initSpeed));
			hitFunc();
		}else if(_player.core_mc.hitTest(_x + _screen._x, _y + _screen._y,true)){
			damage = getDamage(damage * (speed / initSpeed));
			_player.hitPlayer(damage, _rotation);
			hitFunc();
		}
	}
	
	// update heated appearance based on life
	function onUpdate(){
		var percent = 1 - speed / initSpeed;
		var frame = Math.ceil(core_mc._totalframes * percent);
		core_mc.gotoAndStop(frame);
	}
	
	// die
	function onDie(){
		if(speed > speedMin) makeSparks(this, speed / initSpeed);
	}
}
