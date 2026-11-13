// instance shot_mcMissile on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 500;
	speed = 10;
	accel = 1.2;
	blastRange = 50;
	blastMark = 11;
	
	function onSample(){
		makeSmoke(this, 35, 4);
	}
}
