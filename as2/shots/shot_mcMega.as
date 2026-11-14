// instance shot_mcMega on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 800;
	speed = 5;
	//turnSpeed = 10;
	accel = 1.05;
	blastRange = 250;
	blastMark = 10;
	minTargetAngle = 90;
	
	function onSample(){
		makeSmoke(this, 35, 4);
	}
	
	function onUpdate(){
		acquireTarget();
	}
}
