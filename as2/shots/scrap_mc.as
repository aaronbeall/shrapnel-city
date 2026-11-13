// instance scrap_mc on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "shrapnel";
	speed = 5 + rand(25);
	bounce = 0.75;
	drag = .85;
	damage = 5;
	spinSpeed = 75;
	sampleSize = 10;
	fastBounce = true;
	pinnedHit = true;
	
	// init
	function onInit(){
		_xscale = 80 + rand(60);
		_yscale = 80 + rand(60);
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
