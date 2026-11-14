// instance shot_mcAuto on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 10;
	speed = 25;
	blastMark = 1;
	minTargetAngle = 45;
	turnSpeed = minTargetAngle;
	targetBoxes = true;
	targetFunc = targetByAngleDifFunc;
	
	function onInit(){
		acquireTarget();
	}
	
	function onUpdate(){
		star_mc._rotation = rand(360);
	}
}
