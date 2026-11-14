// instance shot_mcEPlasma on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	speed = 9;
	damage = 8;
	blastMark = 3;
	blastRange = 25;
	
	function onUpdate(){
		if(randomPerSecond(10))
			makeShrapnel(this, "particle_mcBlue", 1, 360, {scale:50});
	}
}
