// instance shot_mcSeeker on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 500;
	speed = 8;
	//turnSpeed = 10;
	accel = 1.05;
	blastRange = 50;
	blastMark = 11;
	minTargetAngle = 90;
	
	function onSample(){
		makeSmoke(this, 35, 4);
	}
	
	function onUpdate(){
		acquireTarget();
	}
}
