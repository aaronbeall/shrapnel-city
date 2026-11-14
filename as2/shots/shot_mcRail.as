// instance shot_mcRail on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 75;
	speed = 100 + rand(100);
	fragCount = random(4);
	frag = "scrap_mc";
	pinnedHit = true;
	
	// brass shells
	function onInit(){
		if(!shrapnel)
			makeShell(_player, _rotation + 90 + jitter(25), 150, 200);
	}
	
	// sparks and rail alignment
	function onDie(){
		makeSparks(this, 1);
	}
}
