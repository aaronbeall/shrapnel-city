// instance shot_mcMort on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	
	// params
	blastRange = 100;
	damage = 200;
	speed = 5;
	accel = 1.05;
	fragCount = random(1) + 3;
	frag = "shrap_mc";
	blastMark = 2;
	sampleSize = 5;
	
	function onUpdate(){
		if(random(speed / initSpeed) == 0){
			_rotation += -180;
			makeShrapnel(this, "particle_mcFire", 1 + random(3), 5, {scale:75});
			_rotation += 180;
		}
	}
}
