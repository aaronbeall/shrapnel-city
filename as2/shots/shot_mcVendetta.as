// instance shot_mcVendetta on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 12;
	stun = frameRate;
	speed = 25;
	turnSpeed = 8;
	blastMark = 1;
	minTargetAngle = 75;
	targetBoxes = true;
	targetFunc = targetByAngleDifFunc;
	
	function onUpdate(){
		if(!target) acquireTarget();
		star_mc._rotation = rand(360);
	}
}
