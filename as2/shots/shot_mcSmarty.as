// instance shot_mcSmarty on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 30;
	speed = 12;
	blastMark = 1;
	minTargetAngle = 180;
	turnSpeed = 15;
	targetBoxes = true;
	
	function onInit(){
		acquireTarget();
	}
	
	function onUpdate(){
		//if(!target) acquireTarget();
		star_mc._rotation = rand(360);
	}
}
