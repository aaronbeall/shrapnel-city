// instance shot_mcBullet on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 9;
	speed = 200 + rand(200);
	fragCount = random(3) == 0 ? 1 : 0;
	frag = "scrap_mc";
	blastMark = 1;
	
	if(shrapnel){
		damage = 50;
	}
	
	// brass shells
	function onInit(){
		if(!shrapnel)
			makeShell(_player, _rotation + 90 + jitter(25));
	}
	
	// only one in 4 shots are actually visible in flight
	_visible = !random(4);
	function onDie(){
		_visible = true;
	}
}
