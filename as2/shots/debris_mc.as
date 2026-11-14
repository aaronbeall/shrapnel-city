// instance debris_mc on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "shrapnel";
	speed = 5 + rand(25);
	bounce = 0.75;
	drag = .9;
	spinSpeed = 75;
	sampleSize = 10;
	fastBounce = true;
	pinnedHit = true;
	smokeTrails = debrisType != "yellow" && !random(5);
	if(explosive == undefined) explosive = smokeTrails && !random(3);
	
	var percent = 1.0;
	
	// init
	function onInit(){
		_xscale = 60 + rand(60);
		_yscale = 60 + rand(60);
		core_mc.gotoAndStop(debrisType);
	}
	
	// update heated appearance based on life
	function onUpdate(){
		percent = speed / initSpeed;
		var frame = Math.ceil(this._totalframes * (1 - percent));
		this.gotoAndStop(frame);
	}
	
	// smoke trails
	function onSample(){
		if(smokeTrails && speed > initSpeed * .45)
			makeSmoke(this, 50 * percent, 10);
	}
	
	// explosive
	function onBounce(){
		if(explosive && speed > initSpeed * .25){
			makeFireball(this, "miniExplosion", 150 + jitter(25));
			die();
			this.kill();
		}
	}
	
	// die
	function onDie(){
		this.gotoAndStop(this._totalframes);
		makeCorpse(this);
		this.kill();
	}
}
