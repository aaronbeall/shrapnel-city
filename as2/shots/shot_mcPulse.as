// instance shot_mcPulse on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "projectile";
	damage = 12;
	speed = 25;
	bounce = 1;
	drag = 1;
	//blastMark = 3;
	sampleSize = 10;
	influence = 0;
	
	if(shrapnel){
		damage = 25;
		speed = 15;
	}
	
	// timeout
	var time = 0, timer = 30 + random(25);
	function onUpdate(){
		if(++time >= timer)
			hitFunc();
	}
	
	function onSample(){
		if(projectileHittest(this))
			hitFunc();
	}
	
	/*var bounceCount = 0, bounces = 5;
	function onBounce(){
		if(++bounceCount > bounces) return hitFunc();
	}*/
}
