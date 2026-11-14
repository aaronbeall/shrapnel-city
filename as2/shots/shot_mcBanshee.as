// instance shot_mcBanshee on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 8;
	speed = 40 + rand(60);
	blastMark = 5;
	
	if(shrapnel){
		damage = 30;
		speed /= 3;
	}
}
