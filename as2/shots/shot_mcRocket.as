// instance shot_mcRocket on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 25;
	speed = 15 + rand(15);
	blastRange = 50;
	blastMark = 11;
	blastInit = {scale:[75,75]};
	
	function onSample(){
		makeSmoke(this, 15, 15);
	}
}
