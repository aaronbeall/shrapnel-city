// instance shot_mcSpready on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	damage = 15;
	speed = 40;
	blastMark = 1;
	
	function onUpdate(){
		xSample += Math.random() - .5;
		ySample += Math.random() - .5;
	}
}
