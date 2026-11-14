// instance shot_mcSpreadyFader on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	damage = 20;
	speed = 40;
	blastMark = 1;
	
	function onUpdate(){
		_xscale = _yscale *= .9;
		damage *= .85;
		xSample += Math.random() - .5;
		ySample += Math.random() - .5;
	}
}
