// instance shot_mcECannon on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	speed = 50;
	damage = 20;
	blastMark = 11;
	blastRange = 50;
	frag = "frag_mc";
	fragCount = random(4);
	
	function onUpdate(){
		makeShrapnel(this, "particle_mcFire", 1, 360, {scale:75});
	}
}
