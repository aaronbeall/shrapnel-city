// instance shot_mcFlak on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	
	// params
	damage = 25;
	speed = 10;
	fragCount = 15;
	frag = "shrap_mc";
	fragSpread = 30;
	influence = 1.0;
	fragInfluence = 1.0;
	pinnedHit = true;
	
	// timeout
	var time = 0, timer = 3;
	function onUpdate(){
		if(++time >= timer)
			hitFunc();
	}
	
	// brass shells
	function onInit(){
		makeShell(_player, _rotation + 90 + jitter(25), 200, 150);
	}
}
