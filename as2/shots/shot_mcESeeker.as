// instance shot_mcESeeker on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 10;
	speed = 12;
	turnSpeed = 3;
	blastRange = 75;
	blastMark = 11;
	frag = "frag_mc";
	fragCount = random(4);
	
	function onUpdate(){
		acquireTarget();
		makeSmoke(this, 35, 25, 2);
	}
}
