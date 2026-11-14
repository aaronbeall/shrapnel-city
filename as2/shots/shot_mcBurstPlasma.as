// instance shot_mcBurstPlasma on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 20;
	speed = 25;
	blastRange = 25;
	blastMark = 5;
	
	function onUpdate(){
		if(randomPerSecond(frameRate))
			makeShrapnel(this, "particle_mcBlue", 1, 360, {scale:55});
	}
}
