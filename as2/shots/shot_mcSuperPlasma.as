// instance shot_mcSuperPlasma on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 22;
	speed = 25;
	blastRange = 25;
	blastMark = 3;
	
	function onInit(){
		if(getDepth(this) % 2){
			_x += ySample;
			_y -= xSample;
		}else{
			_x -= ySample;
			_y += xSample;
		}
	}
	
	function onUpdate(){
		if(randomPerSecond(15))
			makeShrapnel(this, "particle_mcFire", 1, 360, {scale:45});
	}
}
