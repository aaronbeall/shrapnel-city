// instance shot_mcWarpMissile on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 500;
	speed = 100 + rand(100);
	blastRange = 40;
	blastMark = 11;
	
	function onSample(){
		makeSmoke(this, 35, 4);
	}
}
