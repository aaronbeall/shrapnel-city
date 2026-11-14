// instance shot_mcPlasma on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 30;
	speed = 30;
	blastMark = 3;
	blastRange = 35;
	shakeStrength = 0;
	
	function onUpdate(){
		if(randomPerSecond(frameRate))
			makeShrapnel(this, "particle_mcBlue", 1 + random(3), 360, {scale:75});
	}
}
